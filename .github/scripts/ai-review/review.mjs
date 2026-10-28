// AI PR 审查：收集 PR 数据 → 调用 Dify 工作流 → 以 GitHub App 身份发布审查
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import { Octokit } from '@octokit/rest';

export const DEFAULT_LIMITS = {
  max_files: 20, // 单次最多审查的文件数
  max_file_changes: 800, // 单文件新增+删除行数上限，超过则跳过该文件
  max_total_changes: 4000, // 所有被审查文件的变更行数总和上限
  max_source_chars: 60000, // 完整源文件超过该长度时只提供 diff
  max_diff_chars: 70000,
  max_readme_chars: 8000,
  max_description_chars: 8000,
  max_commits: 50,
};
// Dify 代码节点输出的对象数组最多 30 个元素
const HARD_MAX_FILES = 25;
const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
const SEVERITY_EMOJI = { P0: '🔴', P1: '🟡', P2: '🔵', P3: '⚪️' };

// 与审查无关的文件：依赖锁、构建产物、压缩/生成代码、第三方代码、二进制与媒体文件
export const DEFAULT_IGNORE = [
  // 依赖锁文件
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'npm-shrinkwrap.json',
  'poetry.lock', 'Pipfile.lock', 'uv.lock', 'Cargo.lock', 'go.sum', 'composer.lock',
  'Gemfile.lock', 'Podfile.lock', 'pubspec.lock', 'packages.lock.json', 'gradle.lockfile', '*.lock',
  // 构建产物与缓存
  '**/dist/**', '**/build/**', '**/out/**', '**/target/**', '**/.next/**', '**/.nuxt/**', '**/coverage/**',
  '**/__pycache__/**', '*.pyc', '*.class',
  // 第三方代码
  '**/node_modules/**', '**/vendor/**', '**/third_party/**', '**/third-party/**',
  // 压缩、映射与生成代码
  '*.min.js', '*.min.css', '*.map', '*.bundle.js',
  '*.pb.go', '*_pb2.py', '*_pb2_grpc.py', '*.pb.ts', '*.generated.*', '*.g.dart', '*.freezed.dart',
  // 测试快照
  '**/__snapshots__/**', '*.snap',
  // 图片、字体、音视频
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.bmp', '*.ico', '*.svg', '*.psd',
  '*.woff', '*.woff2', '*.ttf', '*.otf', '*.eot',
  '*.mp3', '*.mp4', '*.wav', '*.mov', '*.avi', '*.webm',
  // 文档、压缩包与二进制
  '*.pdf', '*.doc', '*.docx', '*.xls', '*.xlsx', '*.ppt', '*.pptx',
  '*.zip', '*.tar', '*.gz', '*.tgz', '*.rar', '*.7z', '*.jar', '*.war',
  '*.exe', '*.dll', '*.so', '*.dylib', '*.a', '*.o', '*.bin', '*.wasm',
  '*.db', '*.sqlite', '*.sqlite3',
];

const warn = (msg) => console.log(`::warning::${msg}`);
const toList = (v) => (v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…（已截断，原长度 ${s.length} 字符）` : s);

export function normalizeConfig(raw) {
  const limits = { ...DEFAULT_LIMITS, ...(raw.limits || {}) };
  if (limits.max_files > HARD_MAX_FILES) {
    warn(`max_files 最大为 ${HARD_MAX_FILES}，已自动调整`);
    limits.max_files = HARD_MAX_FILES;
  }
  const ignore = [...(raw.use_default_ignore === false ? [] : DEFAULT_IGNORE), ...toList(raw.ignore)];

  const seen = new Set();
  const rules = [];
  for (const r of raw.rules || []) {
    if (!r || !r.id) {
      warn(`跳过缺少 id 的规则：${JSON.stringify(r)}`);
      continue;
    }
    const id = String(r.id).trim();
    if (seen.has(id)) {
      warn(`规则 id 重复，已忽略后出现的：${id}`);
      continue;
    }
    seen.add(id);
    if (r.target === 'commit') {
      warn(`规则 ${id} 使用了 target: commit，已不再支持（commit message 格式请交给 commitlint 检查），已忽略`);
      continue;
    }

    const severity = String(r.severity || '').toUpperCase();
    if (!SEVERITIES.includes(severity)) warn(`规则 ${id} 的 severity 无效（${r.severity}），按 P2 处理`);

    const patterns = toList(r.branches);
    const branches = [];
    for (const p of patterns) {
      try {
        branches.push(new RegExp(p));
      } catch {
        warn(`规则 ${id} 的分支正则无效：${p}`);
      }
    }
    if (patterns.length && !branches.length) {
      warn(`规则 ${id} 没有有效的分支正则，已停用`);
      continue;
    }

    rules.push({
      id,
      title: String(r.title || id),
      severity: SEVERITIES.includes(severity) ? severity : 'P2',
      branches,
      files: toList(r.files),
      description: String(r.description || '').trim(),
    });
  }
  return { limits, ignore, rules };
}

export function loadConfig(path) {
  if (!fs.existsSync(path)) {
    warn(`未找到规则文件 ${path}，仅进行通用检查`);
    return normalizeConfig({});
  }
  return normalizeConfig(yaml.load(fs.readFileSync(path, 'utf8')) || {});
}

// 不含 / 的模式（如 *.lock）匹配任意目录下的同名文件
const GLOB_OPTS = { dot: true, matchBase: true };
export const matchAny = (path, globs) => globs.some((g) => minimatch(path, g, GLOB_OPTS));

// 分支正则匹配 PR 的目标分支
export function ruleApplies(rule, baseBranch, path) {
  if (rule.branches.length && !rule.branches.some((re) => re.test(baseBranch))) return false;
  if (rule.files.length && !matchAny(path, rule.files)) return false;
  return true;
}

export function renderRules(rules) {
  return rules
    .map((r) => `### [${r.id}] ${r.title}（默认等级：${SEVERITY_EMOJI[r.severity]} ${r.severity}）\n${r.description}`)
    .join('\n\n');
}

