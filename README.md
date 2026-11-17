# clash-rules 使用与维护指南

为 FlClash / mihomo 管理分流规则和私有订阅配置。项目不是代理节点服务，也不会替你获取机场账号；你需要提供自己的订阅或节点。

> **公开的是规则，私有的是完整订阅。** 完整配置包含机场 URL、节点密码，并可能包含 Tailscale auth key。不要提交完整配置、在日志中打印它，或把订阅地址发到公开渠道。

## 1. 项目实际如何运行

```text
sources.json + custom/foreign.txt + 上游公开规则
  → Bun 构建、校验、去重
  → dist/rules → GitHub release 分支 → 客户端下载规则

sources.json + GitHub Secret SUBSCRIPTIONS_JSON
  → Node 渲染带占位符的私有模板
  → Cloudflare KV 的 profile.yaml
  → Worker 检查私有路径、按 URL 参数注入 Tailscale
  → FlClash 下载完整配置

worker/clash-profile.js → 手动部署 Worker（独立于以上两条流程）
```

机场订阅 URL 不由生成器下载：它们写入 `proxy-providers`，由客户端拉取。静态节点则直接写进模板。**渲染出来的模板不是可直接导入客户端的最终配置**，必须先经过 Worker 替换占位符。

### 文件导航

| 入口 | 作用 |
| --- | --- |
| [sources.json](<sources.json>) | 上游、规则集合、目标策略组、发布地址、DNS 排除项 |
| [custom/foreign.txt](<custom/foreign.txt>) | 自定义国外服务规则 |
| [build.mjs](<scripts/build.mjs>) | 校验、抓取、解析、合并和生成规则 |
| [build.test.mjs](<scripts/build.test.mjs>) | 规则构建模块测试 |
| [render-flclash-profile.mjs](<scripts/render-flclash-profile.mjs>) | 生成私有订阅模板 |
| [publish-flclash-profile.mjs](<scripts/publish-flclash-profile.mjs>) | 上传模板到 KV |
| [clash-profile.js](<worker/clash-profile.js>) | 私有路径校验和 Tailscale 动态注入 |
| [deploy-clash-worker.mjs](<scripts/deploy-clash-worker.mjs>) | 上传 Worker 代码及绑定 |

没有需要安装的 npm 项目依赖。规则构建和模板渲染使用 Bun 自带的 YAML 解析器；上传 KV 和部署 Worker 的 Node 脚本使用内置能力。

## 2. 已部署项目：日常怎么用

1. 在 FlClash 中添加远程配置，填入自己的 Worker 私有订阅地址。
2. 首次使用先手动更新配置，并确认节点、规则集合下载成功。
3. 使用规则模式；检查客户端是否覆盖了订阅中的 DNS 设置。
4. 节点组选择和订阅更新可能被客户端保存的本地选择影响，以设备上的实际选中项为准。

以下均为占位示例，不是真实凭据：

```text
https://<你的域名>/s/<随机秘密>
https://<你的域名>/s/<随机秘密>?ts=interface
https://<你的域名>/s/<随机秘密>?ts=tsnet&tskey=<设备专属auth-key>
https://<你的域名>/s/<随机秘密>?ts=both&tskey=<设备专属auth-key>
```

| 参数 | 行为与前提 |
| --- | --- |
| 无参数或 `ts=off` | 不注入节点；Tailscale 组只含 DIRECT |
| `ts=interface` | 注入 TAILSCALE-DIRECT；桌面系统需已安装、登录 Tailscale，网卡名正确 |
| `ts=tsnet` | 注入内嵌 TAILSCALE；客户端内核必须支持 `type: tailscale`，需有效 auth key |
| `ts=both` | 两种节点都注入，模板默认选择 TAILSCALE-DIRECT |
| `iface=名称` | 覆盖网卡名；其次取 Worker 的 TS_INTERFACE，默认 Tailscale |

`tskey` 优先于旧参数 `tailscale-secret`；都没有时才使用 Worker 的 TS_AUTH_KEY。网卡名目前只接受字母、数字、空格、点、下划线和连字符，长度 1–64。参数值要做 URL 编码。

**安全提示：** 私有路径本身就是访问凭证。携带 `tskey` 的 URL 还包含设备注册凭证，可能进入浏览器历史、客户端配置或诊断日志。优先每台设备使用单独且权限受限的 key。配置共享 TS_AUTH_KEY 时，知道私有路径的人可通过 `ts=tsnet` 取到该 key；不要向不可信的人分享路径。

### 默认分流顺序

规则从上到下匹配，先匹配者生效：

