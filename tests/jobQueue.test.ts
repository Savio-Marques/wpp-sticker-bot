import { describe, expect, it } from 'vitest';
import { JobQueue, QueueFullError } from '../src/queue/jobQueue.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('JobQueue', () => {
  it('enforces maxConcurrent=2 and throws QueueFullError when maxSize is exceeded', async () => {
    const queue = new JobQueue(2, 2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let running = 0;
    let maxObserved = 0;

    const makeTask = (idx: number) =>
      queue.enqueue(async () => {
        running += 1;
        maxObserved = Math.max(maxObserved, running);
        await gates[idx].promise;
        running -= 1;
        return idx;
      });

    const p0 = makeTask(0);
    const p1 = makeTask(1);
    const p2 = makeTask(2);
    const p3 = makeTask(3);

    await expect(queue.enqueue(async () => 99)).rejects.toBeInstanceOf(QueueFullError);
    expect(queue.stats()).toEqual({ active: 2, pending: 2 });

    gates[0].resolve();
    gates[1].resolve();
    await Promise.all([p0, p1]);

    gates[2].resolve();
    gates[3].resolve();
    const results = await Promise.all([p2, p3]);
    expect(results).toEqual([2, 3]);
    expect(maxObserved).toBe(2);

    await queue.drain();
    expect(queue.stats()).toEqual({ active: 0, pending: 0 });
  });
});
