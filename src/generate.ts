// 生成流程：仓库信息 → 项目画像 → 各平台文案
import { chat, type LlmConfig } from "./llm.js";
import type { Platform } from "./platforms.js";
import type { RepoInfo } from "./repo.js";

export interface Copy {
  platform: string;
  text: string;
  length: number;
  overLimit: boolean;
}

const PROFILE_PROMPT = `你是一名技术产品营销专家。阅读开源项目的信息，提炼一份简洁的项目画像，供后续撰写宣传文案使用。
包括：一句话定位、目标用户、解决的核心问题、3 个最大的亮点、与同类工具的差异。
只依据给出的信息，不要编造功能或数据。`;

const COPY_PROMPT = `你是一名擅长开发者营销的文案作者。根据项目画像，为指定平台写一条宣传文案。
严格遵守平台的风格要求和长度上限，只输出文案正文，不要输出解释或引号。`;

export function describeRepo(repo: RepoInfo): string {
  return [
    `仓库：https://github.com/${repo.owner}/${repo.name}`,
    `简介：${repo.description || "（无）"}`,
    `主页：${repo.homepage || "（无）"}`,
    `Star：${repo.stars}`,
    `主题：${repo.topics.join(", ") || "（无）"}`,
    `语言：${repo.languages.join(", ") || "（无）"}`,
    "",
    "README：",
    repo.readme || "（无）",
  ].join("\n");
}

export async function buildProfile(config: LlmConfig, repo: RepoInfo): Promise<string> {
  return chat(config, PROFILE_PROMPT, describeRepo(repo));
}

export async function writeCopy(
  config: LlmConfig,
  repo: RepoInfo,
  profile: string,
  platform: Platform,
): Promise<Copy> {
  const user = [
    `平台：${platform.name}`,
    `风格要求：${platform.style}`,
    `长度上限：${platform.maxLength} 个字符`,
    `仓库链接：https://github.com/${repo.owner}/${repo.name}`,
    "",
    "项目画像：",
    profile,
  ].join("\n");
  const text = (await chat(config, COPY_PROMPT, user)).trim();
  const length = [...text].length;
  return { platform: platform.id, text, length, overLimit: length > platform.maxLength };
}

export async function generate(config: LlmConfig, repo: RepoInfo, platforms: Platform[]): Promise<Copy[]> {
  const profile = await buildProfile(config, repo);
  return Promise.all(platforms.map((p) => writeCopy(config, repo, profile, p)));
}