// 给 diff 标注新文件行号，并返回可评论的行号区间（如 "10-25,40-52"）
export function annotatePatch(patch) {
  const out = [];
  const commentable = [];
  let newLine = 0;
  for (const raw of patch.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      out.push(raw);
    } else if (raw === '' || raw.startsWith('\\')) {
      // 末尾空行或 "\ No newline at end of file"
    } else if (raw[0] === '-') {
      out.push(`${' '.repeat(6)} - ${raw.slice(1)}`);
    } else {
      const mark = raw[0] === '+' ? '+' : ' ';
      out.push(`${String(newLine).padStart(6)} ${mark} ${raw.slice(1)}`);
      commentable.push(newLine++);
    }
  }
  return { text: out.join('\n'), ranges: toRanges(commentable) };
}

export function toRanges(lines) {
  const ranges = [];
  for (const n of lines) {
    const last = ranges[ranges.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else ranges.push([n, n]);
  }
  return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');
}

export function numberSource(content, maxChars) {
  const lines = content.split('\n');
  const width = String(lines.length).length;
  const numbered = lines.map((l, i) => `${String(i + 1).padStart(width)}| ${l}`).join('\n');
  if (numbered.length > maxChars) {
    return `（文件过大，共 ${lines.length} 行，未提供完整内容，请仅根据 diff 审查）`;
  }
  return numbered;
}

export function selectFiles(prFiles, config, baseBranch) {
  const { limits, ignore, rules } = config;
  const skipped = [];
  const candidates = [];
  for (const f of prFiles) {
    const changes = f.additions + f.deletions;
    const skip = (reason) => skipped.push({ path: f.filename, reason });
    if (f.status === 'removed') skip('文件已删除');
    else if (matchAny(f.filename, ignore)) skip('匹配忽略列表');
    else if (!f.patch) skip('无文本 diff（二进制、纯重命名或 diff 过大）');
    else if (changes > limits.max_file_changes) skip(`变更 ${changes} 行，超过单文件上限 ${limits.max_file_changes} 行`);
    else {
      const applicable = rules.filter((r) => ruleApplies(r, baseBranch, f.filename));
      candidates.push({ file: f, changes, rules: applicable });
    }
  }

  // 优先审查命中自定义规则的文件，其次是改动多的文件
  candidates.sort((a, b) => (b.rules.length > 0) - (a.rules.length > 0) || b.changes - a.changes);

  const selected = [];
  let total = 0;
  for (const c of candidates) {
    if (selected.length >= limits.max_files) {
      skipped.push({ path: c.file.filename, reason: `超过单次审查文件数上限 ${limits.max_files}` });
    } else if (total + c.changes > limits.max_total_changes) {
      skipped.push({ path: c.file.filename, reason: `超过单次审查总变更行数上限 ${limits.max_total_changes}` });
    } else {
      selected.push(c);
      total += c.changes;
    }
  }
  return { selected, skipped };
}

export function formatCommits(commits, maxCommits) {
  const recent = commits.slice(-maxCommits);
  const lines = recent.map((c) => {
    const login = c.author?.login ? ` (@${c.author.login})` : '';
    const message = c.commit.message.trim().split('\n').map((l) => `  ${l}`).join('\n');
    return `- \`${c.sha.slice(0, 7)}\` 作者：${c.commit.author?.name || '未知'}${login}\n${message}`;
  });
  if (commits.length > recent.length) lines.unshift(`（共 ${commits.length} 个 commit，仅列出最近 ${recent.length} 个）`);
  return lines.join('\n');
}

// 本次推送的 commit：synchronize 事件取 before...after，其余情况取 PR 全部 commit
async function getPushCommits(gh, owner, repo, event) {
  if (event.action === 'synchronize' && event.before && event.after) {
    try {
      const { data } = await gh.repos.compareCommitsWithBasehead({
        owner, repo, basehead: `${event.before}...${event.after}`,
      });
      if (data.status === 'ahead' && data.commits.length) return data.commits;
    } catch (e) {
      warn(`获取本次推送的 commit 失败（可能是 force push），改用 PR 全部 commit：${e.message}`);
    }
  }
  return gh.paginate(gh.pulls.listCommits, { owner, repo, pull_number: event.pull_request.number, per_page: 100 });
}

async function fetchRaw(request) {
  try {
    const { data } = await request;
    return typeof data === 'string' ? data : null;
  } catch (e) {
    if (e.status !== 404) warn(`读取文件失败：${e.message}`);
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function finishedOutputs(status, outputs, error) {
  if (status !== 'succeeded') throw new Error(`Dify 工作流状态 ${status}：${error || ''}`);
  return typeof outputs === 'string' ? JSON.parse(outputs) : outputs;
}

export async function runDifyWorkflow(inputs, user) {
  const base = (process.env.DIFY_BASE_URL || 'https://api.dify.ai/v1').replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${requireEnv('DIFY_API_KEY')}`, 'Content-Type': 'application/json' };
  // 用 streaming 模式，避免长时间运行时 blocking 请求超时
  const res = await fetch(`${base}/workflows/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ inputs, response_mode: 'streaming', user }),
  });
  if (!res.ok) throw new Error(`Dify 请求失败 ${res.status}：${await res.text()}`);

  let runId = null;
  try {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const evt = JSON.parse(line.slice(5).trim());
          runId ??= evt.workflow_run_id || null;
          if (evt.event === 'error') throw new Error(`Dify 运行出错：${evt.message || JSON.stringify(evt)}`);
          if (evt.event === 'workflow_finished') {
            return finishedOutputs(evt.data.status, evt.data.outputs, evt.data.error);
          }
        }
      }
    }
    warn('Dify 流式连接已关闭，但未收到 workflow_finished 事件');
  } catch (e) {
    if (e.message.startsWith('Dify ')) throw e;
    warn(`Dify 流式连接中断：${e.message}`);
  }

  // 连接中断时工作流仍在 Dify 端运行，改为按运行 ID 轮询结果
  if (!runId) throw new Error('Dify 连接中断，且未拿到 workflow_run_id，无法继续获取结果');
  console.log(`改为轮询 Dify 运行结果：${runId}`);
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(10000);
    const r = await fetch(`${base}/workflows/run/${runId}`, { headers });
    if (!r.ok) {
      warn(`查询 Dify 运行状态失败 ${r.status}，稍后重试`);
      continue;
    }
    const run = await r.json();
    if (run.status === 'running') continue;
    return finishedOutputs(run.status, run.outputs, run.error);
  }
  throw new Error(`等待 Dify 运行结果超时：${runId}`);
}

