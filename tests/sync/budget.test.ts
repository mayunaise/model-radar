import { describe, expect, test } from "vitest";
import { BudgetLedger, estimateRequestCostUsd, estimateTokens } from "../../scripts/sync/budget";

const config = {
  dailyItemLimit: 120,
  dailyBudgetUsd: 0.35,
  safetyMarginPercent: 10,
  pricingUsdPerMillionTokens: { input: 0.2, output: 1.2 },
};

describe("OpenAI software budget", () => {
  test("uses a conservative UTF-8 estimate and includes the safety margin", () => {
    expect(estimateTokens("a".repeat(250))).toBe(100);
    expect(estimateRequestCostUsd(8000, 800, config)).toBeCloseTo(0.002816, 9);
  });

  test("allows at most 120 item reservations and defers the next item", () => {
    const ledger = new BudgetLedger(config);
    for (let index = 0; index < 120; index += 1) {
      expect(ledger.reserveItem(8000, 800).allowed).toBe(true);
    }

    expect(ledger.reserveItem(1, 1)).toMatchObject({
      allowed: false,
      reason: "daily-item-limit",
    });
  });

  test("admits the approved worst-case report but stops at a lower budget", () => {
    const ledger = new BudgetLedger(config);
    for (let index = 0; index < 120; index += 1) ledger.reserveItem(8000, 800);

    expect(ledger.reserveReport(12000, 1200)).toMatchObject({ allowed: true });

    const lowerBudget = new BudgetLedger({ ...config, dailyBudgetUsd: 0.34 });
    for (let index = 0; index < 120; index += 1) lowerBudget.reserveItem(8000, 800);
    expect(lowerBudget.reserveReport(12000, 1200)).toMatchObject({
      allowed: false,
      reason: "daily-budget",
    });
  });

  test("tracks actual usage independently from conservative reservations", () => {
    const ledger = new BudgetLedger(config);
    ledger.reserveItem(100, 800);
    ledger.recordActualUsage(90, 120);

    expect(ledger.snapshot()).toMatchObject({
      itemCount: 1,
      actualInputTokens: 90,
      actualOutputTokens: 120,
    });
  });

  test("continues a persisted same-day budget instead of resetting on rerun", () => {
    const ledger = new BudgetLedger(config, {
      itemCount: 120,
      estimatedCostUsd: 0.3,
      actualInputTokens: 10_000,
      actualOutputTokens: 2_000,
    });

    expect(ledger.reserveItem(1, 1)).toMatchObject({
      allowed: false,
      reason: "daily-item-limit",
    });
    expect(ledger.snapshot()).toMatchObject({
      itemCount: 120,
      estimatedCostUsd: 0.3,
      actualInputTokens: 10_000,
      actualOutputTokens: 2_000,
    });
  });

  test("records explicitly authorized unbounded maintenance reservations", () => {
    const ledger = new BudgetLedger(config, {
      itemCount: 120,
      estimatedCostUsd: 0.35,
      actualInputTokens: 0,
      actualOutputTokens: 0,
    });

    expect(ledger.reserveItemUnbounded(8000, 800)).toMatchObject({ allowed: true });
    expect(ledger.snapshot()).toMatchObject({ itemCount: 121 });
    expect(ledger.snapshot().estimatedCostUsd).toBeGreaterThan(0.35);
  });
});
