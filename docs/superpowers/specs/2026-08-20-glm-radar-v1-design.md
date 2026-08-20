# GLM Radar 首版设计

日期：2026-08-20  
状态：待用户复核  
产品名称：GLM Radar｜GLM 开源雷达  
副标题：追踪框架支持、修复进展与能力边界

## 1. 背景与目标

GLM Radar 是面向 GLM 系列模型使用者和框架维护者的中文信息门户。首版聚焦四个主流开源框架，自动采集与 GLM 相关的 GitHub Issue 和 Pull Request，生成可追溯的中文站内日报，并提供按硬件与使用场景分类的框架能力查询。

首版通过 GitHub Pages 公开发布，采用完全静态的读取架构。GitHub Actions 每日采集、摘要、生成数据并重新发布页面。Git 仓库中的分片 JSON 是首版的数据存储，不使用在线数据库、服务器或常驻后端，因此除 OpenAI API 调用外不产生基础设施费用。

### 1.1 首版目标

- 每日增量采集四个框架仓库中与 GLM 相关的 Issue 和 PR。
- 使用 OpenAI API 生成结构化中文摘要与分类。
- 生成可按日期查询的站内日报。
- 提供可搜索、可组合筛选的 Issue / PR 动态库。
- 提供按 NPU / GPU、训练 / 推理 / RL 分类的框架能力矩阵。
- 通过仓库配置文件和 GitHub Actions 手动运行能力完成运营管理。
- 在单个外部服务异常时继续发布已有数据，并明确显示数据新鲜度。

### 1.2 首版不包含

- 在线数据库或运行时服务端 API。
- 网站内管理员登录和可写管理后台。
- 普通用户注册、个人收藏、评论或社区投稿。
- 邮件、企业微信、飞书或 Slack 推送。
- 复杂趋势图表、排行榜或社区热度评分。
- 自动发布未经人工确认的能力矩阵变更。

## 2. 数据源范围

首版只监控以下仓库：

| 框架 | GitHub 仓库 | 默认启用 |
| --- | --- | --- |
| LLaMA-Factory | `hiyouga/LlamaFactory` | 是 |
| MindSpeed-LLM | `Ascend/MindSpeed-LLM` | 是 |
| verl | `volcengine/verl` | 是 |
| vLLM | `vllm-project/vllm` | 是 |

仓库清单保存在 `config/repositories.json`。维护者可以通过 GitHub 页面直接编辑文件或提交 Pull Request，新增、修改或停用仓库。

默认关键词集合覆盖 `GLM`、`ChatGLM`、`GLM-4` 及其大小写、分隔符和常见版本写法。全局关键词保存在 `config/keywords.json`，单仓库专属关键词保存在仓库配置中。关键词命中决定是否进入候选集合；最终分类由确定性规则与 OpenAI 结构化摘要共同完成。

## 3. 用户与运营权限

### 3.1 公开访客

无需登录即可访问首页、日报、动态库、详情页和能力矩阵。所有页面和数据文件均由 GitHub Pages 静态分发，不向浏览器暴露任何 API Key。

### 3.2 仓库维护者

首版权限直接复用 GitHub 组织和仓库权限，不建立第二套管理员账号，也不在站点中保存或校验管理员口令。生产仓库优先由专用 GitHub Organization 持有，避免依赖个人账号作为唯一控制面。

维护者身份要求：

- 每位维护者使用独立 GitHub 账号，禁止共享账号、共享密码或共享 PAT。
- 组织强制启用安全的双因素认证方式；维护者至少配置 Passkey 或硬件安全密钥，并配置 TOTP、安全密钥或 GitHub Mobile 作为恢复路径，不使用 SMS 作为唯一第二因素。
- 恢复代码离线保存，不提交到仓库、云盘公开目录或项目密码文件。
- 组织 Owner 保持最小数量，普通运营人员只授予完成配置审核和工作流运行所需的仓库角色。
- 每季度复核组织成员、外部协作者、PAT、SSH Key、Deploy Key、OAuth App、GitHub App 和 Actions Secrets，删除失效访问。

运营操作如下：

