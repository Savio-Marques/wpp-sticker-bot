export class QueueFullError extends Error {
  constructor(maxSize: number) {
    super(`Fila cheia (máximo de ${maxSize} tarefas pendentes).`);
    this.name = 'QueueFullError';
  }
}

interface QueuedTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export class JobQueue {
  private readonly maxConcurrent: number;
  private readonly maxSize: number;
  private readonly queue: Array<QueuedTask<unknown>> = [];
  private activeCount = 0;
  private drainWaiters: Array<() => void> = [];

  constructor(maxConcurrent = 2, maxSize = 20) {
    this.maxConcurrent = maxConcurrent;
    this.maxSize = maxSize;
  }

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.maxSize) {
      return Promise.reject(new QueueFullError(this.maxSize));
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  stats(): { active: number; pending: number } {
    return {
      active: this.activeCount,
      pending: this.queue.length,
    };
  }

  drain(): Promise<void> {
    if (this.activeCount === 0 && this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.activeCount += 1;

      Promise.resolve()
        .then(() => task.fn())
        .then(
          (result) => task.resolve(result),
          (error) => task.reject(error),
        )
        .finally(() => {
          this.activeCount -= 1;
          this.pump();
          if (this.activeCount === 0 && this.queue.length === 0) {
            const waiters = this.drainWaiters.splice(0);
            for (const wake of waiters) wake();
          }
        });
    }
  }
}
