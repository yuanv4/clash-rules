# AI 分流范围

扩展脚本按节点名称筛选候选地区。`✨ Google / Gemini` 使用美国节点，`🤖 通用 AI` 使用美国、日本、新加坡节点。`🧠 OpenAI` 和 `🧩 Anthropic` 使用台湾、日本、新加坡节点，同时排除带美国标签的混合名称。各 AI 组排除港澳标签、订阅信息和项目 Tailscale 节点。节点名不能证明实际出口地区或服务可用性。客户端直接显示表中的组名，不添加项目前缀。

| 代理组 | 选择方式 | 主要范围 |
| --- | --- | --- |
| `✨ Google / Gemini` | 手动固定节点 | Google 域名和 IP、Gemini、AI Studio、NotebookLM，以及上游覆盖的其他 Google AI 服务和 Antigravity |
| `🧠 OpenAI` | 自动测速选择 | ChatGPT、OpenAI API、Codex、Sora |
| `🧩 Anthropic` | 手动固定节点 | Claude、Anthropic API、Claude Code、Cowork |
| `🤖 通用 AI` | 自动测速选择 | 其余上游 AI 服务 |

各 AI 组没有符合条件的节点时使用 `REJECT`。客户端支持进程识别时，进程规则覆盖对应应用的连接。

## 上游与匹配顺序

Google 与 Gemini 共用 `gemini` 规则集和手动代理组。该规则集位于通用 AI 和国外服务规则之前，直连、广告、成人内容等前置规则仍然优先。

- `gemini` 按顺序合并 [MetaCubeX google-gemini](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/google-gemini.yaml)、[VPSDance google-ai](https://github.com/VPSDance/ai-proxy-rules/blob/main/rules/clash/google-ai.yaml)、[MetaCubeX Google 域名](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/google.yaml) 和 [MetaCubeX Google IP](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geoip/google.yaml)。
- `openai` 和 `anthropic` 分别合并 MetaCubeX 的 [openai](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/openai.yaml)、[anthropic](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/anthropic.yaml) 域名规则和 VPSDance 的 [openai](https://github.com/VPSDance/ai-proxy-rules/blob/main/rules/clash/openai.yaml)、[anthropic](https://github.com/VPSDance/ai-proxy-rules/blob/main/rules/clash/anthropic.yaml) 进程及 IP 规则。
- 通用 AI 合并 [VPSDance global](https://github.com/VPSDance/ai-proxy-rules/blob/main/rules/clash/global.yaml)、[Sukka Apple Intelligence](https://github.com/SukkaLab/ruleset.skk.moe/blob/master/Clash/non_ip/apple_intelligence.txt) 和 [MetaCubeX category-ai-!cn](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/category-ai-!cn.yaml)。

OpenAI 和 Anthropic 的 VPSDance 专属输入设置 `include_rule_types`，只保留 `PROCESS-NAME`、`IP-CIDR`、`IP-CIDR6` 和 `IP-ASN`，不额外引入其中的 `auth0.com`、`sentry.io` 等宽泛共享域名。通用 AI 保留原有综合上游范围。生成文件的注释记录来源、许可证和筛选类型。

规则按 `gemini`、`openai`、`anthropic`、`ai` 的顺序匹配。通用 AI 文件保留与专属规则重复的条目；前置规则没有匹配时，重叠条目由更早的专属组处理。其余域名、共享依赖和关键词继续使用通用 AI。

## 通用 AI 覆盖的服务

以下服务的代表域名由通用 AI 处理。表格按服务归类，不表示服务的所有域名都使用同一出口。

| 类别 | 服务 |
| --- | --- |
| 对话与搜索 | Perplexity、Grok / xAI、Microsoft Copilot、Poe、Character.AI、Meta AI、Mistral、Cohere、You.com、Phind、Duck.ai、Pi / Inflection、Genspark |
| 编程助手 | GitHub Copilot、Cursor、Windsurf、Augment Code、Devin、Factory、JetBrains AI、Kilo Code、Kiro、Amazon Q、Replit、Bolt、Lovable、v0、Cline、Continue、Tabnine、Sourcegraph / Cody / Amp、CodeRabbit、Zed、Command Code、Qoder、OpenCode |
| 模型与推理平台 | Hugging Face、OpenRouter、Groq、Cerebras、Together AI、Replicate、Fireworks、Chutes、Cloudflare AI、DeepInfra、Novita、H2O.ai、LM Studio、Ollama、LMArena / Arena、Artificial Analysis |
| 图像与视频 | Midjourney、Stability AI、Black Forest Labs、Civitai、Runway、Pika、Adobe Firefly、Clipdrop、Recraft、Ideogram、Leonardo、Luma、HeyGen、OpenArt、NovelAI、Tripo3D、ComfyUI、Lovart |
| 音频与内容工具 | Suno、Udio、ElevenLabs、Synthesia、Descript、Otter、Gamma、Grammarly、Jasper、YouMind、Sider |
| Agent 与开发工具 | Manus、Dify、LangChain、CrewAI、OpenClaw、AnythingLLM、Context7 |
| 其他 | Apple Intelligence、Coze / Cici、Trae，以及上游包含的 Kimi、MiniMax 海外域名 |

进程规则中，ChatGPT、Codex 由 OpenAI 处理，Claude、Cowork 由 Anthropic 处理，Augment、Cursor、Windsurf 由通用 AI 处理，Antigravity 由 Google / Gemini 处理。前置规则仍然优先。进程识别取决于客户端、系统权限和核心支持。

## 复核当前上游

使用空目录或构建脚本认可的产物目录。将报告放在产物目录之外。

```powershell
node scripts/build.mjs --output-dir <build-directory>
node scripts/audit-ai-rules.mjs <build-directory>/rules
node scripts/audit-ai-rules.mjs <build-directory>/rules --list
```

[核查脚本](<../scripts/audit-ai-rules.mjs>) 按配置顺序比较四个 AI provider，输出代表域名、进程和专用网络条目的归属，并校验 OpenAI 和 Anthropic 条目进入各自专属组。`--list` 另输出通用 AI 的原始规则，包括已被前面专属规则接管的重叠条目。

域名核查不模拟 DNS、IP、进程匹配、前置拦截或真实连接。网络条目核查验证规则存在及 provider 优先顺序，不模拟 CIDR 或 ASN 查询。上游更新后服务范围会变化，需重新构建复核。

新增或合并规则来源时，发布流程会在同一次提交中发布规则集和扩展脚本，再在客户端同步脚本。脚本完整覆盖官方分流规则、代理组和规则集，保留官方 DNS、hosts 和节点；原机场规则不再参与匹配。release 分支发布新的 Anthropic 和 OpenAI 规则文件，并继续保留历史开发服务规则文件。
