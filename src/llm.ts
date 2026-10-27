// 调用用户自己配置的模型：兼容 OpenAI Chat Completions 协议的任意服务
export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

// 未设置或留空时都使用默认值（.env 中常见 `KEY=` 留空的写法）
function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function loadLlmConfig(): LlmConfig {
  const apiKey = process.env.LAUNCH_KIT_API_KEY?.trim();
  if (!apiKey) throw new Error("请先设置环境变量 LAUNCH_KIT_API_KEY（见 .env.example）");
  const baseUrl = envOr("LAUNCH_KIT_BASE_URL", "https://api.openai.com/v1").replace(/\/+$/, "");
  if (!URL.canParse(baseUrl)) throw new Error(`LAUNCH_KIT_BASE_URL 不是合法的 URL：${baseUrl}`);
  return { apiKey, baseUrl, model: envOr("LAUNCH_KIT_MODEL", "gpt-4o-mini") };
}

export async function chat(config: LlmConfig, system: string, user: string): Promise<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`模型调用失败（HTTP ${res.status}）：${await res.text()}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
    error?: { message?: string };
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`模型未返回有效内容：${data.error?.message ?? "响应中缺少 choices[0].message.content"}`);
  }
  return content;
}
