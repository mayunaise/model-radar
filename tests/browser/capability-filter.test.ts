import { describe, expect, test } from "vitest";
import {
  filterCapabilities,
  parseCapabilityFilters,
} from "../../src/scripts/capability-filter";
import type { CapabilityEntry } from "../../src/lib/domain/types";

const entries: CapabilityEntry[] = [
  {
    id: "vllm-glm-gpu-inference",
    framework: "vLLM",
    model: "GLM-4",
    hardware: "GPU",
    scenario: "INFERENCE",
    capability: "服务化推理",
    status: "supported",
    minimumVersion: "1.0.0",
    limitations: "",
    verifiedAt: "2026-08-20",
    evidence: ["https://github.com/vllm-project/vllm"],
  },
  {
    id: "mindspeed-glm-npu-training",
    framework: "MindSpeed-LLM",
    model: "GLM-4",
    hardware: "NPU",
    scenario: "TRAINING",
    capability: "训练",
    status: "unknown",
    minimumVersion: null,
    limitations: "待核实",
    verifiedAt: "2026-08-20",
    evidence: ["https://github.com/Ascend/MindSpeed-LLM"],
  },
];

describe("capability filtering", () => {
  test("combines hardware, scenario, framework, and support status", () => {
    expect(
      filterCapabilities(entries, {
        hardware: "GPU",
        scenario: "INFERENCE",
        framework: "vLLM",
        status: "supported",
      }).map((entry) => entry.id),
    ).toEqual(["vllm-glm-gpu-inference"]);
  });

  test("parses only supported URL filter keys", () => {
    expect(
      parseCapabilityFilters(
        new URLSearchParams(
          "hardware=NPU&scenario=TRAINING&framework=MindSpeed-LLM&status=unknown&x=y",
        ),
      ),
    ).toEqual({
      hardware: "NPU",
      scenario: "TRAINING",
      framework: "MindSpeed-LLM",
      status: "unknown",
    });
  });
});
