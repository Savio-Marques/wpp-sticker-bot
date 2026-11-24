import { describe, expect, it } from 'vitest';
import { SentMessageTracker } from '../src/whatsapp/antiLoop.js';

describe('SentMessageTracker', () => {
  it('tracks IDs and expires them after TTL', () => {
    let now = 1000;
    const tracker = new SentMessageTracker(5000, () => now);

    tracker.track('MSG-1');
    tracker.track(undefined);
    expect(tracker.has('MSG-1')).toBe(true);
    expect(tracker.has('MSG-2')).toBe(false);
    expect(tracker.size).toBe(1);

    now = 5999;
    expect(tracker.has('MSG-1')).toBe(true);

    now = 6000;
    expect(tracker.has('MSG-1')).toBe(false);
    expect(tracker.size).toBe(0);
  });
});
