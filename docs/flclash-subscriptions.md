# FlClash 订阅配置（SUBSCRIPTIONS_JSON）

GitHub Actions 用它生成 FlClash 自定义配置，并推送到 Cloudflare Workers KV。
**全部机场订阅都放在这一个 Secret 里**，不需要再配其它与订阅相关的东西。

## 结构

```json
{
  "mojie": "https://机场订阅链接",
  "amytelecom": { "url": "https://机场订阅链接", "interval": 0 },
  "youtu": { "url": "https://机场订阅链接", "enable": false },
  "backup": [
    "- {name: 香港 01, type: anytls, server: ..., port: 20300, password: ...}",
    "- {name: 香港 02, type: anytls, server: ..., port: 20305, password: ...}"
  ]
}
```

**值类型决定用途：**

| 值的类型 | 含义 |
|---|---|
| 字符串 | 远程订阅简写。生成的配置里是一个 `proxy-providers` 条目，`interval: 3600` 自动更新 |
| 数组 | 静态节点简写。每个元素是一条 YAML 节点行，直接内联进 `proxies:` |
| 对象 | 完整形式，`url` 或 `nodes` 二选一，可带 `interval` / `enable` |

**对象字段：**

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `url` | 字符串 | — | 远程订阅链接（与 `nodes` 二选一） |
| `nodes` | 数组 | — | 静态节点 YAML 行（与 `url` 二选一） |
| `interval` | 整数 | `3600` | provider 自动刷新间隔（秒），仅 `url` 可用。`0` 关闭自动刷新，改由客户端手动触发 |
| `enable` | 布尔 | `true` | `false` 临时关闭该机场：不生成 provider、不内联节点 |

键名（`mojie` / `youtu` / …）就是 provider 名，只能用字母、数字、`_`、`.`、`-`。

使用 Node.js 24 LTS，先运行 `npm ci`，再渲染：`node scripts/render-flclash-profile.mjs --output <私有模板路径>`。
静态节点必须是单行 YAML、包含非空字符串 name/type，名称不得重复或与策略组、TAILSCALE、TAILSCALE-DIRECT 冲突。渲染器解析后重新序列化，并验证四种注入模式；不合法的输入不会写出新模板。

## amytelecom（10 分钟访问窗口）

Amytelecom 的订阅链接 **URL 固定**，但机场只允许在后台「打开订阅访问」后的约 10 分钟内访问，且绑定打开时的住宅 IP。自动刷新在窗口外必然失败，所以把它配成手动档：

```json
"amytelecom": { "url": "固定订阅链接", "interval": 0 }
```

更新节点时：

1. 登录机场后台，打开「订阅访问」（10 分钟窗口）
2. 在与该住宅出口 IP 相同的设备上刷新 amytelecom 的 **提供商（proxy-providers）**，不是刷新「订阅」——后者只会重新拉 Worker 下发的 profile
   - FlClash：在提供商（proxy-providers）页面点 amytelecom 的刷新
   - mihomo API：`PUT /providers/proxies/amytelecom`
3. 确认节点列表已更新

注意：

- 手机蜂窝网络、公司网络等出口 IP 不同的设备无法刷新，需要换到同一网络。
- 窗口外不要清空客户端缓存或重装：没有本地 provider 缓存时，拉取失败会导致该机场节点为空。
- `interval` 不要设成非零值：窗口外每一轮自动刷新都会失败，只产生错误日志。

## 什么时候用静态数组

机场**不提供可用链接**（链接一次性、或不想每次手动开窗刷新）时，把节点快照内联：

```json
"backup": [
  "- {name: 香港 01, type: anytls, server: ..., port: 20300, password: ...}"
]
```

静态节点一旦发布，所有设备在任何网络都能用，不依赖窗口和 IP；机场换节点时需要重新导出并更新 Secret。

## 临时关闭一个机场

```json
"youtu": { "url": "https://...", "enable": false }
```

保留配置但不再生成 provider，适合机场临时故障或暂时不用时。恢复时把 `enable` 改回 `true`（或删掉该字段），重新发布 profile 即可。被关闭条目的内容（链接协议、节点 YAML、名称冲突）不做校验；但不能把所有条目都关掉，至少保留一个启用的机场或静态节点。

## 加一个机场

在 Secret 里加一行：

```json
"new_airport": "https://它的订阅链接"
```

需要手动刷新或暂时停用时改用对象形式。不需要改代码、不需要改 workflow。修改 Secret 不触发 push；手动运行 Deploy FlClash Profile（或等每日定时任务），再让设备更新完整订阅。

## 更新静态节点

1. 打开
   ```
   https://sub-store.example.com/<私有前缀>/download/<订阅名称>?target=ClashMeta
   ```
   （私有前缀见 `SUB_STORE_PATH_PREFIX`）
2. 去掉第一行 `proxies:`
3. 剩下的每一行（形如 `- {...}`）作为数组的一个元素，替换掉对应数组

## Tailscale 出口

profile 里只留占位符，Tailscale 节点由 **Worker 在请求时按查询参数注入**，
所以同一条配置可以服务桌面端和 Android，不必各出一份。

