import { describe, expect, test } from "vitest";
import { readBuilt } from "../helpers/build-site";

describe("daily report pages", () => {
  test("publishes the latest report on the homepage with a sample warning", async () => {
    const html = await readBuilt("index.html");

    expect(html).toContain("2026-08-20 日报");
    expect(html).toContain("所有条目均为样例");
    expect(html).toContain("样例：修复 GLM 推理输出一致性");
  });

  test("publishes a reverse chronological archive", async () => {
    await expect(readBuilt("reports/index.html")).resolves.toContain(
      "日报归档",
    );
  });

  test("publishes report details with summaries and traceable item links", async () => {
    const html = await readBuilt("reports/2026-08-20/index.html");

    expect(html).toContain('class="daily-change-list"');
    expect(html).toContain("样例：修复 GLM 推理输出一致性");
    expect(html).toContain("PR #10004");
    expect(html).toContain("修复 GLM 推理输出一致性问题");
    expect(html).toContain('class="daily-item-summary"');
    expect(html).toContain("AI 摘要，请回源核验");
  });
});
