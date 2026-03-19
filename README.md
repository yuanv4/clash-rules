# clash-rules

本仓库参考 `Loyalsoldier/clash-rules` 的发布方式维护自用规则产物：

- `main` / `master` 分支保存源码和 GitHub Actions。
- `release` 分支保存可直接被 Mihomo / Clash Meta 订阅的原始规则文件。

与上游仓库不同的是，这里除了发布覆写脚本 `clash-rules.js`，还额外维护了 `Claude` 与通用 `AI` 两套自定义规则集，并在脚本里直接作为 `rule-providers` 引用。

## 仓库内容

- [src/clash-rules.js](/D:/yuanv4/clash-rules/src/clash-rules.js)：主覆写脚本源码。
- [scripts/publish.ps1](/D:/yuanv4/clash-rules/scripts/publish.ps1)：构建入口，负责复制脚本、拉取远程规则、合并本地规则、生成 `dist/*`。
- [sources/claude/manual.txt](/D:/yuanv4/clash-rules/sources/claude/manual.txt)：Claude / Anthropic 手工补充规则。
- [sources/claude/exclude.txt](/D:/yuanv4/clash-rules/sources/claude/exclude.txt)：Claude 规则排除项。
- [sources/ai/manual.txt](/D:/yuanv4/clash-rules/sources/ai/manual.txt)：通用 AI 手工补充规则。
- [sources/ai/exclude.txt](/D:/yuanv4/clash-rules/sources/ai/exclude.txt)：AI 规则排除项。
- [dist/clash-rules.js](/D:/yuanv4/clash-rules/dist/clash-rules.js)：当前构建产物中的覆写脚本。

## 数据源

本仓库实际使用到的规则源分为三类。

### 1. `Loyalsoldier/clash-rules`

`dist/clash-rules.js` 中直接引用了以下上游规则集：

- `reject`
- `private`
- `applications`
- `lancidr`
- `icloud`
- `apple`
- `google`
- `telegramcidr`
- `direct`
- `cncidr`
- `proxy`
- `gfw`
- `tld-not-cn`

这些规则的发布模式与上游仓库一致，默认通过 jsDelivr 的 `release` 分支文件地址获取。

### 2. `ACL4SSR/ACL4SSR`

脚本同时引用以下 ACL4SSR 列表：

- `BanEasyListChina`
- `BanEasyList`
- `OneDrive`
- `GoogleCN`
- `ChinaMedia`
- `ChinaDomain`

这些列表用于广告拦截、国内直连和部分常用服务分流补充。

### 3. 本仓库自维护规则

`dist/clash-rules.js` 还会从当前仓库自己的 `release` 分支加载：

- `claude.txt`
- `ai.txt`

这两个文件由 [scripts/publish.ps1](/D:/yuanv4/clash-rules/scripts/publish.ps1) 生成，规则来源如下：

- `claude.txt`
  - 本地手工补充：[sources/claude/manual.txt](/D:/yuanv4/clash-rules/sources/claude/manual.txt)
  - 远程上游：`SkywalkerJi/Clash-Rules` 的 `AI/Anthropic.yaml`
  - 本地排除：[sources/claude/exclude.txt](/D:/yuanv4/clash-rules/sources/claude/exclude.txt)
- `ai.txt`
  - 本地手工补充：[sources/ai/manual.txt](/D:/yuanv4/clash-rules/sources/ai/manual.txt)
  - 远程上游：`blackmatrix7/ios_rule_script` 的 `OpenAI.yaml` 与 `Gemini.yaml`
  - 本地排除：[sources/ai/exclude.txt](/D:/yuanv4/clash-rules/sources/ai/exclude.txt)

脚本会先规范化规则行，再去重、应用排除项，最后输出为 Clash `payload:` YAML 格式。

## 发布产物

工作流 [release.yml](/D:/yuanv4/clash-rules/.github/workflows/release.yml) 会在以下场景运行：

- 推送到 `main` 或 `master`
- 手动触发
- 每天定时构建

构建完成后会将 `dist/*` 强制推送到 `release` 分支，当前产物包括：

- `clash-rules.js`
- `claude.txt`
- `ai.txt`
- `metadata.json`
- `rules-metadata.json`

原始文件可通过以下形式访问：

```text
https://raw.githubusercontent.com/<owner>/<repo>/release/clash-rules.js
https://raw.githubusercontent.com/<owner>/<repo>/release/claude.txt
https://raw.githubusercontent.com/<owner>/<repo>/release/ai.txt
```

如果使用 jsDelivr，可替换为：

```text
https://cdn.jsdelivr.net/gh/<owner>/<repo>@release/clash-rules.js
https://cdn.jsdelivr.net/gh/<owner>/<repo>@release/claude.txt
https://cdn.jsdelivr.net/gh/<owner>/<repo>@release/ai.txt
```

## 使用方式

### 覆写脚本

将发布后的 `clash-rules.js` 作为覆写脚本使用。脚本会：

- 注入 DNS、Fake-IP、sniffer、TUN 默认配置。
- 重建代理组，如 `Claude`、`AI`、`节点选择`、`延迟选优`。
- 注入 `rule-providers` 和完整 `rules`。
- 过滤订阅里常见的伪节点说明项。

### 自维护规则集

脚本中的 `claude` 和 `ai` 规则提供者默认指向当前仓库：

```javascript
const SELF_RULES_REPO = "yuanv4/clash-rules";
```

如果你 fork、改名或迁移仓库，需要同步修改 [src/clash-rules.js](/D:/yuanv4/clash-rules/src/clash-rules.js) 里的 `SELF_RULES_REPO`。

## 本地构建

拉取远程规则并生成全部产物：

```powershell
pwsh ./scripts/publish.ps1
```

只验证本地文件、不拉取远程规则：

```powershell
pwsh ./scripts/publish.ps1 -SkipRemoteRules
```
