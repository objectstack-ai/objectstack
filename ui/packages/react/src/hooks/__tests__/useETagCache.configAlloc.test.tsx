/**
 * ObjectUI — useETagCache config-object allocation pin (objectui#6817)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `useETagCache` seeded its config ref with an inline object literal:
 *
 *   const configRef = useRef({ enabled, storage, storagePrefix, maxEntries, ttl });
 *
 * `useRef` evaluates that argument on EVERY render and keeps only the first
 * result, so every later render allocated a five-key object that was thrown
 * away. It is the same shape PR objectui#6796 repaired in `useSchemaPersistence`
 * (`useRef(createLocalStorageAdapter())`), with one difference that is the whole
 * reason this needed its own card: clearing that one's `react-hooks/refs`
 * warning REQUIRED the change, and clearing this one's did not — so the lint
 * rule structurally cannot see this half of the class, and only a test can.
 *
 * ## Why this file mocks `useRef`
 *
 * The config object is private to the hook: nothing exports it, no in-repo
 * consumer renders the hook (`packages/react/src/hooks/index.ts` exports it and
 * nothing else calls it), and its identity is deliberately invisible from the
 * outside. So "an object was allocated and discarded" has exactly one external
 * observation point — the value handed to `useRef` on each render. The wrapper
 * below records that argument and delegates to the real `useRef`, so the hook
 * still runs on genuine React.
 *
 * The pins come in pairs on purpose. Pin 1 fails on the old code (three renders
 * hand `useRef` three different objects). Pins 2a-2e pass on BOTH the old and
 * the new code, and exist to stop the over-fix: memoizing on `[]` would make
 * pin 1 pass while freezing the config at its first render — a semantics break
 * the timing pins in `useETagCache.configTiming.test.tsx` would then catch, but
 * these say it in the same file as the claim they qualify.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useETagCache, type ETagCacheConfig } from '../useETagCache';

const { seeds } = vi.hoisted(() => ({ seeds: [] as unknown[] }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useRef = (initialValue: unknown) => {
    seeds.push(initialValue);
    return (actual.useRef as (v: unknown) => unknown)(initialValue);
  };
  return { ...actual, useRef } as unknown as typeof import('react');
});

/** The five keys the hook keeps in its config ref, per useETagCache.ts. */
const CONFIG_KEYS = ['enabled', 'storage', 'storagePrefix', 'maxEntries', 'ttl'] as const;

type ConfigSeed = Record<(typeof CONFIG_KEYS)[number], unknown>;

/**
 * Every `useRef` seed recorded so far that has the config shape. The filter
 * matters: the recorder sees every `useRef` call in the rendered tree, not just
 * this hook's, so an unrelated ref elsewhere must not be counted as a config
 * allocation (and must not be able to mask one either).
 */
function configSeeds(): ConfigSeed[] {
  return seeds.filter(
    (value): value is ConfigSeed =>
      typeof value === 'object' &&
      value !== null &&
      CONFIG_KEYS.every((key) => key in (value as Record<string, unknown>)),
  );
}

beforeEach(() => {
  seeds.length = 0;
});

describe('useETagCache — the config object is built once per hook instance (#6817)', () => {
  // ---- pin 1: THE DEFECT — red before the repair, green after ---------------
  it('hands useRef the same config object on every render when nothing changed', () => {
    const { rerender } = renderHook(
      ({ ttl }: { ttl: number }) => useETagCache({ ttl, storagePrefix: 'alloc-pin' }),
      { initialProps: { ttl: 1_000 } },
    );

    rerender({ ttl: 1_000 });
    rerender({ ttl: 1_000 });

    const seen = configSeeds();
    // Three renders must have reached the ref seed, or this pin is measuring
    // nothing and the identity assertion below would pass vacuously.
    expect(seen.length).toBe(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
    expect(new Set(seen).size).toBe(1);
  });

  // ---- pin 2: NOT an over-fix — a real config change still allocates --------
  // `useMemo(..., [])` would satisfy pin 1 and freeze the config at its first
  // render. One case per key, so a dependency list missing any single one of
  // the five fails here rather than in a consumer.
  const changes: Array<{ key: string; before: ETagCacheConfig; after: ETagCacheConfig }> = [
    { key: 'enabled', before: { enabled: true }, after: { enabled: false } },
    { key: 'storage', before: { storage: 'memory' }, after: { storage: 'localStorage' } },
    { key: 'storagePrefix', before: { storagePrefix: 'p-a' }, after: { storagePrefix: 'p-b' } },
    { key: 'maxEntries', before: { maxEntries: 10 }, after: { maxEntries: 20 } },
    { key: 'ttl', before: { ttl: 1_000 }, after: { ttl: 2_000 } },
  ];

  for (const { key, before, after } of changes) {
    it(`builds a fresh config carrying the new value when \`${key}\` changes`, () => {
      const { rerender } = renderHook(
        ({ config }: { config: ETagCacheConfig }) => useETagCache(config),
        { initialProps: { config: before } },
      );

      rerender({ config: after });

      const seen = configSeeds();
      expect(seen.length).toBe(2);
      expect(seen[1]).not.toBe(seen[0]);
      expect(seen[0][key as keyof ConfigSeed]).toBe(before[key as keyof ETagCacheConfig]);
      expect(seen[1][key as keyof ConfigSeed]).toBe(after[key as keyof ETagCacheConfig]);
    });
  }

  // ---- pin 3: the recorder is real ----------------------------------------
  // If the `vi.mock` above ever stopped intercepting, every pin here would go
  // vacuously green on an empty `seeds` array except for the length assertions.
  // This states the same guarantee once, directly.
  it('records a config seed at all (the useRef interception is live)', () => {
    renderHook(() => useETagCache({ storagePrefix: 'recorder-probe' }));

    const seen = configSeeds();
    expect(seen.length).toBe(1);
    expect(seen[0].storagePrefix).toBe('recorder-probe');
  });
});
