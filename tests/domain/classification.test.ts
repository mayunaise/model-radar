import { describe, expect, test } from "vitest";
import { classifyActivityItem } from "../../src/lib/domain/classification";

describe("deterministic activity classification", () => {
  test.each([
    ["issue", "glm-4-9b-chat推理出错", [], "BUG"],
    ["issue", "Unable to run GLM-4.5 on RTX 5090", ["usage"], "BUG"],
    ["issue", "[Bug] crash with --performance-mode", ["bug"], "BUG"],
    ["pr", "Recover GLM tool calls with missing arguments", ["glm"], "FIX"],
    ["issue", "[SM120][GLM-5.1] NVFP4 DCP/MTP stack tracker", [], "NEW_SUPPORT"],
    ["pr", "Fuse GLM attention projections", [], "PERFORMANCE"],
  ] as const)("prioritizes explicit defect evidence in %s titles", (type, title, labels, expected) => {
    expect(classifyActivityItem({ type, title, labels: [...labels], bodyExcerpt: "" })).toBe(expected);
  });

  test("does not classify a generic pull request template as documentation or new support", () => {
    expect(classifyActivityItem({
      type: "pr",
      title: "use glm-4.7 to reproduce the RARO paper",
      labels: [],
      bodyExcerpt: "Add concise overview. Read the contributor documentation, fixes, and checklist.",
    })).toBe("OTHER");
  });

  test("can still detect a defect described only in the body", () => {
    expect(classifyActivityItem({
      type: "issue",
      title: "GLM response is unusually long",
      labels: [],
      bodyExcerpt: "The generation never finishes and starts repeating.",
    })).toBe("BUG");
  });
});
