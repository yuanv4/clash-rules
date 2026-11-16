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

## 相关 Secrets

| Secret | 说明 |
|---|---|
| `SUBSCRIPTIONS_JSON` | 本文档的 JSON，唯一的订阅配置入口 |
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
