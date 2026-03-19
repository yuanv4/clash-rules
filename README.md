# clash-rules

基于 `Loyalsoldier/clash-rules` 的发布方式维护自用 Mihomo / Clash Meta 规则产物。

- `main` / `master`：源码与 GitHub Actions
- `release`：可直接引用的发布产物

本仓库维护两类内容：

- 覆写脚本：[src/clash-rules.js](src/clash-rules.js)
- 自维护规则集：`claude.txt`、`openai.txt`、`gemini.txt`

## 目录

- [src/clash-rules.js](src/clash-rules.js)：覆写脚本源码
- [scripts/publish.ps1](scripts/publish.ps1)：构建脚本
- [rules/claude/manual.txt](rules/claude/manual.txt)
- [rules/claude/exclude.txt](rules/claude/exclude.txt)
- [rules/openai/manual.txt](rules/openai/manual.txt)
- [rules/openai/exclude.txt](rules/openai/exclude.txt)
- [rules/gemini/manual.txt](rules/gemini/manual.txt)
- [rules/gemini/exclude.txt](rules/gemini/exclude.txt)

## 数据源

基础规则：

- `Loyalsoldier/clash-rules`
  - 仓库：<https://github.com/Loyalsoldier/clash-rules>
  - 使用：`reject`、`private`、`applications`、`lancidr`、`icloud`、`apple`、`google`、`telegramcidr`、`direct`、`cncidr`、`proxy`、`gfw`、`tld-not-cn`
- `ACL4SSR/ACL4SSR`
  - 仓库：<https://github.com/ACL4SSR/ACL4SSR>
  - 使用：`BanEasyListChina`、`BanEasyList`、`OneDrive`、`GoogleCN`、`ChinaMedia`、`ChinaDomain`

自维护规则：

- `claude.txt`
  - 本地：[rules/claude/manual.txt](rules/claude/manual.txt)
  - 上游：<https://github.com/blackmatrix7/ios_rule_script>
  - 文件：`rule/Clash/Claude/Claude.yaml`
  - 排除：[rules/claude/exclude.txt](rules/claude/exclude.txt)
- `openai.txt`
  - 本地：[rules/openai/manual.txt](rules/openai/manual.txt)
  - 上游：<https://github.com/blackmatrix7/ios_rule_script>
  - 文件：`rule/Clash/OpenAI/OpenAI.yaml`
  - 排除：[rules/openai/exclude.txt](rules/openai/exclude.txt)
- `gemini.txt`
  - 本地：[rules/gemini/manual.txt](rules/gemini/manual.txt)
  - 上游：<https://github.com/blackmatrix7/ios_rule_script>
  - 文件：`rule/Clash/Gemini/Gemini.yaml`
  - 排除：[rules/gemini/exclude.txt](rules/gemini/exclude.txt)

## 发布产物

工作流会构建并推送以下文件到 `release` 分支：

- `clash-rules.js`
- `claude.txt`
- `openai.txt`
- `gemini.txt`
- `metadata.json`
- `rules-metadata.json`

## 访问地址

脚本：

- Raw: `https://raw.githubusercontent.com/yuanv4/clash-rules/release/clash-rules.js`
- CDN: `https://cdn.jsdelivr.net/gh/yuanv4/clash-rules@release/clash-rules.js`

规则：

- Raw: `https://raw.githubusercontent.com/yuanv4/clash-rules/release/claude.txt`
- CDN: `https://cdn.jsdelivr.net/gh/yuanv4/clash-rules@release/claude.txt`
- Raw: `https://raw.githubusercontent.com/yuanv4/clash-rules/release/openai.txt`
- CDN: `https://cdn.jsdelivr.net/gh/yuanv4/clash-rules@release/openai.txt`
- Raw: `https://raw.githubusercontent.com/yuanv4/clash-rules/release/gemini.txt`
- CDN: `https://cdn.jsdelivr.net/gh/yuanv4/clash-rules@release/gemini.txt`

## 使用说明

发布后的 `clash-rules.js` 用作覆写脚本。脚本会：

- 注入 DNS、Fake-IP、sniffer、TUN 默认配置
- 创建 `Claude`、`AI`、`节点选择`、`延迟选优` 等代理组
- 注入 `rule-providers` 与完整 `rules`
- 过滤订阅中的伪节点说明项

脚本中的自维护规则默认指向当前仓库：

```javascript
const SELF_RULES_REPO = "yuanv4/clash-rules";
```

如果仓库名或所有者变化，需要同步修改 [src/clash-rules.js](src/clash-rules.js) 中的 `SELF_RULES_REPO`。

## 本地构建

```powershell
pwsh ./scripts/publish.ps1
```

只验证本地文件：

```powershell
pwsh ./scripts/publish.ps1 -SkipRemoteRules
```