- 修改仓库或关键词：编辑 `config/*.json` 并合并到默认分支。
- 手动补采：在 GitHub Actions 中运行 `Daily GLM Sync` 工作流。
- 查看运行结果：使用 Actions 日志和工作流摘要。
- 审核能力候选：检查生成的候选文件，编辑能力配置并通过 Pull Request 发布。
- 回滚错误数据：回滚数据分支中的对应提交，再重新部署页面。

### 3.3 定时任务

`Daily GLM Sync` 工作流在默认分支上按 `Asia/Shanghai` 时区每天 08:30 运行，并同时支持 `workflow_dispatch` 手动触发。即使当天没有新条目，任务也会更新数据分支中的 `meta.json`，记录最后检查时间与同步结果，使站点能显示准确的数据新鲜度，并保持仓库持续活动。

## 4. 信息架构

### 4.1 首页

首页是一份偏编辑化的“今日技术研究简报”，而不是高密度运维大屏。

首屏包含：

- 产品名称、定位说明、最近检查时间和最近完整同步时间。
- 今日新增、已修复、待关注三个关键数字。
- 当日 AI 日报导语。
- 最值得关注的三个变化。

后续区域包含：

- 四个框架的最新动态概览。
- 新增支持、Bug 修复、未解决问题、值得关注四组日报内容。
- 能力矩阵的近期变更入口。

### 4.2 每日简报

- 默认展示最新一篇完整日报。
- 支持按日期访问历史日报。
- 日报分为新增支持、Bug 修复、未解决问题和值得关注四个板块。
- 每个条目展示框架、类型、状态、中文摘要、影响标签和 GitHub 原文链接。
- 当部分仓库同步失败时，页首显示明确的来源状态与缺失范围。

### 4.3 Issue / PR 动态库

- 支持标题、摘要、正文节选和编号搜索。
- 支持组合筛选：框架、Issue / PR、开放 / 合并 / 关闭、GLM 型号、NPU / GPU、训练 / 推理 / RL、类别和严重程度。
- 默认按最后变化时间倒序排列。
- 筛选条件写入 URL 查询参数，便于复制和分享。
- 空结果页说明当前筛选条件，并允许一键清除部分或全部筛选。
- 搜索和筛选完全在浏览器中执行，不产生服务端查询费用。

### 4.4 条目详情页

- 展示原始标题、仓库、编号、作者、创建时间、更新时间和 GitHub 状态。
- 展示中文一句话摘要、详细摘要、影响范围、严重程度和分类标签。
- 展示已采集到的关键状态变化。
- 明确区分“GitHub 原始信息”和“AI 归纳”。
- 提供 GitHub 原始页面链接、摘要生成时间和数据更新时间。

详情页不镜像完整 Issue / PR 正文或评论，只保存用于检索的有限正文节选和内容哈希。GitHub 原页面始终是完整内容的权威来源。

### 4.5 框架能力矩阵

矩阵以列表为主，支持以下筛选维度：

- 硬件：NPU、GPU。
- 场景：训练、推理、RL。
- 框架：LLaMA-Factory、MindSpeed-LLM、verl、vLLM，以及配置中新增的框架。
- GLM 型号。
- 支持状态：已支持、部分支持、实验性、计划中、不支持、未知。

每个能力条目包含能力名称、框架、GLM 型号、硬件、场景、支持状态、最低框架版本、限制条件、最近验证日期和一个或多个证据链接。移动端使用可展开列表，桌面端使用横向可读表格。

自动采集只能生成能力变更候选，不能直接修改公开矩阵。维护者确认证据后更新 `config/capabilities.json`，下一次部署生成公开数据。

### 4.6 运营入口

网站导航不展示管理后台。页脚为仓库维护者提供“查看源码”“运行状态”“提交更正”三个 GitHub 入口。运营工作在 GitHub 中完成：

1. 仓库和关键词由配置文件管理。
2. 同步运行由 Actions 页面管理。
3. 能力候选由数据分支中的候选文件承载。
4. 能力矩阵由配置文件与 Pull Request 审核流程维护。

