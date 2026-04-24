# clash-rules

维护自用 Mihomo / Clash Meta 规则产物。

- `main` / `master`：源码与 GitHub Actions
- `release`：可直接引用的发布产物

### 在线地址（URL）

- [https://raw.githubusercontent.com/yuanv4/clash-rules/release/clash-rules.js](https://raw.githubusercontent.com/yuanv4/clash-rules/release/clash-rules.js)
- [https://cdn.jsdelivr.net/gh/yuanv4/clash-rules@release/clash-rules.js](https://cdn.jsdelivr.net/gh/yuanv4/clash-rules@release/clash-rules.js)
- [https://raw.githubusercontent.com/yuanv4/clash-rules/release/subconverter.yaml](https://raw.githubusercontent.com/yuanv4/clash-rules/release/subconverter.yaml)

### 自维护规则

当前发布：
`clash-rules.js`、`subconverter.yaml`、`claude.yaml`、`ai.yaml`

其中：
- `clash-rules.js` 用于 Mihomo / Clash Meta 的 `script` 覆写
- `subconverter.yaml` 用于 subconverter 外部配置直接引用
- `claude.yaml` 由 `blackmatrix7/ios_rule_script` 的 Claude 规则加本地补充生成
- `ai.yaml` 为 `Claude + OpenAI + Gemini` 聚合产物，供 AI 分流组直接复用

维护文件位于 [rules/](rules/) 目录。
