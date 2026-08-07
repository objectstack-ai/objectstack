// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5840, ADR-0110 D3 — event side] An `object` metadata event whose re-read
 * FAILED is not an object that no longer has a body.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * `subscribeToMetadataEvents` re-reads the changed object through the metadata
 * service ("the loader chain (FS, DB, attached repository)", per its own
 * comment) and re-registers it. The read went through `MetadataManager.get()`,
 * which answered an unreachable loader chain with the same `undefined` a
 * deleted object produces — `loadDiagnosed` computed the `degraded` verdict and
 * `load()`/`get()` dropped it two hops before this call site (#5840).
 *
 * So the `else` branch logged, at `debug`, that the "metadata service has no
 * fresh body" — an assertion about what is declared, made from a read that
 * never happened — and the registry silently kept the PREVIOUS definition.
 *
 * ---------------------------------------------------------------------------
 * Why `warn` here and `error` in `restoreMetadataFromDb` (#5897)
 * ---------------------------------------------------------------------------
 * The sibling file next to this one pins an `error` for the boot-side outage,
 * and copying that by analogy would be the mirror-image mistake AGENTS.md
 * "Degradation log levels" warns about. The level is decided by that section's
 * own question, asked honestly: does something this code CLAIMS IS PERSISTED
 * fail to land while the system looks normal? No. The write already landed in
 * the metadata store — the event is what announces it. What failed is a
 * re-READ, and the registry keeps serving the definition it already holds, so
 * this kernel's copy is behind rather than lost. Functional degradation →
 * `warn`. It would also fire once per event during an outage, where the boot
 * line fires once per process.
 *
 * What the level does NOT excuse is silence about the cost: the line owes the
 * consequence (stale schema served, nothing retries) and the fix, neither of
 * which the `debug` line it replaces carried.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, taken on the CONSUMER: this file feeds the service double's
 * return contract directly, so reverting `MetadataManager.getDiagnosed` cannot
 * move it — only restoring the plain `metadataService.get(...)` read (and with
 * it the single `else`) can. Predicted: the three outage cases go red, on the
 * assertion that the `debug` "no fresh body" line did NOT fire, and the two
 * unaffected cases (a real body, a genuine miss) stay green — they never
 * depended on the verdict.
 *
 * The service double declares `subscribe` / `get` / `getDiagnosed` and no
 * engine write verb, so there is no `delete`/`update` dispatch for
 * `check:engine-double-contract` to scan and no guard to hand-mirror.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type AnyRecord = Record<string, any>;

const LOADER_FAILURE = 'database: connect ECONNREFUSED 10.0.0.5:5432';

function makeCtx() {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger, getService: vi.fn(), hook: vi.fn() } as AnyRecord;
}

/** A registry that records what was re-registered, so "kept the old body" is observable. */
function makeRegistry() {
  return {
    invalidate: vi.fn(),
    registerObject: vi.fn(),
  };
}

function makePlugin(registry: AnyRecord) {
  return new ObjectQLPlugin({ ql: { registry } as unknown as ObjectQL });
}

/**
 * Wire the subscription and hand back the handler the plugin registered — the
 * seam under test is what that handler does with the read's verdict.
 */
function subscribeAndCapture(metadataService: AnyRecord, plugin: AnyRecord, ctx: AnyRecord) {
  let handler: ((evt: AnyRecord) => Promise<void>) | undefined;
  metadataService.subscribe = vi.fn((_type: string, h: any) => {
    handler = h;
    return () => {};
  });
  plugin.subscribeToMetadataEvents(metadataService, ctx);
  if (!handler) throw new Error('plugin did not register a handler');
  return handler;
}

/** A metadata service whose loader chain is DOWN. */
const serviceInOutage = () => ({
  get: vi.fn(async () => undefined),
  getDiagnosed: vi.fn(async () => ({ data: undefined, degraded: true, errors: [LOADER_FAILURE] })),
});

/** A metadata service that answered, and the object genuinely has no body. */
const serviceWithMiss = () => ({
  get: vi.fn(async () => undefined),
  getDiagnosed: vi.fn(async () => ({ data: undefined, degraded: false, errors: [] })),
});

/** A healthy service holding `body`. */
const serviceHolding = (body: unknown) => ({
  get: vi.fn(async () => body),
  getDiagnosed: vi.fn(async () => ({ data: body, degraded: false, errors: [] })),
});

/** A service that predates `getDiagnosed`. */
const legacyService = (body?: unknown) => ({ get: vi.fn(async () => body) });

const linesAt = (ctx: AnyRecord, level: 'debug' | 'info' | 'warn' | 'error'): string[] =>
  ctx.logger[level].mock.calls.map((c: unknown[]) => String(c[0]));

describe('ObjectQLPlugin metadata events — an unreadable loader chain is not "no body" (#5840)', () => {
  it('stops claiming the service "has no fresh body" when the read never happened', async () => {
    const ctx = makeCtx();
    const registry = makeRegistry();
    const handler = subscribeAndCapture(serviceInOutage(), makePlugin(registry) as any, ctx);

    await handler({ type: 'changed', name: 'acct' });

    // The pre-fix line, verbatim — the assertion that fails first if the
    // branch is ever dropped.
    expect(linesAt(ctx, 'debug').join('\n')).not.toMatch(/has no fresh body/);
    expect(linesAt(ctx, 'warn')).toHaveLength(1);
  });

  it('the warn line owes the consequence and the fix, like any degradation line', async () => {
    const ctx = makeCtx();
    const handler = subscribeAndCapture(serviceInOutage(), makePlugin(makeRegistry()) as any, ctx);

    await handler({ type: 'changed', name: 'acct' });

    const line = linesAt(ctx, 'warn')[0];
    // What was lost: the registry is behind, and nothing retries on its own.
    expect(line).toMatch(/PREVIOUS definition/);
    expect(line).toMatch(/stale/);
    expect(line).toMatch(/nothing retries/);
    // …and the remedy, actionable without reading the source.
    expect(line).toMatch(/connection|credentials|loaders/);
    // The failing loaders' own words ride in the structured meta slot.
    expect(ctx.logger.warn.mock.calls[0][1]).toMatchObject({
      name: 'acct',
      errors: [LOADER_FAILURE],
    });
  });

  it('is a WARN, not an error — the write already landed; only a re-read failed', async () => {
    // Deliberately asserted, not assumed: `restoreMetadataFromDb` (#5897) logs
    // `error` for its outage, and the difference between the two is the
    // AGENTS.md judgment question, not the subsystem.
    const ctx = makeCtx();
    const handler = subscribeAndCapture(serviceInOutage(), makePlugin(makeRegistry()) as any, ctx);

    await handler({ type: 'changed', name: 'acct' });

    expect(linesAt(ctx, 'error')).toEqual([]);
    expect(linesAt(ctx, 'warn')).toHaveLength(1);
  });

  it('a genuine miss still takes the debug branch — the benign case is untouched', async () => {
    const ctx = makeCtx();
    const handler = subscribeAndCapture(serviceWithMiss(), makePlugin(makeRegistry()) as any, ctx);

    await handler({ type: 'changed', name: 'acct' });

    expect(linesAt(ctx, 'debug').join('\n')).toMatch(/has no fresh body/);
    expect(linesAt(ctx, 'warn')).toEqual([]);
  });

  it('a healthy read still re-registers the fresh body, unchanged', async () => {
    const ctx = makeCtx();
    const registry = makeRegistry();
    const handler = subscribeAndCapture(
      serviceHolding({ name: 'acct', label: 'Account', _packageId: 'crm' }),
      makePlugin(registry) as any,
      ctx,
    );

    await handler({ type: 'changed', name: 'acct' });

    expect(registry.invalidate).toHaveBeenCalledWith('acct');
    expect(registry.registerObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'acct' }),
      'crm',
      undefined,
      'own',
    );
    expect(linesAt(ctx, 'warn')).toEqual([]);
  });

  it('a service that predates `getDiagnosed` behaves exactly as it did', async () => {
    // It cannot report the distinction, so it is read as "not degraded" —
    // precisely what it could express before. Both of its outcomes are pinned.
    const held = makeCtx();
    const registry = makeRegistry();
    const heldHandler = subscribeAndCapture(
      legacyService({ name: 'acct' }),
      makePlugin(registry) as any,
      held,
    );
    await heldHandler({ type: 'changed', name: 'acct' });
    expect(registry.registerObject).toHaveBeenCalledTimes(1);

    const empty = makeCtx();
    const emptyHandler = subscribeAndCapture(
      legacyService(undefined),
      makePlugin(makeRegistry()) as any,
      empty,
    );
    await emptyHandler({ type: 'changed', name: 'acct' });
    expect(linesAt(empty, 'debug').join('\n')).toMatch(/has no fresh body/);
    expect(linesAt(empty, 'warn')).toEqual([]);
  });
});
