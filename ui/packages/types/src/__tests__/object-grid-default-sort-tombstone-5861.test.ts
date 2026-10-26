/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGridSchema.defaultSort` is an ADR-0049 retirement tombstone on BOTH
 * published faces (objectui#5861 — the "C half" of the 2026-08-22 ruling on
 * objectui#4869).
 *
 * ## Why a tombstone, and not a deletion
 *
 * `@objectstack/spec` 17.3.0 converted `ObjectGridProps.defaultSort` to a
 * retired-key tombstone, and objectui#5861 removed every renderer read of it.
 * Deleting the member from this package would not have refused anything:
 *
 *   - the zod mirror reaches `BaseSchema`, which is `.passthrough()`, so an
 *     undeclared key is KEPT unexamined — the document would parse green;
 *   - the TypeScript twin extended `BaseSchema`'s `[key: string]: any`, so an
 *     undeclared key was absorbed as `any` — the literal would have compiled
 *     (since objectui#8347 a fresh literal is refused, unnamed, and a widened
 *     value still passes).
 *
 * Either way an author would write a key nothing reads and get an unsorted
 * grid with no signal. So the key stays DECLARED and unwritable on both faces:
 * `retirementTombstone()` in `zod/objectql.zod.ts` and `?: never` on the
 * interface — this package's convention (`ObjectViewSchema.viewTabBar`).
 *
 * ## Every refusal carries a lit control on the same instrument
 *
 * A red parse on a `.passthrough()` schema proves nothing about BY-NAME
 * refusal on its own; what proves it is an unrecognised key on the same
 * document staying green, and the canonical `sort` staying green beside it.
 */

import { describe, it, expect } from 'vitest';
import { ObjectGridPropsSchema as SpecObjectGridPropsSchema } from '@objectstack/spec/ui';
import { ObjectGridSchema } from '../zod/objectql.zod.js';
import type { ObjectGridSchema as ObjectGridSchemaType } from '../objectql.js';

/** A control key no surface in this package or the protocol declares. */
const UNKNOWN_KEY = 'zzzNotAKeyAnySurfaceDeclares5861';

/** The minimum green `object-grid` document, shared by every case below. */
const NODE = { type: 'object-grid' as const, objectName: 'probe' };

/** What an author used to write, and what the tombstone sends them to. */
const AUTHORED_LEGACY = { field: 'name', order: 'desc' as const };
const AUTHORED_CANONICAL = [{ field: 'name', order: 'desc' as const }];

function issueAt(result: ReturnType<typeof ObjectGridSchema.safeParse>, key: string) {
  return result.success ? undefined : result.error.issues.find((i) => i.path.join('.') === key);
}

describe('objectql.zod.ts#ObjectGridSchema — `defaultSort` is refused BY NAME (objectui#5861)', () => {
  it('refuses an authored `defaultSort`, and the issue path names the key', () => {
    const r = ObjectGridSchema.safeParse({ ...NODE, defaultSort: AUTHORED_LEGACY });
    expect(r.success).toBe(false);
    const issue = issueAt(r, 'defaultSort');
    expect(issue).toBeDefined();
    // `retirementTombstone()` customises the MESSAGE only; the code stays the
    // one a bare `z.never()` reports.
    expect(issue?.code).toBe('invalid_type');
  });

  it('LIT CONTROL — an unrecognised key on the SAME document stays green', () => {
    // Without this the refusal above would be consistent with the whole object
    // having turned strict — a much larger contract change than the one ruled.
    expect(ObjectGridSchema.safeParse({ ...NODE, [UNKNOWN_KEY]: AUTHORED_LEGACY }).success).toBe(true);
  });

  it('the message names the remedy — rename to `sort` and wrap in an array', () => {
    const message = String(issueAt(ObjectGridSchema.safeParse({ ...NODE, defaultSort: AUTHORED_LEGACY }), 'defaultSort')?.message);
    expect(message).toContain('RETIRED (objectui#5861, ADR-0049)');
    expect(message).toContain('sort: [{ field, order }]');
  });

  it('writes the SAME string into the metadata channel, so docs cannot drift from the parse message', () => {
    const described = (ObjectGridSchema.shape.defaultSort as { description?: string }).description;
    const issue = issueAt(ObjectGridSchema.safeParse({ ...NODE, defaultSort: AUTHORED_LEGACY }), 'defaultSort');
    expect(described).toBe(String(issue?.message));
  });

  it('the tombstone is a MEMBER, not a deletion — that is what makes the refusal loud', () => {
    expect('defaultSort' in ObjectGridSchema.shape).toBe(true);
    expect(UNKNOWN_KEY in ObjectGridSchema.shape).toBe(false);
  });
});

describe('the OTHER direction — the spelling the tombstone names is still writable', () => {
  it('canonical `sort` parses green on the same document the legacy key reddens', () => {
    expect(ObjectGridSchema.safeParse({ ...NODE, sort: AUTHORED_CANONICAL }).success).toBe(true);
  });

  it('a document that omits the key entirely stays green — a tombstone gates nothing else', () => {
    expect(ObjectGridSchema.safeParse(NODE).success).toBe(true);
  });
});

describe('the UPSTREAM half — re-derived from the installed pin, not copied into prose', () => {
  it('upstream REFUSES `defaultSort` on `object-grid` and ACCEPTS `sort`', () => {
    const refused = SpecObjectGridPropsSchema.safeParse({ objectName: 'probe', defaultSort: AUTHORED_LEGACY });
    const accepted = SpecObjectGridPropsSchema.safeParse({ objectName: 'probe', sort: AUTHORED_CANONICAL });
    expect(refused.success).toBe(false);
    expect(accepted.success).toBe(true);
  });

  it('upstream refuses it BY NAME, with a rename prescription an arbitrary unknown key does not get', () => {
    const named = SpecObjectGridPropsSchema.safeParse({ objectName: 'probe', defaultSort: AUTHORED_LEGACY });
    const control = SpecObjectGridPropsSchema.safeParse({ objectName: 'probe', [UNKNOWN_KEY]: 1 });
    expect(named.success).toBe(false);
    expect(control.success).toBe(false);
    const namedIssue = !named.success ? named.error.issues.find((i) => i.path.join('.') === 'defaultSort') : undefined;
    const controlText = !control.success ? control.error.issues.map((i) => i.message).join('\n') : '';
    // The same code this package's tombstone reports, at the same path.
    expect(namedIssue?.code).toBe('invalid_type');
    expect(String(namedIssue?.message)).toContain('`sort`');
    expect(controlText).not.toContain('`sort`');
  });
});

/* ── The TypeScript twin ────────────────────────────────────────────────── */

/**
 * The `@ts-expect-error` below IS the assertion: `defaultSort?: never` makes
 * the legacy literal a compile error. It fails this package's
 * `tsc -p tsconfig.test.json` leg as an UNUSED directive if the member is ever
 * re-typed as a live `{ field, order }`. A deletion failed it too while the index
 * signature absorbed the key; since objectui#8347 a deleted member's key is
 * refused as undeclared, which keeps the directive used, so the directive no
 * longer sees a deletion. The deletion guard is the `_DefaultSortIsATombstone`
 * row below: an indexed access on a member that does not exist is itself a
 * compile error, and the row pins the tombstone type (`?: never` reads as
 * `undefined`), so a re-typing to a live value reddens it as well.
 */
export const authoredDefaultSortRefused: ObjectGridSchemaType = {
  type: 'object-grid',
  objectName: 'probe',
  // @ts-expect-error — `defaultSort` is RETIRED (objectui#5861): declared `?: never`, so no value is authorable.
  defaultSort: AUTHORED_LEGACY,
};

/** LIT CONTROL: the canonical spelling is a declared, writable member of the twin. */
export const authoredSortIsDeclared: ObjectGridSchemaType = {
  type: 'object-grid',
  objectName: 'probe',
  sort: AUTHORED_CANONICAL,
};

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * The tombstone is a MEMBER on the TS face too. Measured by ablation on this
 * tree: deleting `defaultSort?: never` from `ObjectGridSchema` turns this row
 * red while the directive above stays green (the `zod-mirror-parity` ledger and
 * the `ObjectGridSlotKey` constraint in `objectql.ts` redden on the same
 * deletion, since both still name the member); restored, it is green.
 */
export type _DefaultSortIsATombstone = Expect<Equal<ObjectGridSchemaType['defaultSort'], undefined>>;

describe('the TypeScript twin', () => {
  it('is compiled by this package’s type-check leg, which is where the two bindings above are read', () => {
    expect([authoredDefaultSortRefused, authoredSortIsDeclared]).toHaveLength(2);
  });
});
