// 各平台的文案规范：长度上限与风格要求
export interface Platform {
  id: string;
  name: string;
  maxLength: number;
  style: string;
}

export const PLATFORMS: Platform[] = [
  {
    id: "twitter",
    name: "X / Twitter",
    maxLength: 280,
    style: "英文，一条推文，开头一句抓住痛点，可带 1–2 个 hashtag 和仓库链接",
  },
  {
    id: "producthunt",
    name: "Product Hunt Tagline",
    maxLength: 60,
    style: "英文，一句话说清产品是什么、给谁用，不要用感叹号",
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    maxLength: 1000,
    style: "中文，标题加正文，口语化、分点列出亮点，结尾加 3–5 个话题标签",
  },
];

export function findPlatforms(ids: string[]): Platform[] {
  if (ids.length === 0) return PLATFORMS;
  return ids.map((id) => {
    const platform = PLATFORMS.find((p) => p.id === id);
    if (!platform) throw new Error(`不支持的平台：${id}（可选：${PLATFORMS.map((p) => p.id).join(", ")}）`);
    return platform;
  });
}
