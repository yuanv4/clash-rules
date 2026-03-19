# clash-rules

维护自用 Mihomo / Clash Meta 规则产物。

- `main` / `master`：源码与 GitHub Actions
- `release`：可直接引用的发布产物

### 在线地址（URL）

- [https://raw.githubusercontent.com/yuanv4/clash-rules/release/clash-rules.js](https://raw.githubusercontent.com/yuanv4/clash-rules/release/clash-rules.js)
- [https://cdn.jsdelivr.net/gh/yuanv4/clash-rules@release/clash-rules.js](https://cdn.jsdelivr.net/gh/yuanv4/clash-rules@release/clash-rules.js)

### 自维护规则：

- `claude.txt`
  - 上游：<https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash/Claude/Claude.yaml>
  - 本地：[rules/claude/manual.txt](rules/claude/manual.txt)
  - 排除：[rules/claude/exclude.txt](rules/claude/exclude.txt)
- `openai.txt`
  - 上游：<https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash/OpenAI/OpenAI.yaml>
  - 本地：[rules/openai/manual.txt](rules/openai/manual.txt)
  - 排除：[rules/openai/exclude.txt](rules/openai/exclude.txt)
- `gemini.txt`
  - 上游：<https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash/Gemini/Gemini.yaml>
  - 本地：[rules/gemini/manual.txt](rules/gemini/manual.txt)
  - 排除：[rules/gemini/exclude.txt](rules/gemini/exclude.txt)
- `cursor.txt`
  - 上游：无
  - 本地：[rules/cursor/manual.txt](rules/cursor/manual.txt)
  - 排除：[rules/cursor/exclude.txt](rules/cursor/exclude.txt)
- `openrouter.txt`
  - 上游：无
  - 本地：[rules/openrouter/manual.txt](rules/openrouter/manual.txt)
  - 排除：[rules/openrouter/exclude.txt](rules/openrouter/exclude.txt)
- `google-extra.txt`
  - 上游：无
  - 本地：[rules/google-extra/manual.txt](rules/google-extra/manual.txt)
  - 排除：[rules/google-extra/exclude.txt](rules/google-extra/exclude.txt)

## 使用说明

发布后的 `clash-rules.js` 用作覆写脚本。脚本会：

- 注入 DNS、Fake-IP、sniffer、TUN 默认配置
- 创建 `Claude`、`AI`、`节点选择`、`延迟选优` 等代理组
- 注入 `rule-providers` 与完整 `rules`
- 过滤订阅中的伪节点说明项
