# 使用 FlClash 扩展脚本

将机场完整订阅作为主配置，再给该配置绑定本项目的脚本。机场负责提供 DNS、hosts 和节点，脚本完整覆盖分流规则、代理组和规则集，并按所选版本添加 Tailscale 节点。

## 选择脚本

下面的链接在新发布流程成功后可用。

| 文件 | Tailscale 模式 | 适用情况 |
| --- | --- | --- |
| [flclash.js](https://raw.githubusercontent.com/yuanv4/clash-rules/release/scripts/flclash.js) | 关闭 | 只使用项目分流 |
| [flclash-desktop.js](https://raw.githubusercontent.com/yuanv4/clash-rules/release/scripts/flclash-desktop.js) | 系统网卡 | 已安装并登录系统 Tailscale 的桌面设备 |
| [flclash-android.js](https://raw.githubusercontent.com/yuanv4/clash-rules/release/scripts/flclash-android.js) | 内嵌 tsnet | 在支持该出站的 FlClash 内核中直接连接 Tailnet |
| [flclash-both.js](https://raw.githubusercontent.com/yuanv4/clash-rules/release/scripts/flclash-both.js) | 同时提供两者 | 需要在同一组内手动切换两种出口 |

所有版本都公开发布，不包含机场 URL、节点凭据或 Tailscale auth key。

## 导入与绑定

1. 更新 FlClash，并备份现有客户端配置。
2. 在配置列表添加机场提供的完整 Clash 或 Mihomo 订阅，并选中它。不要导入仅含节点的转换订阅。
3. 打开脚本管理，通过 URL 导入上表中的一个脚本。菜单名称随版本变化，v0.9.4 的订阅扩展页提供脚本选择和脚本管理入口。
4. 在该官方订阅的扩展设置中选中导入的脚本。只保存脚本、不绑定订阅不会使它生效。
5. 使用规则模式，应用配置。
6. 查看最终配置，确认出现 `🤖 通用 AI`、`Anthropic` 等项目分组，并核对下面的检查项。

切换脚本版本时，给同一个官方订阅重新选择脚本即可。三个分流字段会被完整重建；节点列表只清理项目前次生成的节点，再添加所选模式的节点。

## 脚本修改的内容

| 字段 | 行为 |
| --- | --- |
| `rules` | 完整替换为项目规则。保留项目优先级，最后只有一条项目 `MATCH`，指向默认选择 `DIRECT` 的漏网组 |
| `rule-providers` | 完整替换为项目规则集 |
| `proxy-groups` | 完整替换为项目代理组 |
| `proxies` | 在相应版本中加入 Tailscale 节点，保留机场原节点；切换版本时移除本项目先前生成的节点 |
| `dns` | 内嵌 tsnet 版本在 fake-ip 黑名单过滤时追加控制域例外，其他值保持原样 |
| 其他字段 | 保留官方配置的原值及字段存在状态 |

内嵌 tsnet 版本在 `enhanced-mode` 为 `fake-ip`，且 `fake-ip-filter-mode` 为 `blacklist` 或省略时，将 `controlplane.tailscale.com` 追加到 `fake-ip-filter`。列表不存在时会创建列表，已有该域名时不重复添加。过滤列表不是数组或过滤模式不是黑名单时保持原样，需要自行核对 DNS 配置。

除这一 DNS 例外外，脚本保留 `dns`、`hosts`、`tun`、`ipv6`、`sniffer`、端口、`profile`、`proxy-providers` 和机场自定义字段。机场原分流规则、代理组和规则集被替换。

如果官方 DNS 或节点配置通过 `#代理组`、`rule-set:` 或 `dialer-proxy` 等字段引用了机场原有条目，覆盖后需要核对这些依赖。脚本不会自动修复这些引用。

代理组和规则集键使用原始名称，不添加项目前缀。项目占用 `TAILSCALE` 和 `TAILSCALE-DIRECT` 节点名。脚本保留机场节点；如果所选模式需要的名称与定义不同的机场节点冲突，脚本会报错并保留原配置。切换模式时，脚本移除与项目完整定义一致的节点，并清理旧的 `[clash-rules] TAILSCALE` 和 `[clash-rules] TAILSCALE-DIRECT` 节点。

以上是脚本本身的修改范围。FlClash 之后仍会应用客户端设置；如果配置了 DNS 覆写、系统 DNS 追加或其他扩展，应另外核对最终配置。

## 系统 Tailscale 网卡

桌面版本生成 `TAILSCALE-DIRECT` 节点，使用 `type: direct` 和 `interface-name: Tailscale`。

先启动并登录系统 Tailscale，确认操作系统中的实际网卡名。默认名称适用于名为 `Tailscale` 的网卡，不保证适用于所有平台。这个节点不会安装 Tailscale、创建网卡或替你登录。

网卡名不同时，将公开脚本另存为本地副本，在其中调整 `interface-name`，再作为本地脚本导入。远程脚本同步会更新其内容，不适合保存只属于某台设备的手工改动。

Android 常规单用户环境下，系统 Tailscale 与 FlClash 会争用 VPN 通道；Android 优先使用内嵌版本。

## 内嵌 Tailscale 登录

Android 和同时提供两种出口的版本生成 `TAILSCALE` 节点。节点不写入 `auth-key`，使用本机的 `./tailscale` 状态目录保存登录状态。

1. 绑定包含内嵌节点的脚本，应用配置。
2. 在 FlClash 中开启日志收集，并将日志级别设为 Info 或 Debug。
3. 在项目 Tailscale 组选择内嵌节点。
4. 用 HTTP 或 TCP 访问 Tailnet 内真实设备的 `100.x` IP，触发内嵌节点连接。
5. 查看内核日志中带 `[Tailscale]` 的内部日志。如果出现交互式登录 URL，在浏览器中完成授权。
6. 再次访问该 `100.x` IP，并在 Tailscale 管理后台核对设备状态。

Mihomo 的 Tailscale 出站按需连接，应用配置本身不保证立即开始登录。已有登录状态时不保证出现新的登录 URL。文档依据为 [Mihomo Tailscale 出站](https://wiki.metacubex.one/config/proxies/tailscale/)。Android 16 和 FlClash 0.9.4 的实机验证使用已有登录状态，确认了 Tailnet 连通，未验证全新 Android 首次授权流程。

代理专用 DNS 指向本机 fake-ip 监听时，Tailscale 控制域可能被解析为无法直连的 fake IP。上述黑名单例外使该控制域使用真实地址。脚本添加 `100.64.0.0/10`、`100.100.100.100/32` 和 `ts.net` 对应路由，并将项目 Tailscale 节点排除在业务自动选择组之外。这些路由不保证 Tailnet 设备名能够解析，先用 IP 验证链路。

## 更新的三个来源

| 更新对象 | 触发方式 | 是否需要重新访问机场订阅 |
| --- | --- | --- |
| 公开规则集内容 | 内核按 `interval` 刷新，或手动刷新规则提供商 | 否 |
| 项目脚本内容 | 手动同步脚本，或使用客户端资源自动更新 | 否 |
| 机场节点、DNS、hosts、其他原始配置 | 更新官方完整订阅 | 是 |

FlClash 应用配置时会运行本地已保存的脚本，不代表每次应用都会重新下载脚本。v0.9.4 的远程脚本自动更新受 `geoAutoUpdate` 和 `geoUpdateInterval` 控制。

Amy 等要求手动开启访问窗口、限制出口 IP 的订阅，更新官方主配置时仍需满足机场的访问条件。迁移后更新的是完整官方订阅，不再只刷新旧 Worker 配置中的节点提供商。项目规则和脚本的更新不占用机场访问窗口。

## 多个机场

脚本使用当前主配置已有的节点和 `proxy-providers`，不会读取其他 FlClash 配置，也不会把机场 URL 存入仓库。

多个官方订阅可以分别绑定同一项目脚本，切换主配置时分别使用各自的节点和 DNS。若当前主配置本身已经包含多个节点提供商，脚本会保留它们。需要跨机场集中合并时，在客户端维护私有配置；公开脚本不再承担原 `SUBSCRIPTIONS_JSON` 的私有订阅合并功能。

## 从旧 Worker 配置迁移

1. 保留旧配置，另外添加官方完整订阅。
2. 导入并绑定新的公开脚本。
3. 对照原始官方配置，核对 DNS 映射、上述控制域例外、hosts 和节点。
4. 验证 AI 分流、默认出口及所需的 Tailscale 链路。
5. 确认迁移完成后，再单独停用线上 Worker、KV 和相关凭据。

仓库不再读取旧 Cloudflare 或机场 Secrets，也不再使用 DNS 快照。删除仓库里的部署代码不会自动删除线上资源或本地私有文件。

## 验收清单

- 除内嵌 tsnet 版本的上述控制域例外外，官方 DNS 映射、hosts、TUN、IPv6、嗅探、端口和自定义字段保持原值。
- 官方节点和节点提供商仍保留，代理组及规则集已换成项目定义。
- 官方 `rules` 被项目规则替换，项目 `MATCH` 位于最后。
- 通用 AI 自动选择，Anthropic 和 Gemini 可分别手动选择。
- 广告、成人内容、国内服务和国外服务按项目规则处理。
- 漏网组默认 `DIRECT`，可以在客户端手动调整。
- 不启用 Tailscale 的版本不添加项目 Tailscale 节点、组和路由。
- 需要 Tailscale 时，用 `100.x` IP 验证实际连接。
- 重复应用配置不会产生重复的项目条目，切换模式后机场原条目不丢失。