## 5. 视觉与交互设计

整体采用受 Claude 产品气质启发的温暖、克制、编辑化风格，不复制其商标或专有图形。

- 背景使用暖米白，主文字使用深棕黑，强调色使用陶土橙，辅助色使用柔和灰褐。
- 大标题使用具有编辑感的衬线字体；正文、筛选控件和数据表格使用高可读无衬线字体。
- 主要依赖留白、细分隔线和轻微圆角组织层级，避免密集卡片、霓虹色和传统监控大屏效果。
- 状态不能只依赖颜色表达，同时提供文本、图标或形状差异。
- 动效只用于筛选切换、内容展开、加载反馈，并尊重 `prefers-reduced-motion`。
- 桌面导航采用顶部主导航；窄屏使用紧凑菜单，核心搜索与最新日报入口保持可见。

## 6. 系统架构

首版采用 Astro 静态站点、GitHub Actions 数据流水线和 GitHub Pages 发布。

### 6.1 组件边界

- 静态页面层：渲染首页、日报、条目详情和能力矩阵。
- 浏览器查询层：加载轻量索引和所需分片，执行搜索、筛选与排序。
- GitHub 采集脚本：按仓库与游标拉取变化，规范化 Issue / PR 数据。
- 关键词与相关性过滤器：先做确定性匹配，再生成待摘要记录。
- OpenAI 摘要脚本：输出符合 JSON Schema 的中文摘要与分类。
- 日报生成脚本：从指定日期的状态变化构建日报。
- 能力候选脚本：从重要 PR、Issue 和文档变化生成待审核候选。
- 数据发布脚本：验证数据、写入数据分支、构建静态站点并部署到 Pages。

每个组件只通过版本化 JSON Schema 通信。采集、摘要、日报和页面构建可独立测试。

### 6.2 分支职责

- `main`：站点源码、工作流、配置文件、Schema 和测试。
- `data`：由工作流写入的规范化数据、日报、同步元数据和能力候选。
- GitHub Pages 部署产物：工作流检出 `main` 与 `data`，构建后上传的静态文件，不提交回源码分支。

数据分支只允许工作流和授权维护者写入。正常同步不向 `main` 产生每日机器人提交。

### 6.3 每日数据流

1. 定时或手动触发 `Daily GLM Sync`。
2. 工作流检出 `main` 与 `data`，读取配置、Schema 和上次游标。
3. GitHub 采集脚本获取自上次成功同步后新建或更新的 Issue / PR。
4. 系统以 GitHub `node_id` 为外部唯一标识进行幂等更新，并记录关键状态变化。
5. 关键词过滤器筛出与 GLM 相关的记录。
6. 当内容哈希或关键状态改变时，记录进入摘要步骤。
7. OpenAI 生成结构化中文摘要并通过运行时 Schema 校验。
8. 日报脚本按北京时间日界线生成或更新当天唯一日报。
9. 能力候选脚本写入待审核文件，不修改公开能力配置。
10. 数据校验通过后提交 `data` 分支。
11. 部署工作流合并源码、配置与数据，生成搜索索引、静态详情页和 Pages 产物。
12. 部署成功后，站点展示新的 `last_published_at`；部署失败则继续提供上一版本。

### 6.4 外部服务

- GitHub REST API：获取公开仓库 Issue / PR 及其状态变化。
- OpenAI Responses API：使用结构化输出生成中文摘要和标签，请求设置 `store: false`。
- GitHub Actions：执行定时采集、测试、构建与部署。
- GitHub Pages：分发静态页面与数据文件。

## 7. 数据存储设计

首版不使用在线数据库。数据分支中的 JSON 文件是持久化数据层，Git 历史提供版本、审计与回滚。

### 7.1 文件布局

```text
data/
├── meta.json
├── manifest.json
├── reports/
│   └── 2026/08/20.json
├── items/
│   └── 2026/08.json
├── events/
│   └── 2026/08.json
├── candidates/
│   └── capabilities.json
└── schemas-version.json
```

源码分支中的人工配置：

```text
config/
├── repositories.json
├── keywords.json
└── capabilities.json
```

