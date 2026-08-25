import { describe, expect, test } from "vitest";
import { scoreRelevance } from "../../scripts/sync/relevance";
import type { NormalizedCandidate } from "../../scripts/sync/types";

const base: NormalizedCandidate = {
  id: "repo-issue-1",
  nodeId: "I_1",
  repository: "owner/repo",
  number: 1,
  type: "issue",
  title: "Unrelated title",
  bodyExcerpt: "Unrelated body",
  author: "alice",
  state: "open",
  labels: [],
  url: "https://github.com/owner/repo/issues/1",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  mergedAt: null,
  firstSeenAt: "2026-08-20T00:00:00.000Z",
  contentHash: "sha256:x",
};

const keywords = {
  schemaVersion: 1 as const,
  global: ["GLM", "ChatGLM", "GLM-4"],
  includePatterns: ["chat[-_ ]?glm", "glm[-_ ]?[0-9.]*"],
  excludeTerms: ["generalized linear model"],
  scenarioTerms: {
    training: ["train", "finetune"],
    inference: ["infer", "serve"],
    rl: ["rlhf", "grpo"],
  },
};

describe("deterministic GLM relevance", () => {
  test.each([
    ["GLM-4 inference bug", "", 7, "eligible"],
    ["model support", "ChatGLM finetune fails", 4, "review"],
    ["generalized linear model notes", "GLM statistics", 0, "excluded"],
    ["unrelated", "no model reference", 0, "excluded"],
  ])("scores %s", (title, bodyExcerpt, score, disposition) => {
    expect(scoreRelevance({ ...base, title, bodyExcerpt }, keywords)).toMatchObject({
      score,
      disposition,
    });
  });

  test("excludes framework scenarios when no GLM model anchor is present", () => {
    expect(scoreRelevance({
      ...base,
      title: "[Finetune] Add Qwen multimodal support",
      bodyExcerpt: "Improve infer serving and GRPO support for this model.",
    }, keywords)).toMatchObject({
      score: 0,
      disposition: "excluded",
      scenarios: [],
    });
  });

  test("does not match short scenario terms inside unrelated words", () => {
    expect(scoreRelevance({
      ...base,
      title: "GLM-4 support update",
      bodyExcerpt: "Preserve constraints for this release.",
    }, keywords)).toMatchObject({
      score: 5,
      disposition: "eligible",
      scenarios: [],
    });
  });

  test("excludes a body-only GLM mention that explicitly says the model is unaffected", () => {
    expect(scoreRelevance({
      ...base,
      title: "[Performance][ROCm] Optimize shared expert gate",
      bodyExcerpt: "Qwen is affected; glm4_moe has a shared expert but no gate.",
    }, keywords)).toMatchObject({ score: 0, disposition: "excluded" });
  });

  test("does not treat a comparison-only GLM source filename as model relevance", () => {
    expect(scoreRelevance({
      ...base,
      title: "[Bug]: LoRA on MoE Gemma 4 fails at startup",
      bodyExcerpt: "Gemma4 lacks get_expert_mapping. Other MoE models such as qwen3_moe.py, deepseek_v2.py, and glm4_moe.py implement the method.",
    }, keywords)).toMatchObject({
      score: 0,
      disposition: "excluded",
      matchedTerms: [],
      scenarios: [],
    });
  });

  test("does not admit an unrelated item from a GLM label alone", () => {
    expect(scoreRelevance({
      ...base,
      title: "[XPU] Ensure unquantized linear weight is N-contiguous",
      bodyExcerpt: "Convert the unquantized GEMM weight layout after loading for XPU.",
      labels: ["intel-gpu", "quantization", "glm"],
    }, keywords)).toMatchObject({
      score: 0,
      disposition: "excluded",
      matchedTerms: [],
      scenarios: [],
    });
  });

  test("keeps a GLM-labelled item when its body contains direct GLM evidence", () => {
    expect(scoreRelevance({
      ...base,
      title: "XPU unquantized weight layout regression",
      bodyExcerpt: "GLM-4 inference on XPU regressed after the linear weight layout changed.",
      labels: ["intel-gpu", "quantization", "glm"],
    }, keywords)).toMatchObject({ score: 5, disposition: "eligible" });
  });

  test("keeps substantive body-only GLM model declarations", () => {
    expect(scoreRelevance({
      ...base,
      title: "MTP metrics fluctuate during serving",
      bodyExcerpt: "Model: zai-org/GLM-5.2-FP8. The GLM model produces unstable speculative decoding metrics during inference.",
    }, keywords)).toMatchObject({ score: 4, disposition: "review" });
  });
});