| 订阅地址 | 注入结果 | 适用 |
|---|---|---|
| `…/s/<secret>` 或 `?ts=off` | 无节点，`Tailscale` 组只有 `DIRECT` | 不使用 Tailscale 的设备 |
| `…/s/<secret>?ts=interface` | `TAILSCALE-DIRECT`（`type: direct` + `interface-name`） | 桌面端，系统 Tailscale 已登录 |
| `…/s/<secret>?ts=tsnet&tskey=tskey-auth-...` | `TAILSCALE`（`type: tailscale` 内嵌 tsnet） | Android，系统只允许一个 VPN |
| `…/s/<secret>?ts=both&tskey=...` | 两个都注入，默认选 `TAILSCALE-DIRECT` | 需要手动切换的设备 |

**tsnet 的 auth key 由链接注入**，和旧 Sub-Store 的 `tailscale-secret` 行为一致：

- 参数名 `tskey`，也接受旧名 `tailscale-secret`
- key 必须由链接携带，Worker 不保存共享 key
- key 不会出现在 `ts=interface` / `off` 的响应里
- 每台设备可以用各自的 key，不受一份共享密钥限制

可调参数：

- `iface=<名称>`：覆盖网卡名，默认 `Tailscale`

路由规则固定（走 `Tailscale` 组）：

```yaml
- IP-CIDR,100.64.0.0/10,Tailscale,no-resolve
- IP-CIDR,100.100.100.100/32,Tailscale,no-resolve
- DOMAIN-SUFFIX,ts.net,Tailscale
```

Tailscale 节点通过 `exclude-filter` 从 `♻️ 自动选择`、`🤖 国际 AI`、`OpenAI`、`Anthropic` 和 `✨ Gemini`
中排除，不会被当成机场节点。

四个 AI 组共用美国、日本、新加坡三个候选地区，并排除港澳标签。`🤖 国际 AI` 和 `OpenAI` 自动选择节点，`Anthropic` 和 `✨ Gemini` 使用 `select` 手动固定节点。四个 AI 组没有匹配节点时都使用 `REJECT`，避免回退直连。分流范围与剩余服务见 [AI 分流说明](<ai-routing.md>)。节点名称只用于筛选，不能证明出口 IP 的实际地区或 Gemini 可用性。先选一个能正常使用 Gemini 的节点，保持出口稳定；新加坡可以作为首选尝试，但不保证优于其他地区。

Gemini 规则来自 MetaCubeX 的 `google-gemini` 和 VPSDance 的 `google-ai` 上游，优先于通用 AI 和国外服务规则。`google-ai` 还覆盖部分其他 Google AI 服务及 Antigravity 进程，这些流量也使用 Gemini 组。更新时先发布规则，再发布订阅模板，最后在客户端更新订阅。

Worker 源码在 [`worker/clash-profile.js`](../worker/clash-profile.js)，
部署用 `node scripts/deploy-clash-worker.mjs`（需要 `Workers Scripts:Edit` 权限）。

> 顺序要求：**先部署 Worker，再推送带占位符的 profile**。反过来会让客户端拿到字面量占位符。
> 新 Worker 要求三个专用占位行各存在一次且位于预期位置；旧版无占位模板、缺失或重复占位行都会返回 500，而不是下发可疑配置。升级前确认现有 KV 是带占位符模板；若仍是更旧的完整 profile，请安排迁移窗口，部署后立即发布新模板。

## 相关 Secrets

| Secret | 说明 |
|---|---|
| `SUBSCRIPTIONS_JSON` | 本文档的 JSON，唯一的订阅配置入口 |
| `CF_API_TOKEN` | KV 发布需 `Account → Workers KV Storage → Edit`；部署 Worker 还需 `Workers Scripts → Edit` |
| `CF_ACCOUNT_ID` | Cloudflare 账号 ID |
| `CF_KV_NAMESPACE_ID` | KV 命名空间 ID |
| `CF_SECRET_PATH` | 订阅地址的路径：`https://<Worker 域名>` + 本值，须以 `/` 开头 |

Tailscale key 只从订阅 URL 注入，每台设备使用各自的 key。

## 流水线

[模板发布流程](<../.github/workflows/deploy-profile.yml>) 在 [规则发布流程](<../.github/workflows/release.yml>) 成功后自动运行，也支持手动运行和每日 02:17 UTC 定时运行。只修改模板发布流程、发布脚本或公开规则检查脚本时，也会直接触发。

```text
规则发布成功、手动运行或定时触发
       ▼
验证公开规则的来源与筛选类型 → 渲染 profile → 推送到 Cloudflare KV
       ▼
Worker 对外提供 → FlClash 从固定 URL 拉取
```

公开规则缺失、来源不匹配或载荷无效时，流程在写入 KV 前停止。新增规则集或合并规则来源时，先运行规则发布流程。

规则集使用独立的 raw URL，客户端按 `interval: 86400` 刷新。只更新已有上游的规则内容时，客户端无需更新完整订阅。release 分支保留旧的开发服务规则文件，兼容尚未更新完整订阅的客户端。
