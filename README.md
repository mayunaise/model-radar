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

## 配置

- `config/repositories.json`：仓库、展示名称、规范仓库别名、默认分支和启用状态。
- `config/keywords.json`：GLM 别名、场景词和排除词。
- `config/capabilities.json`：经维护者审核的公开能力矩阵。
- `config/openai.json`：唯一模型、单次上限、日预算、速率和价格估算。

新增仓库或修改能力结论必须通过 Pull Request。自动采集只写能力候选，不会直接把候选发布为“已支持”。

## GitHub 发布

1. 在目标 GitHub Organization 中创建仓库并推送 `main`。
2. 创建 `data` 分支，把 `fixtures/bootstrap-data/` 的内容复制到分支根目录，确认样例标识后首次推送。
3. 在 Repository Settings → Secrets and variables → Actions 添加 `OPENAI_API_KEY`。
4. 将 Actions 的 Workflow permissions 设为 Read and write permissions，并启用允许 Actions 创建/审批 Pull Request（若组织策略要求）。
5. 在 Pages 设置中选择 GitHub Actions 作为构建来源。
6. 根据 [GitHub 安全清单](docs/operations/github-security.md)配置 `main`、`data` 和 `github-pages` 环境保护。
7. 根据 [OpenAI 费用控制](docs/operations/openai-cost-controls.md)创建独立 Project、最小权限服务账号、模型白名单和硬消费上限。
8. 手动运行 `Daily GLM Sync`，确认 `data` 分支更新后再启用每日定时任务。

定时任务使用 UTC `30 0 * * *`，对应北京时间每天 08:30。GitHub Actions 的定时触发可能有平台级延迟。

## 数据布局

```text
data/
├── meta.json
├── manifest.json
├── schemas-version.json
├── items/YYYY/MM.json
├── events/YYYY/MM.json
├── reports/YYYY/MM/DD.json
├── candidates/capabilities.json
└── search-index.json
```

每条正文节选最多 2,000 个 Unicode 字符，不采集评论和作者邮箱。公开元数据不包含 API Key、OpenAI Project ID、原始提示词或账单明细。

## 安全边界

OpenAI 调用固定使用 `gpt-5.6-luna`、`reasoning.effort: none`、严格结构化输出、`store: false`、空工具列表和最多一次重试。软件层每天最多摘要 120 条，预估费用不超过 USD 0.35（含 10% 安全余量）；平台层另设 USD 10 月度硬上限。

详细故障处置见[运行手册](docs/operations/runbook.md)。