构建时生成但不提交的数据：

```text
dist/data/
├── search-index.json
├── capabilities.json
└── ...data 分支中的公开分片
```

### 7.2 `meta.json`

保存最后检查时间、最后完整同步时间、最近发布时间、各仓库状态、数据 Schema 版本、当前最新日报日期，以及当日 AI 摘要条数、输入/输出 Token、待处理数量、熔断原因和最近成功调用时间。公开元数据不包含 OpenAI 项目 ID、账单明细、密钥或令牌。

### 7.3 `manifest.json`

保存 GitHub `node_id` 到数据分片、内容哈希、摘要哈希和最后更新时间的映射，用于幂等更新与快速定位。Manifest 不包含大段正文。

### 7.4 `items/YYYY/MM.json`

条目固定存放在首次采集月份的分片中。每条记录包含 GitHub `node_id`、仓库、编号、Issue / PR 类型、标题、有限正文节选、作者、状态、标签、原文链接、创建/更新时间、合并时间、内容哈希，以及当前中文摘要和分类字段。

单条正文节选上限为 2,000 个 Unicode 字符。完整正文和评论不进入仓库，减少体积、重复内容与版权风险。

### 7.5 `events/YYYY/MM.json`

按事件发生月份保存状态变化，包括事件唯一键、条目引用、事件类型、旧值、新值和 GitHub 时间。事件唯一键由条目、事件类型、事件时间和值哈希组成。

### 7.6 `reports/YYYY/MM/DD.json`

以北京时间日期为唯一键，保存日报导语、四个内容分组、条目引用、来源同步完整度、模型与提示词版本、首次生成时间和最后更新时间。

### 7.7 `config/capabilities.json`

保存人工确认的能力条目，包括框架、GLM 型号、硬件、场景、能力名称、支持状态、最低版本、限制条件、验证日期和证据链接。Git 提交与 Pull Request 记录构成审核轨迹。

### 7.8 `candidates/capabilities.json`

保存自动发现的能力变更建议、来源条目、AI 理由、建议动作和生成时间。候选不会直接进入公开矩阵。

## 8. OpenAI 摘要、权限与费用控制

### 8.1 摘要与分类契约

OpenAI 响应必须通过严格 JSON Schema 校验。核心字段如下：

- `headline_zh`：不超过 40 个汉字的一句话摘要。
- `summary_zh`：事实优先的中文详细摘要。
- `models`：识别出的 GLM 型号数组。
- `hardware`：`GPU`、`NPU`、`CPU` 或 `UNKNOWN` 的数组。
- `scenarios`：`TRAINING`、`INFERENCE`、`RL`、`EVALUATION`、`OTHER` 的数组。
- `category`：`NEW_SUPPORT`、`BUG`、`FIX`、`PERFORMANCE`、`DOCS`、`COMPATIBILITY`、`OTHER`。
- `severity`：`CRITICAL`、`HIGH`、`MEDIUM`、`LOW`、`INFO`。
- `impact_scope_zh`：影响范围说明。
- `attention`：`IMMEDIATE`、`WATCH`、`ROUTINE`。
- `capability_candidate`：是否可能影响能力矩阵。
- `evidence`：仅包含输入内容中可定位的事实依据，不生成新 URL。

提示词要求模型明确区分已确认事实、作者推测和 AI 推断。Schema 校验失败或模型拒答时，本次摘要标为待重试，不覆盖已有成功摘要。

### 8.2 OpenAI 项目权限边界

GLM Radar 使用独立的 OpenAI Project 和独立服务账号，不与其他应用共用项目、服务账号或 API Key。

- 服务账号只授予 `api.responses.write`，不授予内置 `member`、`owner` 或任何 Admin API 权限。
- API Key 使用相同的 `api.responses.write` 最小 Scope，不能管理项目、用户、密钥、模型权限或账单配置。
- 项目模型权限使用 Allow List，首版只允许 `gpt-5.6-luna`。
- 项目关闭 Web Search、File Search、MCP、Code Interpreter、Hosted Shell、图片生成和其他托管工具。
- 摘要请求不传入 `tools`，只使用文本输入、文本输出和 Structured Outputs。
- OpenAI 管理员密钥不得保存到 GitHub Actions；项目权限、硬消费上限和告警由 OpenAI 控制台或单独的受控管理流程配置。
- `OPENAI_API_KEY` 只保存在 GitHub Actions Secret 中。后续账号条件允许时，使用 GitHub Actions OIDC 工作负载身份联合换取短期 OpenAI Token，并删除长期 API Key。

