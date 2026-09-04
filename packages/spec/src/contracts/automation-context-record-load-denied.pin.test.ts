// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14244] `AutomationContext.recordLoadDenied` is exactly the producer's
 * shape — `{ recordLoadDenied?: true }`, the return type of
 * `actionRecordLoadSignal` (`@objectstack/runtime`, `action-execution.ts`) —
 * the flow face of #14143's handler-face signal, MIRRORED rather than
 * respelled (triage ruling on #14244, 2026-09-02: the key must mirror the
 * producer's spelling rather than invent a second one).
 *
 * Four things are pinned, because each drifts on its own:
 *
 *  1. **The key's type, at the type level.** Exactly `true | undefined` — a
 *     widening to `boolean` would let a producer emit `false`, which the
 *     handler face documents it never does (`ctx.recordLoadDenied === true`,
 *     absent otherwise). A TypeScript interface member has no Zod schema, so
 *     the only assertion is a compile-time identity (`Eq`, the
 *     `automation-result-status.pin.test.ts` form), read by
 *     `check:test-typecheck` under `tsconfig.test.json`.
 *  2. **Additive.** A context literal WITHOUT the key still type-checks, so no
 *     existing caller of `IAutomationService.execute` moves.
 *  3. **`false` is refused at compile time** (`@ts-expect-error`). A phantom
 *     unless this file is compiled — and it is: `tsconfig.test.json` includes
 *     `src/**`, and its ledger (`test-typecheck-debt.json`) lists this file
 *     nowhere, so the file must compile with exactly zero errors.
 *  4. **The JSDoc says who sets it, and that the flow face now populates it.**
 *     Prose is unassertable except by reading it; the contract source is read
 *     and the doc block above the key is required to name the producer and the
 *     populated state. [#15168] This assertion used to require the opposite —
 *     a "NOT YET POPULATED" sentence — precisely so that the day the runtime
 *     half landed, this test would tell its author which sentence to retire.
 *     It did; the sentence is retired, and the pin now refuses its return.
 *
 * ⛔ Not pinned HERE, deliberately: that any flow run actually RECEIVES the
 * key. That is the runtime half's own pin — `packages/runtime`'s
 * `action-record-load-denied.test.ts` drives both doors (`dispatchFlowAction`
 * via REST `/actions` and via the MCP `run_action` bridge) against a
 * row-scoped engine and reads the context the automation service is handed.
 * A type-level contract test cannot assert a runtime wiring, and a copy of
 * that assertion here would be a second, weaker one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import type { AutomationContext, IAutomationService } from './automation-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert< T extends true > = T;

/**
 * Exported deliberately — an unread alias inside a test body is TS6196, and a
 * pin no program compiles is no pin at all.
 */
export type RecordLoadDeniedIsExactlyTrueOrUndefined = Assert< Eq< AutomationContext['recordLoadDenied'], true | undefined > >;
/** The producer's return shape, spelled here as the runtime spells it. */
type ProducerSignal = { recordLoadDenied?: true };
/** The contract key is assignable FROM the producer's signal — the mirror holds in the direction that matters. */
export type ProducerSignalSpreadsIntoContext = Assert< Eq< ProducerSignal['recordLoadDenied'], AutomationContext['recordLoadDenied'] > >;

/** Positive control (additive): the key is optional, so a pre-#14244 context still type-checks. */
export const contextWithoutTheKey: AutomationContext = { record: { id: 'rec-1', name: 'Alice' }, object: 'crm_deal', userId: 'u1' };
/** The one value the key may carry. */
export const contextWithTheKey: AutomationContext = { record: { id: 'rec-1' }, object: 'crm_deal', userId: 'u1', recordLoadDenied: true };
// @ts-expect-error — `false` is not a member: the key is ABSENT, never `false` (handler-face convention, mirrored).
export const contextWithFalse: AutomationContext = { record: { id: 'rec-1' }, object: 'crm_deal', recordLoadDenied: false };

describe('[#14244] AutomationContext.recordLoadDenied mirrors the producer signal', () => {
  it('reads the key back as exactly `true`, and its absence as `undefined` (anti-vacuity)', () => {
    expect(contextWithTheKey.recordLoadDenied).toBe(true);
    expect(contextWithoutTheKey.recordLoadDenied).toBeUndefined();
    expect('recordLoadDenied' in contextWithoutTheKey).toBe(false);
  });

  it('a service implementation can guard on it WITHOUT a cast, the way a runAs:system flow would', async () => {
    const seen: Array<true | undefined> = [];
    const service: IAutomationService = {
      execute: async (_flowName, context?) => {
        seen.push(context?.recordLoadDenied);
        // The documented predicate, verbatim: `=== true`, never a truthiness of `false`.
        if (context?.recordLoadDenied === true) return { success: false, error: 'RECORD_NOT_FOUND' };
        return { success: true };
      },
      listFlows: async () => [],
    };
    expect((await service.execute('guarded', contextWithTheKey)).success).toBe(false);
    expect((await service.execute('guarded', contextWithoutTheKey)).success).toBe(true);
    expect(seen).toEqual([true, undefined]);
  });

  it('the contract JSDoc names the producer, both doors, and the not-yet-populated flow face', () => {
    const source = readFileSync(fileURLToPath(new URL('./automation-service.ts', import.meta.url)), 'utf8');
    const declaration = 'recordLoadDenied?: true;';
    const at = source.indexOf(declaration);
    expect(at).toBeGreaterThan(-1);
    // Exactly one declaration of the key on the contract — a second spelling
    // anywhere in this file is the drift the ruling forbids.
    expect(source.indexOf('recordLoadDenied', at + declaration.length)).toBe(-1);
    // The doc block immediately above the declaration — from its last `/**`.
    const docStart = source.lastIndexOf('/**', at);
    const doc = source.slice(docStart, at);
    expect(doc).toContain('loadActionSubjectRecord');
    expect(doc).toContain('actionRecordLoadSignal');
    expect(doc).toContain('{ recordLoadDenied?: true }');
    expect(doc).toMatch(/both doors/i);
    expect(doc).toMatch(/run_action/);
    expect(doc).toMatch(/runAs: 'system'/);
    // [#15168] The honesty clause, now the other way round: the runtime half
    // landed, so the doc must say the flow face IS populated and must no longer
    // carry the retired sentence. Both directions are asserted — the positive
    // alone would survive a doc that says both things at once, and the negative
    // alone is satisfied by deleting the paragraph altogether, which is how a
    // contract loses the record of who populates a key.
    expect(doc).toMatch(/Populated on the flow face/);
    expect(doc).not.toMatch(/NOT YET POPULATED/);
    expect(doc).toContain('dispatchFlowAction');
    // Absence semantics, in the handler face's own words.
    expect(doc).toMatch(/never\s+\*?\s*`false`/);
  });
});
