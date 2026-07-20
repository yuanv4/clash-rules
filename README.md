# clash-rules

维护自用 Mihomo / Clash Meta 规则产物。

- `main` / `master`：源码与 GitHub Actions
- `release`：可直接引用的发布产物

### 在线地址（URL）

- [https://raw.githubusercontent.com/yuanv4/clash-rules/release/clash-rules.js](https://raw.githubusercontent.com/yuanv4/clash-rules/release/clash-rules.js)
- [https://cdn.jsdelivr.net/gh/yuanv4/clash-rules@release/clash-rules.js](https://cdn.jsdelivr.net/gh/yuanv4/clash-rules@release/clash-rules.js)

### 自维护规则

当前发布：
`clash-rules.js`

其中：
- `clash-rules.js` 用于 Mihomo / Clash Meta 的 `script` 覆写，会生成完整 profile 所需的基础策略组，并通过 `rule-providers` 动态引用社区规则 URL
- AI 泛用分流（含 Claude）直接使用 SukkaW 的 `ai.txt` 与 `apple_intelligence.txt`，社区规则未覆盖的域名由 `rules/ai/manual.txt` 在构建时注入补充
- 直连补充规则（如 Tailscale 控制面）由 `rules/direct/manual.txt` 在构建时注入补充
- YouTube 提供独立可手选策略组；Microsoft 仍作为通用兜底组

维护文件位于 [rules/](rules/) 目录。