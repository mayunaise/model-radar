# History Sync and Daily Delta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the complete GLM-related GitHub history by repository and upstream creation month while rendering daily reports as importance-sorted title/status deltas only.

**Architecture:** Repository metadata owns stable storage keys, history start times, and per-run backfill limits. The GitHub boundary exposes one page at a time so the pipeline can advance persistent backfill checkpoints independently from the daily incremental cursor. Storage merges by GitHub node ID; daily reports consume changed records from the incremental path only and compact UI components render their titles and states.

**Tech Stack:** Astro 5, TypeScript, Zod, Octokit REST, Vitest, static JSON on the GitHub `data` branch.

**Spec:** `docs/superpowers/specs/2026-08-20-history-sync-daily-delta-design.md`

## Global Constraints

- Complete history means all GLM-related Issue / PR records from each configured `historyStartAt`, not unrelated repository content.
- Item shards use `items/{dataKey}/{createdAt YYYY}/{createdAt MM}.json`.
- Historical backfill never adds old records to a daily report.
- Daily report rows show only title, Issue / PR number, and current state, ordered by attention, severity, update time, and ID.
- GitHub item action links are labeled `原始链接`; narrative uses of `上游` remain unchanged.
- Existing OpenAI model, item limit, and USD 0.35 daily software budget remain unchanged.

---

### Task 1: Repository-aware item shards and manifests

**Files:**
- Modify: `config/repositories.json`
- Modify: `src/lib/domain/schemas.ts`
- Modify: `src/lib/domain/types.ts`
- Modify: `scripts/sync/store.ts`
- Modify: `src/lib/data/load.ts`
- Modify: `fixtures/bootstrap-data/manifest.json`
- Delete: `fixtures/bootstrap-data/items/2026/08.json`
- Create: `fixtures/bootstrap-data/items/{llamafactory,mindspeed-llm,verl,vllm}/2026/08.json`
- Test: `tests/config/load.test.ts`
- Test: `tests/sync/store.test.ts`
- Test: `tests/data/load.test.ts`

**Interfaces:**
- Produces: repository fields `dataKey: string`, `historyStartAt: ISODateTime`, `backfillPageLimit: positive integer`.
- Produces: `itemShard(item: ActivityItem, repositories: RepositoryConfig["repositories"]): string`.
- Produces: manifest `backfill[repository] = { status, nextPage, historyStartAt }`.

- [ ] **Step 1: Write failing repository and shard tests**

```ts
expect(config.repositories.repositories[0]).toMatchObject({
  dataKey: "llamafactory",
  historyStartAt: "1970-01-01T00:00:00.000Z",
  backfillPageLimit: 10,
});
expect(itemShard(item, config.repositories.repositories)).toBe(
  "items/vllm/2024/11.json",
);
```

- [ ] **Step 2: Run the tests and verify they fail on the current month-only layout**

Run: `npm test -- tests/config/load.test.ts tests/sync/store.test.ts tests/data/load.test.ts`

Expected: FAIL because repository storage metadata and repository-aware shard paths do not exist.

- [ ] **Step 3: Extend schemas and implement repository-aware paths**

```ts
export function itemShard(
  item: ActivityItem,
  repositories: RepositoryConfig["repositories"],
): string {
  const repository = repositories.find((entry) => entry.slug === item.repository);
  if (!repository) throw new Error(`Unknown repository: ${item.repository}`);
  const [year, month] = item.createdAt.slice(0, 7).split("-");
  return `items/${repository.dataKey}/${year}/${month}.json`;
}
```

Add `backfill` to `manifestSchema`, require unique `dataKey` values, and reject manifest shard paths outside `items/<dataKey>/<YYYY>/<MM>.json`.

- [ ] **Step 4: Split bootstrap records and update loader validation**

Move each of the four sample records into its repository shard and update every `manifest.items[*].shard`. Keep recursive item discovery unchanged and validate that manifest paths match the loaded records.

- [ ] **Step 5: Run the targeted tests**

