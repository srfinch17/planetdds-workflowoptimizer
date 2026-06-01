// USD per 1M tokens for Claude Haiku 4.5. Update if pricing changes — this is
// the single source of truth behind the cost dashboard.
const PRICING = {
  input: 1.0,
  output: 5.0,
  cacheRead: 0.1,
  cacheWrite: 1.25,
} as const;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface CostTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * Accumulates token usage across LLM calls and estimates the dollar cost.
 *
 * This is what makes "we barely spend anything" a NUMBER on the exec
 * dashboard instead of a claim. Every LLM call is metered; every request the
 * rule-based tier resolves never touches this — so the gap between calls made
 * and requests served IS the cost story.
 */
export class CostTracker {
  private totalsState: CostTotals = blank();

  record(usage: Usage): void {
    this.totalsState.calls += 1;
    this.totalsState.inputTokens += usage.inputTokens;
    this.totalsState.outputTokens += usage.outputTokens;
    this.totalsState.cacheReadTokens += usage.cacheReadTokens ?? 0;
    this.totalsState.cacheCreationTokens += usage.cacheCreationTokens ?? 0;
  }

  get totals(): CostTotals {
    return { ...this.totalsState };
  }

  /** Estimated spend so far, in USD. */
  get usd(): number {
    const t = this.totalsState;
    return (
      (t.inputTokens * PRICING.input +
        t.outputTokens * PRICING.output +
        t.cacheReadTokens * PRICING.cacheRead +
        t.cacheCreationTokens * PRICING.cacheWrite) /
      1_000_000
    );
  }

  reset(): void {
    this.totalsState = blank();
  }
}

function blank(): CostTotals {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}
