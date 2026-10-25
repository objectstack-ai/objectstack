/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGridSchema.operators` is a retirement tombstone that names the
 * upstream spelling (objectui#9739, maintainer ruling 2026-09-18, letter C).
 *
 * ## What was ruled, and which half of it each test below holds
 *
 * Letter C, verbatim: "`operators` is removed from the published mirror and a
 * tombstone is left in its place: the key is refused by name and the refusal
 * names the correct spelling the upstream protocol declares; it is not declared
 * on the TypeScript twin". Three claims, and each one fails independently here:
 * the refusal (a parse that must go red), its BY-NAME-ness (a lit control that
 * must stay green on the same schema), the remedy it names (asserted against
 * the installed upstream package rather than against this file's own prose),
 * and the twin's silence (the absence of a `@ts-expect-error`, which is an
 * assertion in this package — see the last section).
 *
 * ## Why the remedy is re-derived here instead of pinned as a string
 *
 * A tombstone whose message names the wrong key is worse than no tombstone: it
 * spends the author's trust to send them somewhere else wrong. So the spelling
 * is NOT asserted as a literal this file chose. The upstream section below
 * parses the same two documents through `@objectstack/spec`'s own
 * `ObjectGridPropsSchema` at the version this package pins, and the assertion
 * is that the key our message names is the one upstream ACCEPTS while the key
 * our message refuses is the one upstream REFUSES. If the protocol renames it
 * again, this file reddens rather than keeping a stale instruction alive.
 *
 * ## Every zero carries a lit control on the same instrument
 *
 * `ObjectGridSchema` reaches `BaseSchema`, which is `.passthrough()` — unknown
 * keys are KEPT unexamined, not refused. So a red parse proves nothing about
 * BY-NAME refusal on its own; what proves it is an unrecognised key parsed
 * through the same schema, on the same document, staying green. Upstream is the
 * mirror image: `ObjectGridPropsSchema` is a `strictObject`, so EVERY unknown
 * key is refused there and a bare refusal would be uninformative — the control
 * there is that the refusal message singles `operators` out with a rename
 * prescription an arbitrary unknown key does not get.
 */

import { describe, it, expect } from 'vitest';
import { ObjectGridPropsSchema as SpecObjectGridPropsSchema } from '@objectstack/spec/ui';
import { ObjectGridSchema } from '../zod/objectql.zod.js';
import type { ObjectGridSchema as ObjectGridSchemaType } from '../objectql.js';

/** A control key no surface in this package or the protocol declares. */
const UNKNOWN_KEY = 'zzzNotAKeyAnySurfaceDeclares9739';

/** The minimum green `object-grid` document, shared by every case below. */
const NODE = { type: 'object-grid' as const, objectName: 'probe' };

/** What an author used to write, and what the tombstone now sends them to. */
const AUTHORED_MISSPELLING = { name: ['equals'] };
const AUTHORED_CORRECT = { create: false };

describe('objectql.zod.ts#ObjectGridSchema — `operators` is refused BY NAME', () => {
  it('refuses an authored `operators`, and the issue path names the key', () => {
    const r = ObjectGridSchema.safeParse({ ...NODE, operators: AUTHORED_MISSPELLING });
    expect(r.success).toBe(false);
    const issue = !r.success ? r.error.issues.find((i) => i.path.join('.') === 'operators') : undefined;
    expect(issue).toBeDefined();
    // The tombstone helper customises the MESSAGE only; the code stays the one
    // a bare `z.never()` reports, which is what keeps the key addressable by
    // path rather than only by prose.
    expect(issue?.code).toBe('invalid_type');
  });

  it('LIT CONTROL — an unrecognised key on the SAME document stays green', () => {
    // `BaseSchema` is `.passthrough()`. Without this control the refusal above
    // would be consistent with the whole object having turned strict, which is
    // a different and much larger contract change than the one ruled.
    const control = ObjectGridSchema.safeParse({ ...NODE, [UNKNOWN_KEY]: AUTHORED_MISSPELLING });
    expect(control.success).toBe(true);
  });

  it('carries the remedy the ruling prescribes, in the ruling’s own sentence', () => {
    const r = ObjectGridSchema.safeParse({ ...NODE, operators: AUTHORED_MISSPELLING });
    const issue = !r.success ? r.error.issues.find((i) => i.path.join('.') === 'operators') : undefined;
    // The wording IS the contract on this one: letter C refused option B
    // precisely because a refusal that does not say what to write instead
    // leaves the author guessing at a near-spelling standing right beside it.
    expect(String(issue?.message))
      .toContain('`operators` is not a key of this component; you meant `operations`');
  });

  it('writes the SAME string into the metadata channel, so docs cannot drift from the parse message', () => {
    // One argument, two author-facing channels — the invariant
    // `retirementTombstone()` exists to make unbreakable.
    const described = (ObjectGridSchema.shape.operators as { description?: string }).description;
    const r = ObjectGridSchema.safeParse({ ...NODE, operators: AUTHORED_MISSPELLING });
    const issue = !r.success ? r.error.issues.find((i) => i.path.join('.') === 'operators') : undefined;
    expect(described).toBe(String(issue?.message));
  });
});

describe('the OTHER direction — the spelling the tombstone names is still writable', () => {
  it('`operations` parses green on the same document the misspelling reddens', () => {
    // The bidirectional half the ruling's execution note calls for: the refused
    // key red, the correct key beside it still green. A tombstone that also
    // broke the remedy would be a worse failure than the silence it replaced.
    const r = ObjectGridSchema.safeParse({ ...NODE, operations: AUTHORED_CORRECT });
    expect(r.success).toBe(true);
  });

  it('a document that omits the key entirely stays green — a tombstone gates nothing else', () => {
    expect(ObjectGridSchema.safeParse(NODE).success).toBe(true);
  });

  it('the tombstone is a MEMBER, not a deletion — that is what makes the refusal loud', () => {
    // An undeclared key on a `.passthrough()` base is kept unexamined; only a
    // declared member can refuse. This is the distinction between letter C and
    // simply deleting the line.
    expect('operators' in ObjectGridSchema.shape).toBe(true);
    expect(UNKNOWN_KEY in ObjectGridSchema.shape).toBe(false);
  });
});

describe('the UPSTREAM half — the remedy is the protocol’s, re-derived from the installed pin', () => {
  it('upstream REFUSES `operators` on `object-grid` and ACCEPTS `operations`', () => {
    const refused = SpecObjectGridPropsSchema.safeParse({ objectName: 'probe', operators: AUTHORED_MISSPELLING });
    const accepted = SpecObjectGridPropsSchema.safeParse({ objectName: 'probe', operations: AUTHORED_CORRECT });

    // Together these two are the whole justification for the word our message
    // names. Either one alone would leave the rename unproven.
    expect(refused.success).toBe(false);
    expect(accepted.success).toBe(true);
  });

  it('upstream singles the misspelling out with a rename prescription an arbitrary unknown key does not get', () => {
    const named = SpecObjectGridPropsSchema.safeParse({ objectName: 'probe', operators: AUTHORED_MISSPELLING });
    const control = SpecObjectGridPropsSchema.safeParse({ objectName: 'probe', [UNKNOWN_KEY]: 1 });

    // LIT CONTROL, and it is lit in BOTH senses: it must also be refused
    // (proving the strictness is the object's, not this key's) AND it must
    // carry no rename, which is what makes the rename above a real protocol
    // statement rather than boilerplate every refusal prints.
    expect(named.success).toBe(false);
    expect(control.success).toBe(false);

    const namedText = !named.success ? named.error.issues.map((i) => i.message).join('\n') : '';
    const controlText = !control.success ? control.error.issues.map((i) => i.message).join('\n') : '';
    expect(namedText).toContain('operations');
    expect(controlText).not.toContain('operations');
  });

  it('upstream does not declare `operators` as a member at all', () => {
    const accepted = SpecObjectGridPropsSchema.safeParse({ objectName: 'probe' });
    expect(accepted.success).toBe(true);
  });
});

/* ── The TypeScript twin, which the ruling leaves ALONE ────────────────────── */

/**
 * ⛔ `operators` is NOT declared on `ObjectGridSchema` — letter C says so in as
 * many words, and letter A (declaring it) was the option refused.
 *
 * While `ObjectGridSchema` extended a `BaseSchema` carrying an index
 * signature, the literal below compiled — the signature absorbed the key as
 * `any` — and the absence of a directive on it was the measurement. This
 * docblock named the signature's removal as one way that claim would fail.
 * objectui#8347 removed it, so the compiler refuses the key too now, as an
 * UNDECLARED key with no remedy named; `_OperatorsIsNoMember` keeps the
 * "not declared" half measurable, since a refusal alone cannot tell an
 * undeclared key from a `?: never` tombstone.
 *
 * ⚠️ The asymmetry the tombstone created — the VALIDATOR refused the document
 * the COMPILER absorbed — is closed by the removal, not by widening the
 * interface: declaring the key would have written the misspelling into the
 * published TypeScript face, which the ruling refused.
 */
export const authoredOperatorsIsRefused: ObjectGridSchemaType = {
  type: 'object-grid',
  objectName: 'probe',
  // @ts-expect-error — `operators` is not declared on the twin (letter C); since objectui#8347 it is refused as undeclared
  operators: AUTHORED_MISSPELLING,
};
export type _OperatorsIsNoMember = 'operators' extends keyof ObjectGridSchemaType ? never : true;
const operatorsIsNoMember: _OperatorsIsNoMember = true;

/** LIT CONTROL: the spelling the tombstone names is a DECLARED member of the twin. */
export const authoredOperationsIsDeclared: ObjectGridSchemaType = {
  type: 'object-grid',
  objectName: 'probe',
  operations: AUTHORED_CORRECT,
};

describe('the TypeScript twin', () => {
  it('is compiled by this package’s type-check leg, which is where the two bindings above are read', () => {
    expect([authoredOperatorsIsRefused, authoredOperationsIsDeclared, operatorsIsNoMember]).toHaveLength(3);
  });
});
