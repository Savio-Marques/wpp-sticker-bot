export class SentMessageTracker {
  private readonly entries = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly nowFn: () => number;

  constructor(ttlMs = 5 * 60 * 1000, nowFn: () => number = () => Date.now()) {
    this.ttlMs = ttlMs;
    this.nowFn = nowFn;
  }

  track(id: string | null | undefined): void {
    if (!id) return;
    this.prune();
    this.entries.set(id, this.nowFn() + this.ttlMs);
  }

  has(id: string | null | undefined): boolean {
    if (!id) return false;
    const expiresAt = this.entries.get(id);
    if (expiresAt === undefined) return false;
    if (this.nowFn() >= expiresAt) {
      this.entries.delete(id);
      return false;
    }
    return true;
  }

  get size(): number {
    this.prune();
    return this.entries.size;
  }

  private prune(): void {
    const now = this.nowFn();
    for (const [id, expiresAt] of this.entries) {
      if (now >= expiresAt) {
        this.entries.delete(id);
      }
    }
  }
}