Run: `npm test -- tests/config/load.test.ts tests/sync/store.test.ts tests/data/load.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the storage slice**

```bash
git add config/repositories.json src/lib/domain src/lib/data/load.ts scripts/sync/store.ts fixtures/bootstrap-data tests
git commit -m "feat: shard activity history by repository"
```

### Task 2: Resumable history backfill

**Files:**
- Modify: `scripts/sync/types.ts`
- Modify: `scripts/sync/github.ts`
- Modify: `scripts/sync/pipeline.ts`
- Test: `tests/sync/github.test.ts`
- Test: `tests/sync/pipeline.test.ts`

**Interfaces:**
- Produces: `GitHubGateway.listIssuesPage({ owner, repo, since, page, sort, direction })` returning `{ items, hasNextPage, rateLimit }`.
- Produces: `collectRepositoryPage(gateway, repository, request, firstSeenAt)`.
- Consumes: manifest backfill state from Task 1.

- [ ] **Step 1: Write failing single-page and resume tests**

```ts
expect(requests).toEqual([
  { repo: "vllm", page: 3, sort: "created", direction: "asc" },
  { repo: "vllm", page: 4, sort: "created", direction: "asc" },
]);
expect(result.manifest.backfill["vllm-project/vllm"]).toMatchObject({
  status: "running",
  nextPage: 5,
});
```

Also run a second batch whose final page has fewer than 100 records and expect `status: "complete"`.

- [ ] **Step 2: Run the tests and verify the current all-pages gateway cannot resume**

Run: `npm test -- tests/sync/github.test.ts tests/sync/pipeline.test.ts`

Expected: FAIL because `listIssuesPage` and persistent backfill advancement are missing.

- [ ] **Step 3: Implement one-page GitHub requests**

Backfill requests use `state: "all"`, `sort: "created"`, `direction: "asc"`, `per_page: 100`, and the persisted page. Incremental requests use `sort: "updated"`, `direction: "asc"`, start at page 1, and use the existing incremental cursor.

- [ ] **Step 4: Process bounded backfill pages and preserve checkpoints**

For each enabled repository, process at most `backfillPageLimit` pages. Advance `nextPage` only after the page has normalized successfully. Set `complete` after `hasNextPage` becomes false. If the rate-limit safety threshold is reached, retain the first unprocessed page.

- [ ] **Step 5: Keep incremental and backfill candidates separate**

Return `{ incremental, backfill, backfillState }` per repository. Deduplicate the combined candidates by `nodeId`, but retain a set of incremental node IDs for Task 3 so old backfill items cannot enter the daily report.

- [ ] **Step 6: Run targeted tests and commit**

Run: `npm test -- tests/sync/github.test.ts tests/sync/pipeline.test.ts`

Expected: PASS.

```bash
git add scripts/sync tests/sync
git commit -m "feat: add resumable github history backfill"
```

### Task 3: Same-day delta aggregation and importance ordering

**Files:**
- Create: `scripts/sync/daily-report.ts`
- Modify: `scripts/sync/pipeline.ts`
- Test: `tests/sync/daily-report.test.ts`
- Test: `tests/sync/pipeline.test.ts`

**Interfaces:**
- Produces: `hasMeaningfulChange(previous: ActivityItem | undefined, next: ActivityItem): boolean`.
- Produces: `sortDailyItems(items: ActivityItem[]): ActivityItem[]`.
- Produces: `mergeDailyReport(date, existingReport, incrementalDelta, allItems, now): DailyReport`.

- [ ] **Step 1: Write failing deterministic report tests**

```ts
expect(sortDailyItems([routine, immediate, watch]).map((item) => item.id)).toEqual([
  immediate.id,
  watch.id,
  routine.id,
]);
expect(mergeDailyReport(date, firstRun, [secondItem, firstItem], allItems, now)
  .groups.flatMap((group) => group.itemIds)).toEqual([firstItem.id, secondItem.id]);
