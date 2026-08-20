import { describe, expect, test } from "vitest";
import { readBuilt } from "../helpers/build-site";

describe("daily report pages", () => {
  test("publishes the latest report on the homepage with a sample warning", async () => {
    const html = await readBuilt("index.html");

    expect(html).toContain("2026-08-20 日报");
    expect(html).toContain("所有条目均为样例");
    expect(html).toContain("推理输出一致性修复已合并");
  });

  test("publishes a reverse chronological archive", async () => {
    await expect(readBuilt("reports/index.html")).resolves.toContain(
      "日报归档",
    );
  });

  test("publishes grouped report details and traceable source links", async () => {
    const html = await readBuilt("reports/2026-08-20/index.html");

    expect(html).toContain("值得关注");
    expect(html).toContain("训练与兼容");
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("AI 摘要，请回源核验");
  });
});
