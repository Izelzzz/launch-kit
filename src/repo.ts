// 读取仓库信息：目前支持 GitHub 公开/私有仓库
export interface RepoInfo {
  owner: string;
  name: string;
  description: string;
  homepage: string;
  stars: number;
  topics: string[];
  languages: string[];
  readme: string;
}

const MAX_README_CHARS = 12000;

// 支持：owner/repo、github.com/owner/repo、https://(www.)github.com/owner/repo（可带 .git、子页面、?query、#hash），
// 以及 git@github.com:owner/repo.git
export function parseRepoUrl(input: string): { owner: string; name: string } {
  const raw = input.trim();
  let segments: string[];
  const ssh = raw.match(/^git@github\.com:(.+)$/i);
  if (ssh) {
    segments = ssh[1].replace(/\/+$/, "").split("/");
  } else if (/^(?:https?:\/\/)?(?:www\.)?github\.com\//i.test(raw)) {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    segments = url.pathname.split("/").filter(Boolean).slice(0, 2);
  } else {
    segments = raw.replace(/\/+$/, "").split("/");
  }

  const owner = segments[0];
  const name = segments[1]?.replace(/\.git$/, "");
  const isValid = (s: string | undefined) => !!s && /^[\w.-]+$/.test(s) && !/^\.+$/.test(s);
  if (segments.length !== 2 || !isValid(owner) || !isValid(name)) {
    throw new Error(`无法识别的仓库地址：${input}（示例：https://github.com/owner/repo 或 owner/repo）`);
  }
  return { owner, name: name! };
}

async function githubGet(path: string, accept = "application/vnd.github+json"): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept, "User-Agent": "launch-kit" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return fetch(`https://api.github.com${path}`, { headers });
}

export async function fetchRepo(input: string): Promise<RepoInfo> {
  const { owner, name } = parseRepoUrl(input);
  const base = `/repos/${owner}/${name}`;

  const repoRes = await githubGet(base);
  if (!repoRes.ok) throw new Error(`读取仓库失败（HTTP ${repoRes.status}）：${owner}/${name}`);
  const repo = (await repoRes.json()) as {
    description: string | null;
    homepage: string | null;
    stargazers_count: number;
    topics?: string[];
  };

  const [langRes, readmeRes] = await Promise.all([
    githubGet(`${base}/languages`),
    githubGet(`${base}/readme`, "application/vnd.github.raw"),
  ]);
  const languages = langRes.ok ? Object.keys((await langRes.json()) as Record<string, number>) : [];
  const readme = readmeRes.ok ? (await readmeRes.text()).slice(0, MAX_README_CHARS) : "";

  return {
    owner,
    name,
    description: repo.description ?? "",
    homepage: repo.homepage ?? "",
    stars: repo.stargazers_count,
    topics: repo.topics ?? [],
    languages,
    readme,
  };
}