1. Tailscale：`100.64.0.0/10`、`100.100.100.100/32`、`ts.net`。
2. `direct`：局域网直连。
3. `reject_domainset`、`reject`：广告过滤，默认 REJECT。
4. `adult_content`：成人内容，默认 REJECT。
5. `ai`：国际 AI，自动筛选台湾节点，排除香港、澳门和假节点。
6. `dev_services`：开发服务，默认自动选择。
7. `streaming_services`：流媒体服务，默认自动选择。
8. `cn_services`：国内服务，默认 DIRECT。
9. `foreign_services`：国外服务，默认自动选择。
10. `MATCH`：漏网之鱼，默认 DIRECT。

**这不是“所有未识别流量都代理”的配置。** AI 组也不是所有地区通用组；没有台湾节点时必须检查该组是否可用。

机场 provider 更新间隔为 3600 秒，规则 provider 为 86400 秒。它们不等于完整订阅的更新周期；完整订阅由 FlClash 的更新设置控制，也可手动更新。

## 3. 首次部署 / Fork 前准备

需要：

- GitHub 仓库及 Actions 权限。
- 规则构建、模板渲染和测试使用 **Bun 1.3.14**（与 CI 一致）。
- KV 上传和 Worker 部署建议使用 **Node.js 22 或 24**；本次审查使用 Node 24。
- Cloudflare 账号、预先创建的 KV namespace，以及可访问的 Worker 域名/路由。
- FlClash / mihomo，且内核支持你要使用的节点类型。

### 3.1 先设置公开规则发布

1. 在 [sources.json](<sources.json>) 中确认 `release_base_url` 指向自己的 `release` 分支 raw 地址。
2. 确保远程已有 `release` 分支。当前发布流程直接 `git fetch origin release`，**不会创建首次发布分支**。可在 GitHub 页面创建该分支；首次发布会将其所有受跟踪内容替换为规则产物和自定义规则。
3. 允许 Actions 写入该发布分支。保护规则如禁止机器人直接推送，需要相应调整。
4. 手动运行 **Build And Publish Rule Providers**，确认发布成功，再进行模板发布。

