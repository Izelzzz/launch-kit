#!/usr/bin/env node
// 用法：launch-kit <仓库地址> [--platform twitter,xiaohongshu] [--json]
import { generate } from "./generate.js";
import { loadLlmConfig } from "./llm.js";
import { findPlatforms } from "./platforms.js";
import { fetchRepo, parseRepoUrl } from "./repo.js";

function parseArgs(argv: string[]): { repo: string; platforms: string[]; json: boolean } {
  let repo = "";
  let platforms: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--platform") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new Error("--platform 需要指定平台列表，例如 --platform twitter,xiaohongshu");
      }
      platforms = value.split(",").map((p) => p.trim()).filter(Boolean);
    }
    else if (arg === "--json") json = true;
    else if (!repo) repo = arg;
  }
  if (!repo) throw new Error("用法：launch-kit <仓库地址> [--platform twitter,xiaohongshu] [--json]");
  return { repo, platforms, json };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const platforms = findPlatforms(args.platforms);
  const config = loadLlmConfig();

  // 只使用解析出的 owner/repo，地址中可能带有的凭据不会被打印或传出
  const { owner, name } = parseRepoUrl(args.repo);
  console.error(`📖 读取仓库 ${owner}/${name} …`);
  const repo = await fetchRepo(`${owner}/${name}`);
  console.error(`✍️  生成 ${platforms.length} 个平台的文案 …`);
  const copies = await generate(config, repo, platforms);
  if (copies.some((c) => c.error)) process.exitCode = 1;

  if (args.json) {
    console.log(JSON.stringify(copies, null, 2));
    return;
  }
  for (const copy of copies) {
    if (copy.error) {
      console.log(`\n=== ${copy.platform} ===\n❌ 生成失败：${copy.error}`);
      continue;
    }
    const warn = copy.overLimit ? "  ⚠️ 超出长度上限" : "";
    console.log(`\n=== ${copy.platform}（${copy.length} 字符）${warn} ===\n${copy.text}`);
  }
}

main().catch((err: unknown) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