### 8.3 模型与单次调用限制

首版摘要调用采用以下固定边界：

| 配置 | 首版值 |
| --- | --- |
| 模型 | `gpt-5.6-luna` |
| 推理强度 | `none` |
| 单条最大输入 | 8,000 Tokens |
| 单条最大输出 | 800 Tokens |
| 日报最大输入 | 12,000 Tokens |
| 日报最大输出 | 1,200 Tokens |
| Structured Outputs | 必须启用严格 JSON Schema |
| Schema 失败重试 | 最多 1 次 |
| 评论历史 | 默认不发送 |
| API 存储 | `store: false` |

输入超限时，优先保留标题、标签、环境信息、复现步骤、预期/实际行为和结论；正文中部按确定性规则截断。截断状态写入摘要元数据。输出达到上限或不符合 Schema 时不发布不完整摘要。

### 8.4 项目级硬限制与告警

OpenAI Project 配置以下生产保护：

- 月度硬消费上限：10 美元。
- 月度费用告警：5 美元、8 美元和 9.5 美元。
- 速率限制：每分钟最多 30 次请求。
- Token 速率限制：每分钟最多 150,000 Tokens。

以上限制不得高于组织为该项目提供的实际额度。硬消费上限是最终费用保护；费用告警用于人工响应，不能替代硬上限。运行工作流只持有 Responses 写入权限，不能读取或修改这些管理设置。

### 8.5 工作流日预算与熔断

`Daily GLM Sync` 在平台硬限制之前执行第二层软件控制：

- 每个北京时间自然日最多摘要 120 条新增或实质变化的记录。
- 超出 120 条的记录按关注级别和更新时间排序后进入待处理队列，后续任务继续处理，不丢弃。
- 每次请求前估算输入与最大输出 Tokens，并按当前价格配置计算预估费用，再增加 10% 安全余量。
- 当日预估费用达到 0.35 美元时停止新的摘要请求；日报生成也必须计入同一预算。
- 从每个成功响应的 `usage` 字段累计实际输入、输出和总 Tokens，写入私有工作流摘要与公开的聚合运行状态。
- 网络错误、`5xx` 或明确可重试的限流响应最多重试一次，并遵守 `retry-after`。
- 遇到余额不足、项目硬上限、权限错误、模型不在白名单或连续两次失败时立即打开熔断，不切换到更贵模型。
- 熔断后继续保存和发布 GitHub 原始元数据，将未完成记录标记为“摘要待生成”。
- 下一次定时或维护者手动运行时重新检查熔断条件；不存在自动绕过硬上限的机制。

截至 2026-08-20，设计基准价格为 `gpt-5.6-luna` 每百万输入 Tokens 0.20 美元、每百万输出 Tokens 1.20 美元。120 条记录全部达到单条上限时，基础估算为每天 0.3072 美元；加入 10% 安全余量并计入一篇日报后仍受 0.35 美元日预算约束。价格只作为本地预估，OpenAI Project 的实际计费与 10 美元硬上限为最终依据。价格配置必须版本化，并在模型或价格调整前由维护者审核。

## 9. 查询设计

由于 GitHub Pages 没有运行时后端，查询采用“预生成索引 + 按需分片加载”：

- 构建阶段从全部条目生成轻量 `search-index.json`。
- 索引包含条目 ID、标题、摘要、框架、状态、分类、严重程度、型号、硬件、场景、时间和分片路径。
- 首页只加载 `meta.json`、最新日报和框架概览。
- 动态库首次进入时加载搜索索引，不加载所有正文节选。
- 用户打开详情时再加载对应月份分片。
- 能力矩阵加载单独的 `capabilities.json`。
- 页面资源使用内容哈希和长期缓存；`meta.json` 使用短缓存，确保新版本可被发现。

