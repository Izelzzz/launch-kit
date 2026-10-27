# launch-kit

输入 GitHub 仓库地址，一键生成多平台宣传文案。

- **理解仓库**：读取仓库简介、主题、语言和 README，先提炼项目画像
- **多平台文案**：按各平台的风格和长度规范生成（X / Twitter、Product Hunt、小红书）
- **自带 API Key**：支持任意 OpenAI 兼容接口（OpenAI、通义千问、DeepSeek 等），launch-kit 不经手你的密钥

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 LAUNCH_KIT_API_KEY 等配置
export $(grep -v '^#' .env | xargs)

npm start -- https://github.com/owner/repo
npm start -- owner/repo --platform twitter,xiaohongshu
npm start -- owner/repo --json
```

## 配置

| 环境变量 | 说明 |
|---|---|
| `LAUNCH_KIT_API_KEY` | 必填，模型服务的 API Key |
| `LAUNCH_KIT_BASE_URL` | OpenAI 兼容接口地址，默认 `https://api.openai.com/v1` |
| `LAUNCH_KIT_MODEL` | 模型名称，默认 `gpt-4o-mini` |
| `GITHUB_TOKEN` | 可选，用于读取私有仓库或提高 GitHub API 限额 |

## 路线图

- [x] 读取 GitHub 仓库，生成多平台文案
- [ ] 读取本地仓库
- [ ] 海报 / 图片素材
- [ ] 短视频脚本与视频生成
- [ ] Web 云端版本
