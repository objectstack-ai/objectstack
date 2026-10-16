// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `defineStack`'s one internal parameter: a non-strict call whose options
 * carry `Symbol.for('objectstack.stack.authoredInput')` returns its input AS
 * AUTHORED — normalised and marked as every non-strict output is, with the
 * load-time ADR-0087 D2 conversion pass skipped (#22256).
 *
 * Its one caller is the CLI's authored-source load for `os migrate meta`,
 * which produces each `composeStacks` input again this way so that
 * composition assembles each package body from what the author wrote, and
 * the migration chain can list and write a conversion the load would
 * otherwise have applied out of its sight. What is pinned here:
 *
 *  - the non-strict call with the key keeps the authored spelling, is marked,
 *    and records no conversion; the same call without it (the control)
 *    converts and records it;
 *  - a strict call ignores the key, so it can never let an old spelling reach
 *    the strict parse unconverted;
 *  - `composeStacks` over such inputs assembles each `packages[i].manifest`
 *    body from the authored spelling — composition's own rule, run over the
 *    authored inputs — and over plain non-strict inputs (the control) from the
 *    converted one.
 *
 * The record (`stackConversionsOf`), not the stderr notice, is what is read:
 * the notice is printed once per process, so its absence proves nothing in a
 * file that converts the same spelling in another case.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { composeStacks, defineStack, hasStackProvenance, stackConversionsOf } from './stack.zod';
import type { MetadataConversion } from './conversions/types';

/**
 * The subject is the load-time pass ITSELF, not any one entry, so the probe is
 * a conversion this file owns: a live copy of the flow-level `retryDelayMs` →
 * `backoffMs` rename, appended to the table the pass reads. It was a real entry
 * until there was none left to borrow — `datasource-driver-mongo-to-mongodb`
 * until #23543 F1, then `retry-policy-converged` until F2 retired it too — and
 * every entry still live on the load path retires inside the same card (F4,
 * F5-http). A probe nobody retires keeps this pin about the key, not about
 * whichever entry happens to be live.
 *
 * `vi.mock` replaces the registry module for the whole file, so `apply.ts`
 * (which `defineStack` calls) reads the extended table; nothing outside this
 * file sees the probe.
 */
const PROBE = 'stack-authored-input-probe';

vi.mock('./conversions/registry', async (importOriginal) => {
  const original = await importOriginal<typeof import('./conversions/registry')>();
  const { mapCollection, renameKey } = await import('./conversions/walk');
  const probe: MetadataConversion = {
    id: 'stack-authored-input-probe',
    toMajor: 17,
    surface: 'flow.errorHandling.retryDelayMs (test probe)',
    summary: 'test-only probe: a live load-path rename for the authored-input pin',
    apply(stack, emit) {
      return mapCollection(stack, 'flows', (flow, path) => {
        const eh = flow.errorHandling;
        if (!eh || typeof eh !== 'object' || Array.isArray(eh)) return flow;
        const renamed = renameKey(eh as Record<string, unknown>, 'retryDelayMs', 'backoffMs');
        if (renamed === null) return flow;
        emit({ from: 'retryDelayMs', to: 'backoffMs', path: `${path}.errorHandling.backoffMs` });
        return { ...flow, errorHandling: renamed };
      });
    },
    fixture: { before: {}, after: {}, expectedNotices: 0 },
  };
  return { ...original, ALL_CONVERSIONS: [...original.ALL_CONVERSIONS, probe] };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Spelled here, by its registry name, exactly as the CLI spells it: the key is not exported. */
const AUTHORED_INPUT = Symbol.for('objectstack.stack.authoredInput');

/**
 * A stack the strict parse accepts, whose one non-canonical spelling is a key
 * the load converts: a flow-level retry policy's `retryDelayMs`, renamed
 * `backoffMs` by the {@link PROBE} before the parse. (The real entry,
 * `retry-policy-converged`, is retired from the load path, so without the
 * probe the strict parse would refuse this spelling at its tombstone.)
 */
const service = () => ({
  manifest: { id: 'com.probe.svc', name: 'Probe Service', namespace: 'probe', version: '1.0.0', type: 'module' as const },
  objects: [{ name: 'probe_slot', label: 'Slot', fields: { name: { type: 'text' as const, label: 'Name' } } }],
  flows: [
    {
      name: 'probe_sync',
      label: 'Sync',
      type: 'autolaunched' as const,
      errorHandling: { strategy: 'retry' as const, maxRetries: 3, retryDelayMs: 2000 },
      nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    },
  ],
});

const app = () => ({
  manifest: { id: 'com.probe.app', name: 'Probe App', namespace: 'probe', version: '1.0.0', type: 'app' as const },
  objects: [{ name: 'probe_room', label: 'Room', fields: { name: { type: 'text' as const, label: 'Name' } } }],
});

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
const ids = (value: unknown) => stackConversionsOf(value).map((n) => n.conversionId);
const errorHandlingOf = (stack: unknown) =>
  (stack as { flows: Array<{ errorHandling: Record<string, unknown> }> }).flows[0]!.errorHandling;
/** The authored spelling: `retryDelayMs` kept, no `backoffMs` invented. */
const asWritten = (stack: unknown) => {
  expect(errorHandlingOf(stack)).toMatchObject({ retryDelayMs: 2000 });
  expect(errorHandlingOf(stack)).not.toHaveProperty('backoffMs');
};
/** The converted spelling: `backoffMs` carries the value, `retryDelayMs` is gone. */
const converted = (stack: unknown) => {
  expect(errorHandlingOf(stack)).toMatchObject({ backoffMs: 2000 });
  expect(errorHandlingOf(stack)).not.toHaveProperty('retryDelayMs');
};

describe('a non-strict call carrying the key returns its input as authored', () => {
  it('keeps the authored spelling, is marked, and records nothing; without the key it converts', () => {
    quiet();
    const authored = defineStack(service() as never, { strict: false, [AUTHORED_INPUT]: true } as never);
    asWritten(authored);
    expect(hasStackProvenance(authored)).toBe(true);
    expect(stackConversionsOf(authored)).toEqual([]);

    const plain = defineStack(service() as never, { strict: false });
    converted(plain);
    expect(ids(plain)).toEqual([PROBE]);
  });

  it('a strict call ignores the key: the pass runs and is recorded', () => {
    quiet();
    const strict = defineStack(service() as never, { [AUTHORED_INPUT]: true } as never);
    converted(strict);
    expect(ids(strict)).toEqual([PROBE]);
  });
});

describe('composeStacks over inputs produced as authored', () => {
  const body = (artifact: unknown, i: number) =>
    (artifact as { packages: Array<{ manifest: unknown }> }).packages[i]!.manifest;

  it('assembles each package body from the authored spelling; over plain non-strict inputs, from the converted one', () => {
    quiet();
    const asAuthored = { strict: false, [AUTHORED_INPUT]: true } as never;
    const authored = composeStacks(
      [defineStack(service() as never, asAuthored), defineStack(app() as never, asAuthored)],
      { manifest: 'preserve' },
    );
    expect(hasStackProvenance(authored)).toBe(true);
    asWritten(body(authored, 0));
    expect(stackConversionsOf(authored)).toEqual([]);

    const plain = composeStacks(
      [defineStack(service() as never, { strict: false }), defineStack(app() as never, { strict: false })],
      { manifest: 'preserve' },
    );
    converted(body(plain, 0));
    expect(ids(plain)).toEqual([PROBE]);
  });
});