Fork 注意：本地自定义规则读取目前硬编码了原仓库的 input 名和 URL，见 [build.mjs](<scripts/build.mjs#L449-L454>)。仅替换这组 input 为自己的仓库地址会使构建改为远程下载，而非读取当前 checkout。迁移时需同步调整该判断及相关测试；不要只全局替换域名。

### 3.2 配置 GitHub Actions Secrets

在仓库 Settings → Secrets and variables → Actions 中设置：

| Secret | 使用场景 |
| --- | --- |
| `SUBSCRIPTIONS_JSON` | 模板渲染，必填，格式见下文 |
| `CF_API_TOKEN` | 模板发布需 Workers KV Storage:Edit；部署 Worker 还需 Workers Scripts:Edit，限制到目标账号 |
| `CF_ACCOUNT_ID` | 两条 Cloudflare 发布流程必填 |
| `CF_KV_NAMESPACE_ID` | 两条流程必填，必须指向同一个 namespace |
| `CF_SECRET_PATH` | Worker 部署必填，例如 `/s/<足够长的随机秘密>`；不要使用这个字面示例 |
| `CF_TS_INTERFACE` | 可选，部署为 TS_INTERFACE 绑定 |
| `CF_TS_AUTH_KEY` | 可选，部署为 TS_AUTH_KEY；更推荐请求时提供设备专属 key |

脚本不会自动读取本地凭据文件，也不会创建 KV namespace 或配置域名。Worker 名目前固定为 `clash-profile`，不要误覆盖账号内同名的其他 Worker。

Cloudflare 路由可使用 Custom Domain 或 workers.dev；需自行确认已启用。参见 [Cloudflare 路由说明](https://developers.cloudflare.com/workers/configuration/routing/)。

### 3.3 设置机场订阅

```json
{
  "airport_a": "https://subscription.example.com/replace-with-your-token",
  "static_nodes": [
    "- {name: Taiwan-demo, type: socks5, server: 192.0.2.1, port: 1080}"
  ]
}
```

以上是结构示例，不能用于实际代理。

- 字符串：远程订阅地址，客户端自行刷新。使用 HTTPS。
- 数组：静态 YAML 节点，每项必须是一个完整的单行节点，例如 `- {...}`；节点变化需要手动更新 Secret 并重发模板。
- 键名只用英文字母、数字、`_`、`.`、`-`；输出会以 YAML 字符串键保留其名称。
- 不要粘贴完整多行 YAML 或只粘贴 `proxies:`；渲染器拒绝多行输入、非法 YAML 和缺少名称/类型的节点。
- 静态节点名称必须唯一，不得与策略组及 TAILSCALE、TAILSCALE-DIRECT 等保留名冲突。

详见 [订阅配置说明](<docs/flclash-subscriptions.md>)。模板渲染使用 Bun，上传和 Worker 部署继续使用 Node；不要沿用旧的 Node 渲染命令。

### 3.4 按顺序上线

1. 发布公开规则，确认 `release` 分支有对应规则文件。
2. 手动运行 **Deploy Clash Profile Worker**。
3. 确认 Worker 的 PROFILE_KV、SECRET_PATH 绑定和路由正确。
4. 手动运行 **Deploy FlClash Profile**。
5. 在一台测试设备上用私有地址更新配置，再扩展到其他设备。

**涉及模板占位符变更时，先部署兼容的 Worker，再发布模板。** 三条流水线互不等待。修改规则集合名称或增加集合时，先确认规则发布成功，再发布引用新规则的模板；不要把两个 workflow 都触发当成有顺序保证。

## 4. 日常修改速查

| 想做的事 | 改哪里 | 接着做什么 |
| --- | --- | --- |
| 给国外服务增加域名 | [custom/foreign.txt](<custom/foreign.txt>) | 测试、推送，等待规则发布，客户端更新规则 |
| 调整 DNS 真实地址排除项 | [sources.json](<sources.json>) 的 fake_ip_filter | 测试、发布模板、客户端更新完整配置 |
| 增减机场 / 更新静态节点 | GitHub Secret SUBSCRIPTIONS_JSON | 手动运行 Deploy FlClash Profile；仅改 Secret 不触发 push |
| 调整策略组和 AI 区域筛选 | [渲染脚本](<scripts/render-flclash-profile.mjs>) | 验证生成配置，发布模板，客户端更新 |
| 调整 Tailscale 注入或路径绑定 | [Worker](<worker/clash-profile.js>) / 对应 Secrets | 手动运行 Deploy Clash Profile Worker |
| 增删或重命名规则集合 | [sources.json](<sources.json>)，必要时渲染脚本 | 规则先发布成功，再发布模板 |

自定义规则示例：

```text
# 域名本身及其子域名走国外服务策略
DOMAIN-SUFFIX,example.com
# 仅匹配一个完整域名
DOMAIN,api.example.net
```

不要附加策略组名：目标由集合定义。规则按输入顺序合并，只做相同规则去重，不会自动消除覆盖关系。[自定义规则](<custom/foreign.txt>) 合并到较靠后的 foreign_services，**不能覆盖前面的广告、成人内容或国内服务规则**。详见 [自定义规则说明](<docs/custom-rules.md>)。

当前 classical 支持 DOMAIN、DOMAIN-SUFFIX、DOMAIN-KEYWORD、DOMAIN-WILDCARD、DOMAIN-REGEX、PROCESS-NAME、IP-CIDR、IP-CIDR6、IP-ASN。domain 集合必须配 domain-text 输入；不要把完整客户端配置当成规则输入。

DNS 排除项使用 `+.example.com` 这样的域名后缀；它只影响 fake-ip，不改变分流目标。详见 [DNS 说明](<docs/fake-ip-filter.md>)。

## 5. 本地检查

在仓库根目录执行：

```powershell
bun --version
node --version
bun test scripts/
bun scripts/build.mjs
```

构建会联网抓取上游。每次抓取最多尝试 3 次，单个响应上限 8 MiB；请求有 30 秒无活动超时。任一输入失败就不发布新目录，保留旧输出。成功后会**整体替换输出目录**。

> 只使用默认 dist 或专用可丢弃目录作为 `--output-dir`。构建会拒绝仓库根目录、祖先目录和源码目录；非空目录必须具有由构建生成的 `.clash-rules-output` 标记且顶层仅含该标记与 rules，才允许整体替换。不要在已标记的产物目录内保存手工资料。
>
> **旧输出迁移：** 旧版生成的 dist 没有标记，会被拒绝覆盖。先检查并自行备份旧目录，或使用全新的专用路径：`bun scripts/build.mjs --output-dir .cf-build/rules-v2`。不要给存有重要资料的目录手工添加标记。CI 每次使用全新 checkout，无需迁移。

本地渲染结构检查（只用假订阅）：

```powershell
$env:SUBSCRIPTIONS_JSON = '{"demo":"https://subscription.example.com/demo"}'
bun scripts/render-flclash-profile.mjs --output .cf-build/profile-demo.yaml
```

此命令不部署、不下载机场节点。输出仍有 Tailscale 占位符，不能直接导入。真实模板只写到被忽略的私有目录，并在提交前检查 `git status`；不带 `--output` 会将完整模板输出到终端。

部署脚本会修改线上资源，仅在环境变量和目标确认后执行：

```powershell
node scripts/deploy-clash-worker.mjs
node scripts/publish-flclash-profile.mjs .cf-build/profile-private.yaml
```

第二个命令要求已有正确渲染的私有模板。通常优先使用 GitHub Actions。发布脚本支持 CF_KV_KEY，但当前 Worker 固定读取 `profile.yaml`，不要单独改它。

## 6. 自动更新时间

| Workflow | 自动触发 | 手动运行 |
| --- | --- | --- |
| [Build And Publish Rule Providers](<.github/workflows/release.yml>) | main/master 上匹配路径的 push；每日 UTC 22:30，即北京时间次日 06:30 | 支持 |
| [Deploy FlClash Profile](<.github/workflows/deploy-profile.yml>) | main/master 上匹配路径的 push；每日 UTC 02:17，即北京时间 10:17 | 支持 |
| [Deploy Clash Profile Worker](<.github/workflows/deploy-worker.yml>) | 无；Worker 改动不会自动上线 | 必须手动 |

定时执行不是精确时钟，GitHub Actions 可能延迟。仅改 README 不触发发布。规则内容更新通常无需重发模板，但改变集合结构、URL、目标组和 DNS 配置需要。

## 7. 排错与恢复

| 现象 | 优先检查 |
| --- | --- |
| 订阅 404 | 请求路径是否与 SECRET_PATH 完全一致；正确 namespace 中是否有非空 profile.yaml |
| 订阅 400 | ts/iface 是否合法；tsnet/both 是否有合法形式的 key；形式合法不等于 Tailscale 接受该 key |
| 订阅 500 Invalid profile template | KV 模板缺少、重复或错放专用占位行；重新发布当前渲染器产物。无占位符的旧完整 profile 不再原样下发 |
| 配置出现 __TAILSCALE_*__ | 是否绕过 Worker 直接导入模板；Worker 与模板版本是否匹配（用户 URL 中原有同名文本会保留） |
| Actions 报缺少 Secret | 核对变量名；修改 Secret 后手动重跑对应流程 |
| Worker 部署被拒绝 | Token 是否有 Workers Scripts:Edit，账号与资源范围是否匹配 |
| 首次规则发布失败 | 远程 release 分支是否已存在，Actions 是否可写入 |
| 上游抓取/解析失败 | 查看具体源 URL、状态码和错误行；修复上游格式配置后重跑，不要清空现有发布产物 |
| 刚上线仍是旧配置 | 手动更新客户端；确认发布成功，排查 KV/客户端缓存传播，而不是反复改 Secret |
| AI 组不可用 | 是否有名字匹配台湾的节点；ChatGPT 探测要求 200，不代表实际账号和所有 AI 功能都可用 |
| Tailscale 不通 | 系统网卡、登录、内核支持、key 有效性及 tailnet 路由/访问规则；本项目不配置这些外部条件 |
| DNS 排除未生效 | 客户端是否重写了订阅 DNS；查看本机最终运行配置 |

回滚原则：规则和模板是两份独立产物，回退源码不会自动恢复已发布数据。恢复已知正常的源码/Secrets 后，按“规则 → 兼容 Worker → 模板”的顺序重跑需要恢复的流程，并在设备验证。修改 Secrets 前自行安全备份，Git 不保存 Secret 历史。

密钥泄露时：轮换订阅私有路径、受影响机场凭据及 Tailscale key，重新发布并更新设备；删除聊天记录或提交不等于撤销凭证。

## 8. 维护设计与验证范围

现有规则构建 Module（模块）已经把多种输入 Adapter（适配实现）收敛到解析、合并、输出的 Interface（调用者需要了解的规则）。保持这条链路，没必要再加通用框架。

优先改进模板链路：让规则构建与模板生成复用配置校验；将模板与 Worker 之间的占位符约定作为明确 Seam（可替换行为的连接点），用“渲染 → Worker 四种模式 → YAML/内核校验”测试它。这样能把错误和验证集中在一个地方，而不是让用户记住隐含约束。

回归测试覆盖规则构建、输出目录保护、私有模板解析、Worker 四种注入模式及相关错误输入。三条发布流水线都会先运行离线测试，失败即停止；模板渲染也会在写出前验证注入结果。测试不连接真实 KV、机场或 Tailscale，也不代替真实客户端内核验收。每次涉及这些行为的变更都应在测试设备验证后再扩散。

上游来源和许可证元数据见 [sources.json](<sources.json>)，产物中保留来源说明。不同来源包含 AGPL-3.0、GPL-3.0、MIT 等声明，不应把全部聚合规则直接视为 MIT；重新分发前核实各上游许可要求。