async function postReview(gh, owner, repo, pr, headSha, body, comments) {
  const base = { owner, repo, pull_number: pr.number, commit_id: headSha, event: 'COMMENT' };
  try {
    await gh.pulls.createReview({ ...base, body, comments });
  } catch (e) {
    if (e.status !== 422 || !comments.length) throw e;
    // 行号不在 diff 范围内时 GitHub 会拒绝整个 review，降级为把行间评论写进正文
    warn(`行间评论发布失败，降级为正文：${e.message}`);
    const fallback = comments
      .map((c) => `#### \`${c.path}\` 第 ${c.start_line ? `${c.start_line}-` : ''}${c.line} 行\n${c.body}`)
      .join('\n\n');
    const merged = `${body}\n\n### 💬 行间评论（发布失败，汇总于此）\n\n${fallback}`;
    await gh.pulls.createReview({ ...base, body: truncate(merged, 65000) });
  }
}

// 审查失败时，把失败原因和模型原始输出的首尾片段打印到 Actions 日志（不发到 PR）
export function printDiagnostics(debugJson) {
  let debug;
  try {
    debug = JSON.parse(debugJson || '{}');
  } catch {
    return;
  }
  for (const f of debug.failed || []) {
    warn(`审查失败：${f.path}（Dify 迭代 ${f.iteration}）—— ${f.error}`);
    console.log(`::group::${f.path} 的模型原始输出（共 ${f.raw_length ?? 0} 字符）`);
    console.log(`----- 开头 -----\n${f.raw_head || '（无）'}`);
    if (f.raw_tail) console.log(`----- 结尾 -----\n${f.raw_tail}`);
    console.log('::endgroup::');
  }
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

async function main() {
  const event = JSON.parse(fs.readFileSync(requireEnv('GITHUB_EVENT_PATH'), 'utf8'));
  const pr = event.pull_request;
  const [owner, repo] = requireEnv('GITHUB_REPOSITORY').split('/');
  const gh = new Octokit({ auth: requireEnv('GITHUB_TOKEN') });
  const config = loadConfig(process.env.RULES_PATH || '.github/review-rules.yaml');
  const { limits } = config;
  const baseBranch = pr.base.ref;
  const headSha = pr.head.sha;

  const prFiles = await gh.paginate(gh.pulls.listFiles, { owner, repo, pull_number: pr.number, per_page: 100 });
  const { selected, skipped } = selectFiles(prFiles, config, baseBranch);
  console.log(`PR 共 ${prFiles.length} 个文件，审查 ${selected.length} 个，跳过 ${skipped.length} 个`);

  const files = await Promise.all(
    selected.map(async ({ file, rules }) => {
      const { text, ranges } = annotatePatch(file.patch);
      const source = await fetchRaw(gh.repos.getContent({
        owner, repo, path: file.filename, ref: headSha, mediaType: { format: 'raw' },
      }));
      return {
        path: file.filename,
        status: file.status,
        diff: truncate(text, limits.max_diff_chars),
        ranges,
        source: source == null ? '（无法获取文件内容，请仅根据 diff 审查）' : numberSource(source, limits.max_source_chars),
        rules_text: renderRules(rules),
        rule_ids: rules.map((r) => r.id).join(','),
      };
    }),
  );

  // Dify 日志里迭代只显示序号，这里打印对照表方便排查
  if (files.length) {
    console.log('::group::Dify 迭代序号 → 文件');
    files.forEach((f, i) => console.log(`迭代 ${i + 1} → ${f.path}`));
    console.log('::endgroup::');
  }

  if (!files.length) {
    const body = `<!-- ai-code-review -->\n## 🤖 AI 代码审查报告\n\n**Commit**：\`${headSha}\`\n\n本次没有需要审查的文件（共 ${skipped.length} 个文件被跳过）。`;
    await postReview(gh, owner, repo, pr, headSha, body, []);
    return;
  }

  const commits = await getPushCommits(gh, owner, repo, event);
  const readme = await fetchRaw(gh.repos.getReadme({ owner, repo, ref: headSha, mediaType: { format: 'raw' } }));

  const inputs = {
    repo: `${owner}/${repo}`,
    pr_title: pr.title.slice(0, 256),
    pr_description: truncate(pr.body || '（无描述）', limits.max_description_chars),
    base_branch: baseBranch,
    head_branch: pr.head.ref,
    head_sha: headSha,
    commits_text: formatCommits(commits, limits.max_commits),
    readme: readme ? truncate(readme, limits.max_readme_chars) : '（仓库没有 README）',
    files_json: JSON.stringify(files),
    rules_index: JSON.stringify(Object.fromEntries(config.rules.map((r) => [r.id, r.title]))),
    skipped_files_json: JSON.stringify(skipped),
  };

  const outputs = await runDifyWorkflow(inputs, `github:${owner}/${repo}`);
  if (!outputs?.review_body) throw new Error(`Dify 输出缺少 review_body：${JSON.stringify(outputs)}`);
  printDiagnostics(outputs.debug_json);
  const comments = JSON.parse(outputs.comments_json || '[]');
  await postReview(gh, owner, repo, pr, headSha, outputs.review_body, comments);
  console.log(`已发布审查：${outputs.issue_count ?? '?'} 个问题，${comments.length} 条行间评论`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.log(`::error::${e.message}`);
    process.exit(1);
  });
}
