# GLM Radar｜GLM 开源雷达

GLM Radar 是一个发布在 GitHub Pages 上的静态门户，每日汇总 GLM 系列模型在 LLaMA-Factory、MindSpeed-LLM、verl 和 vLLM 中的 Issue / Pull Request，并提供按 NPU / GPU、训练 / 推理 / RL 分类的能力证据矩阵。

首版没有在线数据库、后台管理页或站点口令。源码和人工配置位于 `main`，自动采集的 JSON 位于 `data`，维护权限完全由 GitHub Organization、Pull Request、CODEOWNERS 和分支规则管理。

## 本地开发

项目固定 Node 22.23.2。推荐使用项目内虚拟环境：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install nodeenv==1.9.1
.venv/bin/nodeenv --node=22.23.2 -p
source .venv/bin/activate
npm ci
npm run dev
```

如果本机已使用 nvm、fnm、mise 或 asdf，也可根据 `.nvmrc` / `.node-version` 激活同一 Node 版本，再运行 `npm ci`。

常用命令：

```bash
npm test
npm run validate:data
npm run check
npm run build
npm run sync -- --data-dir /path/to/data --dry-run
```

本地构建默认读取 `fixtures/bootstrap-data/`。它只包含明确标识的样例条目，不对应真实 Issue 或 PR。设置 `GLM_DATA_DIR` 可改为真实 `data` 分支目录。

真实本地数据持久化在被 Git 忽略的 `.local-data/` 中。使用 `npm run dev:local`、`npm run build:local` 和 `npm run sync:local` 可分别预览、构建和增量同步这份快照；重启项目不会重新全量采集。`manifest.json` 中的仓库游标与历史回填断点必须随数据目录一起保留。GitHub 上线后以独立 `data` 分支作为同一份持久化数据的正式存储，Pages 构建不会触发采集。

Pages 使用 30 天滚动混合构建：最近更新的动态详情和最近日报由 Astro 预渲染，较早内容通过固定详情外壳按需读取月份分片与单日日报 JSON。构建会发布 `data/client-index.json`、启用仓库配置以及经过公开视图过滤的条目和日报分片；API Key、同步游标、事件和运维元数据不会进入浏览器数据目录。旧的历史详情 URL 由 Pages 的 404 页面兼容跳转。该设计把 Astro 路由数量限制在最近 30 天窗口内，历史增长只增加低成本 JSON 复制，不再重复渲染全部历史页面。

经明确成本授权的运维补齐可运行 `npm run sync:local -- --full-summary-backfill`。该模式补完摘要并按上游创建日期生成缺失日报，不受项目内日预算软限制，但仍受服务商限流、余额和硬额度约束；定时工作流不得使用该参数。

单仓数据源全量补齐使用 `npm run sync:local -- --repository owner/repository --full-source-backfill --full-summary-backfill`。`--repository` 是强制安全边界，只处理指定仓库；该命令同样仅限人工运维，不得加入定时工作流。

## 配置

- `config/repositories.json`：仓库、独立数据源（GitHub / GitCode）、数据目录键、回填参数、默认分支和启用状态。
- `config/keywords.json`：GLM 别名、场景词和排除词。
- `config/categories.json`：Issue / PR 分类、显示名称、适用类型和排序。
- `config/capabilities.json`：经维护者审核的公开能力矩阵。
- `config/openai.json`：唯一模型、单次上限、日预算、速率和价格估算。

新增仓库或修改能力结论必须通过 Pull Request。停止跟踪时只把对应仓库设置为 `enabled: false`；站点停止展示和更新，但保留配置项、归档文件、摘要、事件、游标和回填进度，重新启用后可原位恢复。自动采集只写能力候选，不会直接把候选发布为“已支持”。

## GitHub 发布

1. 在目标 GitHub Organization 中创建仓库并推送 `main`。
2. 按项目内 [`glm-radar-operations`](.agents/skills/glm-radar-operations/SKILL.md) skill 初始化空的生产数据快照，校验通过后创建 `data` 分支；禁止把 `fixtures/bootstrap-data/` 复制到生产分支。
3. 创建只允许 `main` 的 `production` Environment，在其中添加 `OPENAI_API_KEY`；可选添加最小只读权限的 `GITCODE_TOKEN` 以提高 GitCode API 稳定性，公开仓库匿名同步不依赖该 Token。不要保留同名 Repository Secret。
4. 确认仓库策略允许 `publish-data` job 使用其声明的 `contents: write` 权限推送 `data`；不要允许 Actions 创建并批准自己的 Pull Request。
5. 在 Pages 设置中选择 GitHub Actions 作为构建来源。
6. 根据 [GitHub 安全清单](docs/operations/github-security.md)配置 `main`、`data` 和 `github-pages` 环境保护。
7. 根据 [OpenAI 费用控制](docs/operations/openai-cost-controls.md)创建独立 Project、最小权限服务账号、模型白名单和硬消费上限。
8. 手动运行 `Daily GLM Sync`，确认 `data` 分支更新后再启用每日定时任务。

首次上线、真实数据 dry-run、历史回填、Pages 重建和回滚的完整指令统一维护在项目内 [`glm-radar-operations`](.agents/skills/glm-radar-operations/SKILL.md) skill 中。

定时任务使用 UTC `30 0 * * *`，对应北京时间每天 08:30。GitHub Actions 的定时触发可能有平台级延迟。

## 数据布局

```text
data/
├── meta.json
├── manifest.json
├── schemas-version.json
├── items/{repository-key}/YYYY/MM.json
├── events/YYYY/MM.json
├── reports/YYYY/MM/DD.json
├── candidates/capabilities.json
└── search-index.json
```

每条正文节选最多 2,000 个 Unicode 字符，不采集评论和作者邮箱。公开元数据不包含 API Key、OpenAI Project ID、原始提示词或账单明细。

动态条目按“仓库＋上游原始创建月份”归档；`manifest.json` 保存每仓数据源指纹、日常增量游标和历史回填断点。GitHub 数据源使用标题搜索流快速定位历史 GLM 候选；GitCode 数据源使用可恢复的 Issue / PR 分页回填。所有来源进入同一套确定性相关性过滤。数据源变更会自动重置该仓库的游标与回填状态，不影响稳定的公开仓库标识和归档目录。日常同步把当天发现的新增及标题、状态变化写入当日日报；全量补齐同时按上游创建日期和可追溯状态事件日期修复或创建历史日报，不把所有历史条目堆入运维执行当天。

## 安全边界

OpenAI 调用固定使用 `gpt-5.6-luna`、`reasoning.effort: none`、低 verbosity、严格结构化输出、`store: false`、空工具列表和最多一次重试。模型按 problem / request / change 提取对象、问题、诉求、变更、影响及可定位证据，程序根据 Issue / PR 类型自然组句，通常控制在 80–300 字，复杂条目最多允许 2000 个 Unicode 字符；超限时只移除次要的完整语义片段，绝不从句中或技术名词中间截断。日报视觉截取两行、动态卡片视觉截取三行，详情页保留数据中完整摘要。已有摘要仅在标题、状态或明确的摘要格式版本升级时重新生成；正文、标签、评论或更新时间变化只同步 GitHub 数据并复用原摘要。摘要队列优先处理本轮增量与当日日报缺失项，再补历史欠账。软件层每天最多摘要 120 条，预估费用不超过 USD 0.35（含 10% 安全余量）；平台层另设 USD 10 月度硬上限。

详细故障处置见[运行手册](docs/operations/runbook.md)。