索引达到 5 MB 未压缩时，改为按年份或框架分片；单个月度条目文件达到 2 MB 未压缩时，改为按仓库与月份二级分片。以上阈值由构建检查强制执行。

## 10. 幂等性、失败与恢复

- 同步以仓库为隔离单元；单个仓库失败不阻塞其他仓库。
- 只有仓库完整处理成功后才推进该仓库游标。
- GitHub 数据以 `node_id` 幂等更新；事件使用事件唯一键去重。
- 每个日期只有一篇日报，重复运行更新同一文件。
- 内容哈希与摘要来源哈希一致时不重复调用 OpenAI。
- GitHub 限流时遵守 `retry-after` 或 `x-ratelimit-reset`，不进行紧密重试。
- OpenAI 临时失败最多重试一次；达到上限后记录待重试状态并按第 8.5 节执行熔断。
- 超过每日条目上限或费用预算时，不丢弃记录，而是写入待处理队列。
- OpenAI 权限错误、模型白名单错误、余额不足或项目硬上限错误不会触发模型降级或更换密钥，而是立即停止当日摘要。
- 摘要失败不阻止原始元数据发布，但页面明确标记“摘要待生成”。
- 日报生成前计算四个仓库的同步完整度；不完整时显示缺失来源，不沿用旧日报冒充今日数据。
- 数据 Schema、引用完整性或分片大小检查失败时，不提交数据分支，也不部署新页面。
- 构建或部署失败时，GitHub Pages 继续提供上一成功版本。
- 错误数据通过回滚 `data` 分支提交恢复，随后手动运行部署工作流。

## 11. 安全设计

- 站点没有管理员登录页、管理员口令、会话 Cookie 或找回密码流程；全部写权限由 GitHub 身份与仓库授权控制。
- 生产仓库使用 GitHub Organization 承载，组织要求安全 2FA，维护者使用 Passkey 或硬件安全密钥，并为账号恢复保留独立备用方式。
- `main` 分支禁止直接推送、强制推送和删除；人工变更必须通过 Pull Request、必要状态检查和至少一名授权维护者审批。
- `.github/workflows/**`、`config/**`、数据 Schema 和同步脚本由 `CODEOWNERS` 保护；相关变更必须获得指定安全负责人审批，并在新提交后撤销旧审批。
- `data` 分支禁止强制推送和删除，只允许受控同步工作流写入；人工恢复通过审核后的恢复流程执行。
- 仓库管理员不得允许 GitHub Actions 自动创建并批准自己的 Pull Request。
- OpenAI 使用独立 Project、独立服务账号和仅含 `api.responses.write` 的最小权限凭证。
- `OPENAI_API_KEY` 和可选的 `GH_SOURCE_TOKEN` 只保存在 GitHub Actions Secrets；`OPENAI_ADMIN_KEY` 禁止进入项目 Secrets。
- 工作流令牌只授予执行任务所需的最小权限：读取源码、写数据分支、发布 Pages。
- Pull Request 工作流不使用来自仓库的高权限秘密，避免外部贡献代码窃取密钥。
- 包含秘密的采集步骤只在默认分支的定时任务或维护者手动任务中运行。
- `pull_request_target` 不得用于签出或执行外部 Pull Request 代码；外部 PR 的测试令牌只读且不授予 Secrets 或 OIDC 权限。
- 第三方 GitHub Actions 固定到完整 Commit SHA，并由 Dependabot 和人工审核维护更新。
- AI 响应在写入前按 Schema 校验并进行长度限制，不直接渲染未经转义的 HTML。
- GitHub 内容在页面中作为纯文本处理；外部链接添加安全属性。
- 公开数据不包含访问令牌、邮箱、IP 地址或工作流环境变量。

## 12. 性能与成本控制

