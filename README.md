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
- `clash-rules.js` 用于 Mihomo / Clash Meta 的 `script` 覆写，会生成完整 profile 所需的基础策略组，并通过 `rule-providers` 动态引用社区规则 URL
- `subconverter.yaml` 用于 subconverter 外部配置直接引用
- `claude.yaml` 由 `blackmatrix7/ios_rule_script` 的 Claude 规则加本地补充生成
- `ai.yaml` 为 `Claude + OpenAI + Gemini` 聚合产物，供 AI 分流组直接复用

维护文件位于 [rules/](rules/) 目录。

### 脚本参数

`clash-rules.js` 默认引用：

- 社区规则：`https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release`
- 本仓库增量规则：`https://raw.githubusercontent.com/yuanv4/clash-rules/release`

如需换成代理地址或镜像，可在 Sub-Store 脚本链接后追加参数：

```text
https://raw.githubusercontent.com/yuanv4/clash-rules/refs/heads/release/clash-rules.js#communityBase=https%3A%2F%2Fexample.com%2Fcommunity&localBase=https%3A%2F%2Fexample.com%2Flocal
```
