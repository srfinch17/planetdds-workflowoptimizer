/**
 * Server-side latency meter. The cost story lives in CostTracker + the tiered
 * path counts; this adds the "how fast" half. Kept deliberately tiny — a sum
 * and a count — so the average is the only derived number and it's obvious.
 */
export class LatencyMeter {
  private totalMs = 0;
  private n = 0;

  record(ms: number): void {
    this.totalMs += ms;
    this.n += 1;
  }

  get count(): number {
    return this.n;
  }

  get avgMs(): number {
    return this.n === 0 ? 0 : this.totalMs / this.n;
  }

  reset(): void {
    this.totalMs = 0;
    this.n = 0;
  }
}
