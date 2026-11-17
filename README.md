# clash-rules

为 FlClash / mihomo 生成公开分流规则，并通过 Cloudflare Worker 提供私有订阅配置。需要自备机场订阅或节点。

```text
公开规则 → Node.js 构建 → GitHub release 分支 → 客户端
机场订阅 → Node.js 渲染 → Cloudflare KV → Worker → 客户端
```

> 完整配置和私有订阅地址可能包含凭据，请勿提交或公开分享。渲染模板需经过 Worker，不能直接导入客户端。

## 使用

在 FlClash 中添加自己的 Worker 私有订阅地址，更新配置后使用规则模式。

| URL 参数 | 用途 |
| --- | --- |
| 无参数 / `ts=off` | 不启用 Tailscale 节点 |
| `ts=interface` | 使用系统 Tailscale 网卡；需已安装并登录 |
| `ts=tsnet&tskey=<设备专属key>` | 使用内嵌 Tailscale；需客户端内核支持 |
| `ts=both&tskey=<设备专属key>` | 同时提供两种方式 |

用 `iface=名称` 覆盖网卡名，默认 Tailscale。携带 key 的 URL 是敏感信息，推荐每台设备使用单独的 key。详见 [订阅与 Tailscale 配置](<docs/flclash-subscriptions.md>)。

默认广告和成人内容拦截，国内服务直连，国外服务走代理；**未匹配流量默认直连，AI 组仅筛选台湾、新加坡节点**。

## 首次部署

准备 Cloudflare KV namespace、Worker 域名，以及 GitHub Actions Secrets：

| Secret | 内容 |
| --- | --- |
| `SUBSCRIPTIONS_JSON` | 机场订阅或静态节点，格式见下方 |
| `CF_API_TOKEN` | 需 Workers KV Storage:Edit 和 Workers Scripts:Edit 权限 |
| `CF_ACCOUNT_ID` | Cloudflare 账号 ID |
| `CF_KV_NAMESPACE_ID` | KV namespace ID |
| `CF_SECRET_PATH` | 难以猜测的私有路径，例如 `/s/<随机秘密>` |
| `CF_TS_INTERFACE` / `CF_TS_AUTH_KEY` | 可选：默认网卡名 / 共享 Tailscale key |

`SUBSCRIPTIONS_JSON` 最简示例（替换为自己的订阅）：

```json
{"airport_a":"https://subscription.example.com/your-token"}
```

静态节点格式及校验要求见 [订阅说明](<docs/flclash-subscriptions.md>)。仅修改 Secret 不会自动触发部署。

按顺序操作，每一步成功后再继续：

1. 确认 [sources.json](<sources.json>) 的 `release_base_url`，预先创建 `release` 分支并允许 Actions 写入。该分支的受跟踪内容会被发布产物替换。
2. 运行 **Build And Publish Rule Providers**，发布规则。
3. 运行 **Deploy Clash Profile Worker**，确认 KV 绑定和域名可访问。
4. 运行 **Deploy FlClash Profile**，再到一台测试设备更新订阅。

三条流水线互不等待；新增规则集合时先发规则，变更模板占位符时先发兼容 Worker。脚本不会创建 KV 或域名，Worker 名固定为 `clash-profile`，注意避免覆盖同名服务。

**Fork 注意：** [构建脚本](<scripts/build.mjs>) 对本地自定义源的识别包含原仓库名与 URL，迁移时需同步调整，不能只替换发布地址。

## 日常维护

| 想修改什么 | 修改位置 | 后续操作 |
| --- | --- | --- |
| 自定义国外域名 | [custom/foreign.txt](<custom/foreign.txt>) | 推送，等待规则发布 |
| 上游、规则集合、DNS 排除项 | [sources.json](<sources.json>) | 按需发布规则和模板 |
| 机场 / 静态节点 | Secret `SUBSCRIPTIONS_JSON` | 手动运行 Deploy FlClash Profile |
| 策略组 / AI 筛选 | [模板渲染器](<scripts/render-flclash-profile.mjs>) | 验证后发布模板 |
| Tailscale 注入 / 私有路径 | [Worker](<worker/clash-profile.js>) / Secrets | 手动运行 Deploy Clash Profile Worker |

规则每日北京时间 **06:30** 更新，模板 **10:17** 更新；Worker 只手动部署。发布后按需刷新客户端规则或完整订阅。

更多说明：[自定义规则](<docs/custom-rules.md>) · [DNS fake-ip 排除](<docs/fake-ip-filter.md>)。自定义国外规则不能覆盖前面已命中的拦截或国内规则。

## 本地检查

构建、测试、渲染及部署统一使用 **Node.js 24 LTS**。

```powershell
npm ci
npm test
node scripts/build.mjs

# 假订阅，仅检查模板，不部署
$env:SUBSCRIPTIONS_JSON = '{"demo":"https://subscription.example.com/demo"}'
node scripts/render-flclash-profile.mjs --output .cf-build/profile-demo.yaml
```

构建会联网，成功后整体替换输出目录。只使用专用产物目录，不要存放手工资料；旧版无构建标记的非空目录会被拒绝覆盖，请先备份或换新目录。

三条发布流程都会先跑离线测试，但不代替真实客户端验证。

## 常见问题

- **404**：检查私有路径、KV 绑定及是否已发布模板。
- **400**：检查 `ts`、网卡名和 Tailscale key。
- **500 Invalid profile template**：重新发布当前渲染器生成的模板；旧版无占位模板不受支持。
- **更新后仍是旧配置**：先确认 Actions 成功，再手动更新客户端，留意缓存。
- **凭据泄露**：轮换私有路径及相关 key；删除文件或改写 Git 历史不能撤销凭据。

上游来源和许可证见 [sources.json](<sources.json>)；重新分发前请核实各来源的许可要求。