- 公开 GitHub 仓库的标准 Actions Runner 与 GitHub Pages 作为首版免费基础设施。
- 仅对关键词命中的新记录和发生实质变化的记录调用 OpenAI。
- OpenAI 项目只允许 `gpt-5.6-luna`，使用 10 美元月度硬上限和 0.35 美元工作流日预算双重控制。
- 单日最多处理 120 条摘要，超量进入待处理队列。
- GitHub 采用增量请求和条件请求，避免每次全量扫描。
- OpenAI 只接收完成摘要所需的公开正文，默认不发送评论历史。
- 日报预生成，不在访客请求过程中调用外部服务。
- 数据按月分片，浏览器按需加载。
- 构建产物不超过 GitHub Pages 1 GB 限制，源码与数据分支分别监控体积。
- GitHub Pages 月带宽接近 80 GB 或单个索引持续超过 5 MB 时，评估迁移到 CDN + Worker + D1。
- 除 OpenAI API 用量外，首版目标月基础设施费用为 0 美元。

## 13. 可访问性与响应式要求

- 所有交互元素支持键盘操作并具有清晰焦点状态。
- 表单控件具有可见标签和可读错误信息。
- 状态同时使用文字与颜色，不以颜色作为唯一含义。
- 正文、次要文字和状态标签满足可读对比度。
- 桌面能力矩阵使用表格语义；移动端转换为可展开的定义列表。
- 动画尊重减少动态效果的系统偏好。
- JavaScript 加载失败时，首页、日报正文和详情核心内容仍可阅读；动态筛选可降级为静态列表。

## 14. 测试与验收

### 14.1 自动测试

- 配置文件与全部数据文件的 JSON Schema 测试。
- 仓库规则、`CODEOWNERS` 覆盖范围、工作流最小权限和禁止 `pull_request_target` 的静态策略测试。
- 第三方 Action 完整 Commit SHA 固定、Secret 引用边界和高权限 Job 触发条件测试。
- 关键词规范化与相关性过滤单元测试。
- GitHub Issue / PR 规范化与幂等更新测试。
- 状态事件去重测试。
- OpenAI 结构化输出合约测试，使用固定响应替身，不在测试中调用真实 API。
- 模型白名单、无工具请求、推理强度和输入/输出 Token 上限测试。
- 120 条每日上限、0.35 美元日预算、10% 估算余量和待处理队列测试。
- Schema 失败只重试一次、可重试限流退避以及权限/余额/硬上限立即熔断测试。
- 响应 `usage` 聚合、公开字段脱敏和价格配置版本测试。
- 日报分组、日期边界和重复生成测试。
- 能力候选生成与人工配置发布测试。
- 搜索、组合筛选、URL 状态和空结果测试。
- 单仓库失败、GitHub 限流、OpenAI 失败和部分日报的流水线测试。
- Manifest 引用、分片路径、文件大小和重复 ID 检查。
- Astro 静态构建与 GitHub Pages 子路径部署测试。

### 14.2 首版验收

- 四个仓库均可完成真实增量采集。
- 连续运行两次不会产生重复条目、事件或日报。
- 结构化摘要字段完整，失败记录可在后续任务中安全重试。
- 生产 OpenAI Project 只允许 `gpt-5.6-luna` 和 Responses 写入权限，全部无关托管工具关闭。
- 10 美元月度硬上限、三档费用告警、速率限制和工作流日预算均已配置并通过受控测试验证。
- 超过每日条目或费用预算时，任务停止调用 OpenAI，但继续发布原始数据并保留待处理记录。
- 首页展示最新日报、重点变化和真实数据时间。
- 动态库支持全部约定维度的组合筛选。
- 能力矩阵能按硬件、场景和框架查询，并展示证据。
- 维护者可以修改仓库、关键词和能力配置，手动补采并查看运行结果。
- 站点不存在管理员口令；GitHub 组织安全 2FA、维护者 Passkey、分支保护、`CODEOWNERS` 和最小仓库权限均已启用。
- 未经审批的账号不能修改配置、工作流、Schema、同步脚本或生产数据分支。
- GitHub 或 OpenAI 单独故障时，Pages 仍能展示上一成功数据与准确同步状态。
- GitHub Pages 自定义 Actions 工作流可完成构建和发布。
- 桌面、平板和手机均可使用，核心浏览流程支持键盘完成。

