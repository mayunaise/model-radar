type BudgetConfig = {
  dailyItemLimit: number;
  dailyBudgetUsd: number;
  safetyMarginPercent: number;
  pricingUsdPerMillionTokens: { input: number; output: number };
};

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 2.5);
}

export function estimateRequestCostUsd(
  inputTokens: number,
  maxOutputTokens: number,
  config: Pick<BudgetConfig, "safetyMarginPercent" | "pricingUsdPerMillionTokens">,
): number {
  const base =
    (inputTokens * config.pricingUsdPerMillionTokens.input +
      maxOutputTokens * config.pricingUsdPerMillionTokens.output) /
    1_000_000;
  return base * (1 + config.safetyMarginPercent / 100);
}

type Reservation = { allowed: true; estimatedCostUsd: number } | { allowed: false; reason: "daily-item-limit" | "daily-budget"; estimatedCostUsd: number };

export type BudgetState = {
  itemCount: number;
  estimatedCostUsd: number;
  actualInputTokens: number;
  actualOutputTokens: number;
};

export class BudgetLedger {
  private itemCount: number;
  private estimatedCostUsd: number;
  private actualInputTokens: number;
  private actualOutputTokens: number;

  constructor(private readonly config: BudgetConfig, initialState?: BudgetState) {
    this.itemCount = initialState?.itemCount ?? 0;
    this.estimatedCostUsd = initialState?.estimatedCostUsd ?? 0;
    this.actualInputTokens = initialState?.actualInputTokens ?? 0;
    this.actualOutputTokens = initialState?.actualOutputTokens ?? 0;
  }

  private reserve(inputTokens: number, outputTokens: number, isItem: boolean): Reservation {
    const cost = estimateRequestCostUsd(inputTokens, outputTokens, this.config);
    if (isItem && this.itemCount >= this.config.dailyItemLimit) {
      return { allowed: false, reason: "daily-item-limit", estimatedCostUsd: cost };
    }
    if (this.estimatedCostUsd + cost > this.config.dailyBudgetUsd) {
      return { allowed: false, reason: "daily-budget", estimatedCostUsd: cost };
    }
    this.estimatedCostUsd += cost;
    if (isItem) this.itemCount += 1;
    return { allowed: true, estimatedCostUsd: cost };
  }

  reserveItem(inputTokens: number, maxOutputTokens: number): Reservation {
    return this.reserve(inputTokens, maxOutputTokens, true);
  }

  reserveItemUnbounded(inputTokens: number, maxOutputTokens: number): Extract<Reservation, { allowed: true }> {
    const estimatedCostUsd = estimateRequestCostUsd(inputTokens, maxOutputTokens, this.config);
    this.estimatedCostUsd += estimatedCostUsd;
    this.itemCount += 1;
    return { allowed: true, estimatedCostUsd };
  }

  reserveReport(inputTokens: number, maxOutputTokens: number): Reservation {
    return this.reserve(inputTokens, maxOutputTokens, false);
  }

  recordActualUsage(inputTokens: number, outputTokens: number): void {
    this.actualInputTokens += inputTokens;
    this.actualOutputTokens += outputTokens;
  }

  snapshot() {
    return {
      itemCount: this.itemCount,
      estimatedCostUsd: this.estimatedCostUsd,
      actualInputTokens: this.actualInputTokens,
      actualOutputTokens: this.actualOutputTokens,
    };
  }
}
