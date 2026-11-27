# clash-rules

为 FlClash / Mihomo 发布公开规则集和客户端扩展脚本。机场完整订阅由客户端直接导入，仓库不读取机场链接、不生成完整订阅，也不需要 Cloudflare 或机场凭据。

```text
公开规则源 → GitHub Actions → release 分支的规则集和扩展脚本
机场完整订阅 → FlClash → 扩展脚本叠加项目分流 → Mihomo
```

## 使用

1. 在 FlClash 中导入机场提供的完整配置订阅，并选中该配置。
2. 从下表选择一个脚本，通过 URL 导入 FlClash 的脚本列表。
3. 在这份官方订阅的扩展设置中绑定脚本，并使用规则模式。
4. 查看最终配置，确认官方 DNS、hosts 和节点仍在，分流规则已换成项目规则，并出现 `通用 AI`、`Google` 等项目分组。

以下链接在新的发布流程成功后可用。脚本是扩展文件，不能作为机场订阅导入。

| 脚本 | 用途 | URL |
| --- | --- | --- |
| `flclash.js` | 分流，不添加 Tailscale | [导入脚本](https://raw.githubusercontent.com/yuanv4/clash-rules/release/scripts/flclash.js) |
| `flclash-desktop.js` | 分流及系统 Tailscale 网卡出口 | [导入脚本](https://raw.githubusercontent.com/yuanv4/clash-rules/release/scripts/flclash-desktop.js) |
| `flclash-android.js` | 分流及内嵌 Tailscale，首次使用时登录 | [导入脚本](https://raw.githubusercontent.com/yuanv4/clash-rules/release/scripts/flclash-android.js) |
| `flclash-both.js` | 同时提供系统网卡和内嵌 Tailscale 出口 | [导入脚本](https://raw.githubusercontent.com/yuanv4/clash-rules/release/scripts/flclash-both.js) |

详细操作、Tailscale 登录与迁移步骤见 [FlClash 扩展脚本](docs/flclash-extension.md)。

## 修改范围

脚本只处理以下内容：

- 完整替换 `rule-providers` 和 `proxy-groups`，使用项目规则集和代理组。
- 用项目完整规则替换 `rules`，不执行机场原分流规则。
- 在启用 Tailscale 的版本中添加项目节点和路由，保留机场原节点。
- 内嵌 Tailscale 版本在官方 DNS 使用 fake-ip 黑名单时，向 `fake-ip-filter` 追加 `controlplane.tailscale.com`，已存在则不重复添加。

除这一 DNS 例外外，官方 DNS、hosts、TUN、IPv6、嗅探、端口、节点提供商和其他配置均保留。项目规则末尾的 `MATCH` 指向项目漏网组，默认选择 `DIRECT`；机场原规则及其兜底策略被替换。客户端自身的设置仍可能影响最终配置。

代理组和规则集键使用原始名称，不添加项目前缀。项目占用 `TAILSCALE` 和 `TAILSCALE-DIRECT` 节点名。脚本保留机场节点；如果所选模式需要的名称与定义不同的机场节点冲突，脚本会报错并保留原配置。切换模式时，脚本移除与项目完整定义一致的节点，并清理旧的 `[clash-rules] TAILSCALE` 和 `[clash-rules] TAILSCALE-DIRECT` 节点。

## 分流行为

项目规则默认拦截广告和成人内容，国内服务组默认直连，国外服务组默认使用自动选择。`通用 AI` 从美国、日本、新加坡节点中自动测速。`Google` 从美国节点中手动选择。`OpenAI` 从台湾、日本、新加坡节点中自动测速，`Anthropic` 从同样地区的节点中手动选择。各 AI 组没有符合条件的节点时使用 `REJECT`。

项目代理组按规则首次匹配顺序排列，自动选择组置前，漏网组置后，Tailscale 组仅在相应版本中出现。自动选择包含所有地区的订阅节点，排除订阅信息节点和项目 Tailscale 节点，没有可用候选节点时使用 `REJECT`。名称标签不能证明真实出口位置。

品牌组使用固定版本的 [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons/tree/23fc02e7710a66e0c774989f6e78372e9b6c2e15/png)，功能组使用固定版本的 [Qure Color](https://github.com/Koolson/Qure/tree/b16b260625f873266f6a6a9b88710132774997b8/IconSet/Color)，以统一各自的图标风格。品牌图形由社区维护。图标映射更新并发布后，在 FlClash 同步扩展脚本。

`Google` 手动组同时处理 Google 与 Gemini 流量，合并 MetaCubeX `google-gemini`、VPSDance `google-ai` 及 MetaCubeX Google 域名和 IP 规则。该组优先于通用 AI 和国外服务，广告、成人内容等前置规则仍然优先。OpenAI 与 Anthropic 各有专属域名、进程和网络规则，优先于通用 AI；开发服务并入国外服务。详见 [AI 分流范围](docs/ai-routing.md) 和 [自定义规则](docs/custom-rules.md)。

## 构建与发布

使用 Node.js 24 LTS：

```powershell
npm ci
npm test
npm run build
```

只生成扩展脚本，不拉取上游规则：

```powershell
npm run build:scripts
```

完整构建先生成 `dist/rules`，再生成 `dist/scripts`。规则构建会联网，并整体替换专用输出目录；不要在产物目录保存手工资料。

[发布工作流](.github/workflows/release.yml) 在受监控源码变更、手动运行和每日北京时间 06:30 触发。测试和构建通过后，同一提交将规则、四个脚本及本地自定义源发布到 `release` 分支。首次使用或 Fork 时，确认 [sources.json](sources.json) 的 `release_base_url`，准备 `release` 分支，并允许 Actions 写入仓库。该分支的受跟踪内容由发布产物管理。

流程只使用 GitHub 的仓库写权限，不需要机场订阅或 Cloudflare Secrets。本地自定义源还包含原仓库的名称和 URL，Fork 时需同步调整。

发布后可核对脚本依赖的公开规则链接、来源和载荷：

```powershell
node scripts/verify-published-rules.mjs
```

## 更新

| 内容 | 修改位置或来源 | 客户端更新方式 |
| --- | --- | --- |
| 规则集内容 | 上游及 [custom/foreign.txt](custom/foreign.txt) | 内核按规则提供商的 `interval` 刷新 |
| 规则来源和业务映射 | [sources.json](sources.json) | 发布后同步扩展脚本，并按需刷新规则提供商 |
| 分组、节点筛选、Tailscale 定义 | [脚本生成器](scripts/render-flclash-script.mjs) | 发布后同步扩展脚本 |
| 机场节点、DNS、hosts、其他基础配置 | 机场官方完整订阅 | 更新该官方订阅；脚本会重新覆盖分流规则 |

FlClash 应用配置时会执行已保存的脚本。远程脚本内容更新是独立操作，可手动同步；v0.9.4 的自动更新还受 `geoAutoUpdate` 和 `geoUpdateInterval` 控制。

可设置 `MIHOMO_PATH` 后运行测试，检查真实内核行为；没有配置时，相应检查会跳过。本地测试不能代替 Android、系统网卡和 Tailnet 的实机验证。

## 从旧 Worker 订阅迁移

仓库不再部署 Worker、写入 KV 或处理机场 DNS 快照。旧的 Worker 配置链接不能代替官方主订阅。

先在客户端导入官方完整订阅并绑定新的脚本，确认可用后，再单独停用旧 Worker、KV 和相关凭据。移除仓库代码不会自动删除线上资源。本次迁移也不删除本地私有文件。

上游来源和许可证见 [sources.json](sources.json)。