## 15. GitHub 配置

### 15.1 仓库设置

- 使用专用 GitHub Organization 持有公开仓库，以获得 GitHub Pages 和标准 Actions Runner 的免费额度，并避免个人账号成为唯一控制面。
- Organization 要求所有成员和外部协作者使用安全的双因素认证方式；Owner 保持最小数量。
- Pages 来源设置为 GitHub Actions。
- `main` 规则集禁止直接推送、强制推送和删除，要求 Pull Request、状态检查、审批和会话解决后才能合并。
- `.github/workflows/**`、`config/**`、`schemas/**` 和同步脚本通过 `CODEOWNERS` 要求指定负责人审批。
- `data` 分支禁止强制推送和删除，只允许同步工作流身份写入；授权维护者只能通过受控恢复流程修改。
- Actions 工作流显式声明最小 `permissions`。
- 仓库设置禁止 GitHub Actions 创建并批准自己的 Pull Request。
- 启用 Secret Scanning、Push Protection、Dependabot Alerts、Dependabot Updates 和 CodeQL 工作流扫描。

### 15.2 Secrets

- `OPENAI_API_KEY`：独立 OpenAI Project 中服务账号的 `api.responses.write` 最小权限 API Key；启用 OIDC 后删除。
- `GH_SOURCE_TOKEN`：只读 Fine-grained PAT；当内置 `GITHUB_TOKEN` 对跨仓库公共 API 的限额不足时启用。

`OPENAI_ADMIN_KEY` 不得配置为仓库、组织或 Environment Secret。站点不需要管理员口令、会话密钥、定时任务密钥或数据库凭据。

### 15.3 工作流

- `ci.yml`：Pull Request 和默认分支测试。
- `daily-sync.yml`：每天 08:30 采集、摘要、写入数据分支并触发部署。
- `deploy-pages.yml`：检出源码与数据分支、生成索引、构建并部署 Pages。
- `rebuild-pages.yml`：维护者手动重新构建，不重新采集或调用 OpenAI。

## 16. 后续迁移条件

出现任一情况时，评估迁移到 GitHub Pages + Cloudflare Worker + D1：

- 必须提供网站内可写管理后台。
- 需要用户账号、收藏、订阅或社区投稿。
- 搜索索引持续超过 5 MB，浏览器端查询体验下降。
- 构建产物或数据仓库接近 GitHub Pages 体积限制。
- 页面流量接近 GitHub Pages 月带宽软限制。
- 每日同步需要队列、并发任务或更精细的失败恢复。

迁移时保留现有 JSON Schema，批量导入 D1；公开页面的数据契约保持不变，减少前端改造。

## 17. 参考资料

- [GitHub Pages 使用限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [GitHub Actions 计费与免费额度](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [GitHub 定时工作流](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [GitHub REST API 限流](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2026-03-10)
- [GitHub REST API 最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api?apiVersion=2026-03-10)
- [GitHub 账号身份认证与 2FA](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github)
- [GitHub Passkey](https://docs.github.com/en/authentication/authenticating-with-a-passkey)
- [GitHub Organization 强制安全 2FA](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-two-factor-authentication-for-your-organization/requiring-two-factor-authentication-in-your-organization)
- [GitHub Actions 安全使用](https://docs.github.com/en/actions/reference/security/secure-use)
- [OpenAI API 快速开始](https://platform.openai.com/docs/quickstart/make-your-first-api-request)
- [OpenAI Responses API 结构化输出](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal/delta?lang=curl)
- [OpenAI GPT-5.6 Luna 模型与价格](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI 项目模型、工具、速率与费用控制 API](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/projects)
- [OpenAI 最小权限服务账号](https://developers.openai.com/api/docs/guides/terraform/service-accounts)
- [OpenAI GitHub Actions 工作负载身份联合](https://developers.openai.com/api/docs/guides/workload-identity-federation/github-actions)
- [Cloudflare D1 定价（后续迁移参考）](https://developers.cloudflare.com/d1/platform/pricing/)