```

Add cases proving unchanged incremental records and every backfill record are excluded, while a same-day second run unions and deduplicates IDs.

- [ ] **Step 2: Run tests and verify current `makeReport(completed)` overwrites earlier runs**

Run: `npm test -- tests/sync/daily-report.test.ts tests/sync/pipeline.test.ts`

Expected: FAIL because the current report uses only the latest `completed` array.

- [ ] **Step 3: Implement ranking and report merging**

Use numeric maps `IMMEDIATE=0`, `WATCH=1`, `ROUTINE=2`, missing=3 and `CRITICAL=0`, `HIGH=1`, `MEDIUM=2`, `LOW=3`, `INFO=4`, missing=5. Use descending `updatedAt` and ascending `id` as final tie-breakers. Emit one `daily` group whose ID order is the sorted order.

- [ ] **Step 4: Integrate only changed incremental items**

Preserve an existing record's `firstSeenAt` when updating it. Compare `contentHash` to determine meaningful changes. Pass only changed IDs from the incremental path to `mergeDailyReport`; backfill can update the complete collection but never the report.

- [ ] **Step 5: Run targeted tests and commit**

Run: `npm test -- tests/sync/daily-report.test.ts tests/sync/pipeline.test.ts`

Expected: PASS.

```bash
git add scripts/sync tests/sync
git commit -m "feat: aggregate importance-sorted daily deltas"
```

### Task 4: Compact daily rows and original-link copy

**Files:**
- Modify: `src/components/DailyReport.astro`
- Modify: `src/components/ActivityCard.astro`
- Modify: `src/components/ActivityList.astro`
- Modify: `src/pages/activity/index.astro`
- Modify: `src/pages/reports/[date].astro`
- Modify: `src/pages/reports/index.astro`
- Test: `tests/pages/activity.test.ts`
- Test: `tests/pages/reports.test.ts`

**Interfaces:**
- Consumes: daily report ID order from Task 3.
- Produces: compact accessible list rows with internal title links and `StatusBadge` state labels.

- [ ] **Step 1: Write failing rendered-page tests**

```ts
expect(activityHtml).toContain("样例：推理输出一致性修复已合并");
expect(activityHtml).toContain("PR #10004");
expect(activityHtml).toContain("已合并");
expect(activityHtml).not.toContain("阅读完整日报");
expect(activityHtml).toContain("原始链接 ↗");
expect(activityHtml).not.toContain(">上游 ↗</a>");
```

Assert that the daily list does not include summary body text or category labels, while the all-activity cards still do.

- [ ] **Step 2: Run page tests and verify the existing card grid fails the compact contract**

Run: `npm test -- tests/pages/activity.test.ts tests/pages/reports.test.ts`

Expected: FAIL because the activity日报 has no rows and archived reports use full cards.

- [ ] **Step 3: Rewrite `DailyReport.astro` as compact rows**

Resolve report IDs against `items`, preserve the report order, and render each row as title link, `Issue #n` or `PR #n`, and `StatusBadge`. When no IDs resolve, render `今日暂无新增或变化`.

- [ ] **Step 4: Reuse the component on every daily-report surface**

Render `DailyReport` inside the `/activity/` daily panel, the homepage, and `/reports/:date/`. Keep the archive link. Remove AI-summary disclaimers from the compact row area because row content is GitHub metadata only.

- [ ] **Step 5: Replace item action-link copy**

Change only direct `item.url` link labels from `上游` to `原始链接`; retain narrative phrases such as `上游证据` and `上游框架`.

- [ ] **Step 6: Run page tests and commit**

Run: `npm test -- tests/pages/activity.test.ts tests/pages/reports.test.ts`

Expected: PASS.

```bash
git add src/components src/pages tests/pages
git commit -m "feat: render compact daily change lists"
```

### Task 5: Documentation, release validation, and local handoff

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/runbook.md`
- Modify: `tests/release/release.test.ts`

**Interfaces:**
- Consumes: final data paths and backfill state from Tasks 1-4.
- Produces: operator instructions for initial backfill, resume, completion, and daily behavior.

- [ ] **Step 1: Update the data-layout and operations documentation**

Document repository/month shards, `manifest.backfill`, the separation between backfill and incremental cursors, the page limit, and the fact that backfill never populates daily reports.

- [ ] **Step 2: Add release assertions for repository shards and credential safety**

Verify the built routes still exist under the GitHub Pages base, and that no credential patterns appear in HTML, JavaScript, JSON, CSS, or SVG artifacts.

- [ ] **Step 3: Run complete verification**

Run: `npm test && npm run validate:data && npm run check && npm run build && git diff --check`

Expected: all tests pass, data validates, Astro reports zero errors/warnings/hints, ten static pages build, and diff check is clean.

- [ ] **Step 4: Refresh the retained local preview**

Reload `http://127.0.0.1:4321/activity/`, verify the compact daily rows and `原始链接` label, exercise Issue/PR category switching, then restore the user's current filter URL and keep the tab available for handoff.

- [ ] **Step 5: Commit documentation and release checks**

```bash
git add README.md docs/operations tests/release
git commit -m "docs: document history backfill operations"
```
