# AI 分流范围

四个 AI 组共用美国、日本、新加坡候选地区，排除港澳标签、订阅信息和 Tailscale 节点。节点名用于筛选，不能证明实际出口地区或服务可用性。

| 代理组 | 选择方式 | 主要范围 |
| --- | --- | --- |
| `OpenAI` | 自动测速选择 | ChatGPT、OpenAI API、Codex、Sora |
| `Anthropic` | 手动固定节点 | Claude、Anthropic API、Claude Code、Cowork |
| `✨ Gemini` | 手动固定节点 | Gemini、AI Studio、NotebookLM，以及上游覆盖的其他 Google AI 服务和 Antigravity |
| `🤖 国际 AI` | 自动测速选择 | 其余上游 AI 规则 |

四个 AI 组没有候选节点时都使用 `REJECT`，避免回退直连。客户端支持进程识别时，进程规则覆盖对应应用的连接。

## 上游与匹配顺序

专属规则集位于国际 AI 和国外服务规则之前。广告、成人内容等更早的规则仍然优先。

- OpenAI 的域名规则来自 [MetaCubeX openai](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/openai.yaml)。进程及 IP 规则来自 [VPSDance openai](https://github.com/VPSDance/ai-proxy-rules/blob/main/rules/clash/openai.yaml)。
- Anthropic 的域名规则来自 [MetaCubeX anthropic](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/anthropic.yaml)。进程及 IP 规则来自 [VPSDance anthropic](https://github.com/VPSDance/ai-proxy-rules/blob/main/rules/clash/anthropic.yaml)。
- Gemini 合并 [MetaCubeX google-gemini](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/google-gemini.yaml) 和 [VPSDance google-ai](https://github.com/VPSDance/ai-proxy-rules/blob/main/rules/clash/google-ai.yaml)。
- 国际 AI 继续合并 [VPSDance global](https://github.com/VPSDance/ai-proxy-rules/blob/main/rules/clash/global.yaml)、[Sukka Apple Intelligence](https://github.com/SukkaLab/ruleset.skk.moe/blob/master/Clash/non_ip/apple_intelligence.txt) 和 [MetaCubeX category-ai-!cn](https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/category-ai-!cn.yaml)。

OpenAI 和 Anthropic 对 VPSDance 输入设置 `include_rule_types`，只保留 `PROCESS-NAME`、`IP-CIDR`、`IP-CIDR6` 和 `IP-ASN`。这避免将上游的 `auth0.com`、`sentry.io` 等宽泛共享域名加入专属组。生成文件的注释记录来源、许可证和筛选类型。Gemini 保留原有上游范围。

通用 AI 文件仍保留重复条目。它们与专属规则重叠时，由更早的专属组处理。专属规则未覆盖的域名、共享依赖和关键词仍可命中国际 AI，例如 `ai.com`、部分 MCP 域名以及通用上游的共享遥测域名。拆分没有删除这些上游规则。

## 国际 AI 剩余服务

以下服务的代表域名在 2026-11-25 的构建产物中命中国际 AI。表格按服务归类，不表示服务的所有域名都使用同一出口。

| 类别 | 服务 |
| --- | --- |
| 对话与搜索 | Perplexity、Grok / xAI、Microsoft Copilot、Poe、Character.AI、Meta AI、Mistral、Cohere、You.com、Phind、Duck.ai、Pi / Inflection、Genspark |
| 编程助手 | GitHub Copilot、Cursor、Windsurf、Augment Code、Devin、Factory、JetBrains AI、Kilo Code、Kiro、Amazon Q、Replit、Bolt、Lovable、v0、Cline、Continue、Tabnine、Sourcegraph / Cody / Amp、CodeRabbit、Zed、Command Code、Qoder、OpenCode |
| 模型与推理平台 | Hugging Face、OpenRouter、Groq、Cerebras、Together AI、Replicate、Fireworks、Chutes、Cloudflare AI、DeepInfra、Novita、H2O.ai、LM Studio、Ollama、LMArena / Arena、Artificial Analysis |
| 图像与视频 | Midjourney、Stability AI、Black Forest Labs、Civitai、Runway、Pika、Adobe Firefly、Clipdrop、Recraft、Ideogram、Leonardo、Luma、HeyGen、OpenArt、NovelAI、Tripo3D、ComfyUI、Lovart |
| 音频与内容工具 | Suno、Udio、ElevenLabs、Synthesia、Descript、Otter、Gamma、Grammarly、Jasper、YouMind、Sider |
| Agent 与开发工具 | Manus、Dify、LangChain、CrewAI、OpenClaw、AnythingLLM、Context7 |
| 其他 | Apple Intelligence、Coze / Cici、Trae，以及上游包含的 Kimi、MiniMax 海外域名 |

进程规则中，Augment、Cursor、Windsurf 仍由国际 AI 处理。OpenAI、Anthropic、Antigravity 的对应进程规则已由前面的专属组接管。进程识别取决于客户端、系统权限和核心支持。

## 复核当前上游

使用空目录或构建脚本认可的产物目录。将报告放在产物目录之外。

```powershell
node scripts/build.mjs --output-dir <build-directory>
node scripts/audit-ai-rules.mjs <build-directory>/rules
node scripts/audit-ai-rules.mjs <build-directory>/rules --list
```

[核查脚本](<../scripts/audit-ai-rules.mjs>) 按配置顺序比较四个 AI provider，输出代表域名、进程和专用网络条目的归属，并校验 OpenAI 与 Anthropic 的主要条目。`--list` 另输出通用 AI 的原始规则，包括已被前面专属规则接管的重叠条目。

域名核查不模拟 DNS、IP、进程匹配、前置拦截或真实连接。网络条目核查验证规则存在及 provider 优先顺序，不模拟 CIDR 或 ASN 查询。上游更新后服务范围会变化，需重新构建复核。

新增规则集时先发布规则，再发布订阅模板，最后更新客户端订阅。
