// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14384] `AutomationResult.status` is exactly
 * `'completed' | 'paused' | 'failed' | 'stranded'`, and the wire mirror
 * (`TriggerFlowResponseSchema.data.status`, `api/automation-api.zod.ts`) is
 * the same four — contract half of the #13937 shape-4 ruling (maintainer
 * 2026-09-01), which names the terminally-failed-but-repairable run on this
 * union: a resume consumed the suspension, a downstream node threw, the run is
 * recorded as failed and can be re-armed only by an explicit operator verb
 * (#13909's condition). The literal is `'stranded'`.
 *
 * Three things are pinned, because each drifts on its own:
 *
 *  1. **The union's membership, at the type level.** `status` is a TypeScript
 *     interface member, not a Zod enum, so the only thing that can assert it is
 *     a compile-time identity (`Eq`, the `automation-api.zod.test.ts` form —
 *     a widening or a narrowing on either side turns the exported alias red
 *     under `check:test-typecheck`, which reads this file).
 *  2. **Wire ↔ contract parity, at both levels.** The Zod enum's `.options`
 *     are read at runtime and compared to the same list, and its inferred
 *     type is bound to the contract's. #13078 bound the whole `data` object;
 *     this pins the ONE member the ruling added so a future member added to
 *     one side alone fails here by name.
 *  3. **The JSDoc names the condition.** The card's acceptance is a JSDoc line
 *     naming the condition, and prose is unassertable except by reading it:
 *     the contract source is read and the doc block above the union is
 *     required to say what `'stranded'` is.
 *
 * ⛔ Not pinned, deliberately: any relation to `ExecutionStatus`
 * (`automation/execution.zod.ts`, the persisted run-row vocabulary) or to
 * plugin-approvals' `StrandedRunState` — the ruling keeps the latter a
 * plugin-local report label, and whether the run ROW ever carries this word is
 * the services half's to measure (#13937).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { TriggerFlowResponseSchema } from '../api/automation-api.zod';
import type { TriggerFlowResponse } from '../api/automation-api.zod';

import type { AutomationResult } from './automation-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert< T extends true > = T;

type ContractStatus = NonNullable<AutomationResult['status']>;
type WireStatus = NonNullable<TriggerFlowResponse['data']['status']>;

/**
 * The closed union, spelled once, in declaration order. `satisfies` proves
 * every literal here is a member; the `Eq` below proves there is no member
 * that is not here.
 */
export const AUTOMATION_RESULT_STATUSES = [
  'completed',
  'paused',
  'failed',
  'stranded',
] as const satisfies readonly ContractStatus[];

/**
 * Exported deliberately — an unread alias inside a test body is TS6196, and a
 * pin no program compiles is no pin at all (`check:test-typecheck` compiles
 * this file under `tsconfig.test.json`).
 */
export type AutomationResultStatusIsExactlyTheFour = Assert< Eq< ContractStatus, (typeof AUTOMATION_RESULT_STATUSES)[number] > >;
/** Wire ↔ contract: the Zod enum's inferred type IS the interface's union. */
export type WireStatusMatchesContract = Assert< Eq< WireStatus, ContractStatus > >;

/** The wire enum, unwrapped from `.optional()` through the `lazySchema` Proxy. */
const wireStatusEnum = TriggerFlowResponseSchema.shape.data.shape.status.unwrap();

describe('[#14384] AutomationResult.status names the stranded run', () => {
  it('reads a non-empty membership (anti-vacuity)', () => {
    expect(AUTOMATION_RESULT_STATUSES.length).toBe(4);
    expect(wireStatusEnum.options.length).toBeGreaterThan(0);
  });

  it('the wire enum carries exactly the contract union, in the same order', () => {
    expect([...wireStatusEnum.options]).toEqual([...AUTOMATION_RESULT_STATUSES]);
  });

  it("names the terminally-failed-but-repairable run 'stranded' (#13937 shape 4)", () => {
    expect(AUTOMATION_RESULT_STATUSES).toContain('stranded');
    expect(wireStatusEnum.options).toContain('stranded');
  });

  it('a stranded terminal envelope parses and is PRESERVED on the wire', () => {
    // A strip-mode object drops undeclared keys silently — the #13078 lesson —
    // so parse success alone proves nothing; the value must come back out.
    const parsed = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: false,
        status: 'stranded',
        runId: 'run_stranded_001',
        error: "node 'notify' threw after the approval was consumed",
      },
    });
    expect(parsed.data.status).toBe('stranded');
    expect(parsed.data.success).toBe(false);
    expect(parsed.data.runId).toBe('run_stranded_001');
  });

  it('refuses a status outside the four, at `data.status`, as an enum violation', () => {
    const result = TriggerFlowResponseSchema.safeParse({
      success: true,
      data: { success: false, status: 'strand' },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'data.status');
    expect(issue).toBeDefined();
    expect(issue?.code).toBe('invalid_value');
  });

  it('the contract JSDoc names the condition beside the literal', () => {
    const source = readFileSync(fileURLToPath(new URL('./automation-service.ts', import.meta.url)), 'utf8');
    const declaration = "status?: 'completed' | 'paused' | 'failed' | 'stranded';";
    const at = source.indexOf(declaration);
    expect(at).toBeGreaterThan(-1);
    // The doc block immediately above the declaration — from its last `/**`.
    const docStart = source.lastIndexOf('/**', at);
    const doc = source.slice(docStart, at);
    expect(doc).toContain("`'stranded'`");
    // The condition, in the ruling's own terms: a consumed suspension, a
    // downstream throw, re-armable only by an explicit operator verb.
    expect(doc).toMatch(/consumed the\s+\*?\s*suspension/i);
    expect(doc).toMatch(/downstream node threw/i);
    expect(doc).toMatch(/explicit operator verb/i);
    // And the ruling's boundary: the plugin-local label is not promoted.
    expect(doc).toContain('StrandedRunState');
  });
});
