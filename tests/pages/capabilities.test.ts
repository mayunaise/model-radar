import { describe, expect, test } from "vitest";
import { readBuilt } from "../helpers/build-site";

describe("capability matrix page", () => {
  test("publishes evidence-backed capability rows and methodology", async () => {
    const html = await readBuilt("capabilities/index.html");

    expect(html).toContain("框架能力矩阵");
    expect(html).toContain("NPU");
    expect(html).toContain("GPU");
    expect(html).toContain("待核实");
    expect(html).toContain("证据与审核方法");
    expect(html).toContain('data-label="框架"');
    expect(html).toContain('rel="noreferrer"');
  });
});
