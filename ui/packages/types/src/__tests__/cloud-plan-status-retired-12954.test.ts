/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `cloud:plan-status` NODE TYPE is retired, and a document naming it is
 * refused BY NAME, with its remedy (objectui#12954).
 *
 * The widget, its registration and its member-by-member arm
 * (`CloudPlanStatusSchema`, objectui#10919) went when the Cloud pricing page
 * stopped placing the node (objectstack-ai/cloud#3010). The literal was
 * declared on a face, so the retirement keeps a `retiredNodeType()` arm in
 * `AnyComponentSchema` — the shape objectui#8802 ruled for the bare `kanban`
 * key (maintainer ruling 2026-09-09), pinned in
 * `bare-kanban-node-key-retired-8802.test.ts`, whose suites this file follows.
 *
 * ## ⚠️ The mechanism, which is NOT the passthrough rule
 *
 * `AnyComponentSchema` is a DISCRIMINATED union: an unclaimed literal matches no
 * arm, so deleting the arm would already refuse — with the union's remedy-free
 * `Invalid input`. The refusal arm claims the literal and answers with a
 * `custom` issue at `type` naming what to author instead. Suite 1 measures that
 * refusal and its remedy; suite 3 measures that an unknown `cloud:` literal
 * still gets the generic path, which is the control that separates the two.
 */

import { describe, it, expect } from 'vitest';
import { safeValidateSchema } from '../zod/index.zod';
import type { AnySchema } from '../index';

/* -------------------------------------------------------------------------- */
/* Compile-time pins — read by tsc -p tsconfig.test.json, not by vitest.       */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;

// The TypeScript half of the retirement: `AnySchema` has no member for the
// literal, so `tsc` refuses it at the authoring site.
type _AnySchemaHasNoPlanStatusArm = Assert<Equal<IsNever<Extract<AnySchema, { type: 'cloud:plan-status' }>>, true>>;
// Non-vacuity on the same instrument: the surviving `cloud:` arm IS selectable.
type _AnySchemaKeepsTimezoneNotice = Assert<
  Equal<IsNever<Extract<AnySchema, { type: 'cloud:workspace-timezone-notice' }>>, false>
>;

/* -------------------------------------------------------------------------- */
/* Runtime — through `safeValidateSchema`, the tolerant node union.           */
/* -------------------------------------------------------------------------- */

interface IssueLike {
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
  readonly code?: string;
  readonly errors?: readonly (readonly IssueLike[])[];
}

/** Flatten zod's nested union issues into `{ path, message, code }` rows. */
function flattenIssues(issues: readonly IssueLike[]): Array<{ path: string; message: string; code: string }> {
  return issues.flatMap((issue) => [
    { path: (issue.path ?? []).join('.'), message: issue.message ?? '', code: issue.code ?? '' },
    ...(issue.errors ?? []).flatMap((nested) => flattenIssues(nested)),
  ]);
}

function refusals(schema: unknown) {
  const result = safeValidateSchema(schema);
  return result.success ? [] : flattenIssues(result.error.issues as unknown as IssueLike[]);
}

/** The plan-card node that used to validate under the retired arm, spelled unchanged. */
const RETIRED_NODE = { type: 'cloud:plan-status', properties: { plan: 'free' } } as const;

describe('suite 1 — a `type: "cloud:plan-status"` document is REFUSED, by name (objectui#12954)', () => {
  it('refuses the document with a `custom` issue at `type`', () => {
    const found = refusals(RETIRED_NODE);
    expect(found.filter((f) => f.code === 'custom' && f.path === 'type')).toHaveLength(1);
  });

  it('the refusal names the retirement and the remedy, not just a type complaint', () => {
    // ⭐ The whole reason the arm survives as a refusal instead of being
    // deleted. Suite 3 is its control.
    const [issue] = refusals(RETIRED_NODE).filter((f) => f.code === 'custom' && f.path === 'type');
    expect(issue?.message).toContain('`cloud:plan-status` is a RETIRED node type');
    expect(issue?.message).toContain('visibleWhen');
    expect(issue?.message).toContain('/api/v1/cloud/home');
  });

  it('refuses a bare node too, whatever else it carries', () => {
    expect(refusals({ type: 'cloud:plan-status' }).filter((f) => f.code === 'custom' && f.path === 'type')).toHaveLength(1);
  });
});

describe('suite 2 — the refusal is not a validator that turned strict', () => {
  it('the surviving `cloud:` node on the same call is still accepted', () => {
    // Firing control: without it every assertion in suite 1 would also pass
    // under a `safeValidateSchema` that had started refusing everything.
    expect(refusals({ type: 'cloud:workspace-timezone-notice' })).toEqual([]);
  });
});

describe('suite 3 — control: an unknown `cloud:` literal takes the GENERIC path', () => {
  it('a `cloud:` name no arm claims is refused without the remedy text', () => {
    // ⭐ The separator. If this document ALSO carried the guidance, suite 1
    // would be measuring the union's boilerplate rather than this arm.
    const found = refusals({ type: 'cloud:no-such-widget-12954' });
    const text = found.map((r) => r.message).join('\n');
    expect(text).not.toEqual('');
    expect(found.some((f) => f.code === 'custom')).toBe(false);
    expect(text).not.toContain('visibleWhen');
    expect(text).not.toContain('RETIRED');
  });
});
