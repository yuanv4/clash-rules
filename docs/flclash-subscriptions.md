# FlClash 订阅配置（SUBSCRIPTIONS_JSON）

GitHub Actions 用它生成 FlClash 自定义配置，并推送到 Cloudflare Workers KV。
**全部机场订阅都放在这一个 Secret 里**，不需要再配其它与订阅相关的东西。

## 结构

```json
{
  "mojie": "https://机场订阅链接",
  "youtu": "https://机场订阅链接",
  "amytelecom": [
    "- {name: 香港 01, type: anytls, server: ..., port: 20300, password: ...}",
    "- {name: 香港 02, type: anytls, server: ..., port: 20305, password: ...}"
  ]
}
```

**值类型决定用途：**

| 值的类型 | 含义 |
|---|---|
| 字符串 | 远程订阅。生成的配置里是一个 `proxy-providers` 条目，客户端按 `interval: 3600` 自动更新 |
| 数组 | 静态节点。每个元素是一条 YAML 节点行，直接内联进 `proxies:` |

键名（`mojie` / `youtu` / …）就是 provider 名，只能用字母、数字、`_`、`.`、`-`。

渲染命令使用 Bun 1.3.14：`bun scripts/render-flclash-profile.mjs --output <私有模板路径>`。
静态节点必须是单行 YAML、包含非空字符串 name/type，名称不得重复或与策略组、TAILSCALE、TAILSCALE-DIRECT 冲突。渲染器解析后重新序列化，并验证四种注入模式；不合法的输入不会写出新模板。

## 什么时候用数组

机场订阅链接如果**有效期很短或绑定生成 IP**，自动更新必然失败，只能把节点快照内联。
Amytelecom 就属于这种：链接约 10 分钟失效且绑定住宅 IP，GitHub Runner 是机房 IP，拉不到。

其余机场一律用字符串，让客户端自己更新，节点变化不用管。

## 加一个机场

在 Secret 里加一行：

```json
"new_airport": "https://它的订阅链接"
```

不需要改代码、不需要改 workflow。修改 Secret 不触发 push；手动运行 Deploy FlClash Profile（或等每日定时任务），再让设备更新完整订阅。

## 更新静态节点（Amytelecom）

1. 打开
   ```
   https://sub-store.example.com/<私有前缀>/download/<订阅名称>?target=ClashMeta
   ```
   （私有前缀见 `SUB_STORE_PATH_PREFIX`）
2. 去掉第一行 `proxies:`
3. 剩下的每一行（形如 `- {...}`）作为数组的一个元素，替换掉 `amytelecom` 数组

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
- 链接里的 key 优先；没带时才回退到 Worker 的 `TS_AUTH_KEY` secret（可选，不推荐）
- key 不会出现在 `ts=interface` / `off` 的响应里
- 每台设备可以用各自的 key，不受一份共享密钥限制

可调参数：

- `iface=<名称>`：覆盖网卡名，默认取 Worker 绑定 `TS_INTERFACE`，再默认 `Tailscale`

路由规则固定（走 `Tailscale` 组）：

```yaml
- IP-CIDR,100.64.0.0/10,Tailscale,no-resolve
- IP-CIDR,100.100.100.100/32,Tailscale,no-resolve
- DOMAIN-SUFFIX,ts.net,Tailscale
```

Tailscale 节点通过 `exclude-filter` 从 `🚀 节点选择` / `♻️ 自动选择` / `🤖 国际 AI`
中排除，不会被当成机场节点参与延迟测速。

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

部署 Workflow 从可选 GitHub Secrets `CF_TS_INTERFACE` / `CF_TS_AUTH_KEY` 设置 Worker 绑定 `TS_INTERFACE` / `TS_AUTH_KEY`。订阅路径由必填 Secret `CF_SECRET_PATH` 设置；优先使用 URL 中的设备专属 key。

## 流水线

`.github/workflows/deploy-profile.yml`，与 `release.yml`（规则发布）相互独立：

```
push（改动 sources.json / 渲染脚本 / workflow）
  └─ 或每日 02:17 UTC 定时
       ▼
渲染 profile → 推送到 Cloudflare KV → Worker 对外提供
       ▼
FlClash 从固定 URL 拉取（地址不变）
```

规则集本身是独立的 raw URL，客户端按 `interval: 86400` 自己刷新，所以改规则**不需要**重新跑这条流水线。
