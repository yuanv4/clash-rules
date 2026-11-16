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

## 什么时候用数组

机场订阅链接如果**有效期很短或绑定生成 IP**，自动更新必然失败，只能把节点快照内联。
Amytelecom 就属于这种：链接约 10 分钟失效且绑定住宅 IP，GitHub Runner 是机房 IP，拉不到。

其余机场一律用字符串，让客户端自己更新，节点变化不用管。

## 加一个机场

在 Secret 里加一行：

```json
"新机场名": "https://它的订阅链接"
```

不需要改代码、不需要改 workflow。推送（或等每日定时任务）后各设备自动拿到新配置。

## 更新静态节点（Amytelecom）

1. 打开
   ```
   https://sub-store.example.com:8443/<私有前缀>/download/Amytelecom?target=ClashMeta
   ```
   （私有前缀见 `SUB_STORE_PATH_PREFIX`）
2. 去掉第一行 `proxies:`
3. 剩下的每一行（形如 `- {...}`）作为数组的一个元素，替换掉 `amytelecom` 数组

## Tailscale 出口

配置里的 `Tailscale` 策略组需要一个真正的出口节点，否则 tailnet 流量只会走 `DIRECT`。
两个可选 Secret 控制生成为哪种：

| Secret | 值 | 生成的节点 | 适用 |
|---|---|---|---|
| `TAILSCALE_INTERFACE` | `Tailscale` | `TAILSCALE-DIRECT`，`type: direct` + `interface-name` | 桌面端（系统 Tailscale 已登录、网卡存在） |
| `TAILSCALE_AUTH_KEY` | `tskey-auth-...` | `TAILSCALE`，`type: tailscale` 内嵌 tsnet 节点 | Android（系统只允许一个 VPN，无法同时跑 Tailscale App） |

两者可以同时配置，此时策略组为 `[TAILSCALE-DIRECT, TAILSCALE, DIRECT]`，默认选中第一个。
都不配置时组内只有 `DIRECT`。

路由规则固定为：

```yaml
- IP-CIDR,100.64.0.0/10,Tailscale,no-resolve
- IP-CIDR,100.100.100.100/32,Tailscale,no-resolve
- DOMAIN-SUFFIX,ts.net,Tailscale
```

Tailscale 节点会从 `🚀 节点选择` / `♻️ 自动选择` / `🤖 国际 AI` 中排除（通过 `exclude-filter`），
避免它被当作机场节点参与延迟测速。

## 相关 Secrets

| Secret | 说明 |
|---|---|
| `SUBSCRIPTIONS_JSON` | 本文档的 JSON，唯一的订阅配置入口 |
| `TAILSCALE_INTERFACE` | 可选，桌面端 Tailscale 网卡名（如 `Tailscale`） |
| `TAILSCALE_AUTH_KEY` | 可选，Android 内嵌 tsnet 的 auth key |
| `CF_API_TOKEN` | 只需 `Account → Workers KV Storage → Edit` |
| `CF_ACCOUNT_ID` | Cloudflare 账号 ID |
| `CF_KV_NAMESPACE_ID` | KV 命名空间 ID |

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
