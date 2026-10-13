// THROWAWAY (#23191 proof, reverted before review): a deliberately red test so
// Test Core's --continue=dependencies-successful can be observed on CI.
import { describe, expect, it } from 'vitest';

describe('A1 proof (throwaway)', () => {
  it('is deliberately red', () => {
    expect(1).toBe(2);
  });
});
