// Commit message 规范：Conventional Commits（https://www.conventionalcommits.org）
// 格式：<type>(<scope>): <subject>，例如 feat(cli): 支持 --json 输出
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // 标题（含 type 和 scope）不超过 72 个字符
    "header-max-length": [2, "always", 72],
  },
};
