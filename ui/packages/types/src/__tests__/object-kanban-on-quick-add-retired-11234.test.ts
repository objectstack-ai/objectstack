/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11234 — `ObjectKanbanSchema.onQuickAdd` RETIRED on the
 * `object-kanban` arm, on BOTH faces. It completes ruling B of the director
 * seat's decision batch #91 (objectui#8285): "The board does not grow an inline
 * record-creation write path".
 *
 * ## The defect
 *
 * After objectui#8285 retired `quickAdd`, `onQuickAdd` stayed a RUNTIME SLOT.
 * A host-supplied function reached the board by identity, and on
 * `object-kanban` it was never called, because the Quick Add control is gated
 * on BOTH halves of the pair and the other half was gone. A TypeScript host or
 * an AI writing the key compiled and got nothing.
 *
 * ## Why this took a renderer change first
 *
 * `check:handler-key-reads` refuses a `'retired'` disposition while a renderer
 * reachable from the registration reads the key off the document, and
 * `KanbanRenderer` read `schema.onQuickAdd` on the `object-kanban` path.
 * `ObjectKanban` now renders the internal `KanbanBoardCore`, which takes the
 * pair only as explicit props, and supplies neither. That half is pinned in
 * `@object-ui/plugin-kanban`: `handlerKeyDispositionsMeasured-7804.test.tsx`
 * (what reaches the board) and `quickAddRetiredNotForwarded-8285.test.tsx`
 * (row 1, no control on an `object-kanban` node; row 2, the host pair on
 * `KanbanRenderer` still draws and calls).
 *
 * ## What this file pins
 *
 *   - the TypeScript face: the member is `never`, not `any` and not callable;
 *   - the JSON face: the key is refused BY NAME, and the refusal says RETIRED;
 *   - the disposition itself, against a lit control on the same arm and the
 *     same helper: `onCardClick` still says RUNTIME SLOT. Re-declaring
 *     `onQuickAdd` as a runtime slot turns that leg red.
 */

import { describe, it, expect } from 'vitest';

import { ObjectKanbanSchema } from '../zod/objectql.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { ObjectKanbanSchema as TsObjectKanbanSchema } from '../objectql';

const RETIRED = 'onQuickAdd';
/** The sibling on the same arm that stays a runtime slot — the lit control. */
const LIVE_SLOT = 'onCardClick';
/** A near miss of the retired spelling: never declared, so it takes the OTHER path. */
const NEAR_MISS = 'onQuickAdded';

/** The smallest node this arm accepts; every assertion below is a delta on it. */
const NODE = { type: 'object-kanban', objectName: 'task', groupBy: 'status' } as const;
const AUTHORED_ACTION_OBJECT = { action: 'toast', title: 'Added' };
const LIVE_FUNCTION = (_columnId: string, _title: string) => undefined;

/* -------------------------------------------------------------------------- */
/* Compile-time pins — read by tsc (`tsconfig.test.json`), not by vitest.     */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends 1 & T ? true : false;
/** Some function type survives the `Extract`. Over `NonNullable` so `undefined` cannot satisfy it. */
type KeepsFunction<T> = [Extract<NonNullable<T>, (...args: never[]) => unknown>] extends [never] ? false : true;

// The tombstone admits exactly one value — absence. Deleting the member instead
// made this indexed access fall through the index signature to `any` until
// objectui#8347; it stops compiling now.
export type _RetiredIsTombstone = Assert<Equal<TsObjectKanbanSchema['onQuickAdd'], undefined>>;
export type _RetiredIsNotAny = Assert<Equal<IsAny<TsObjectKanbanSchema['onQuickAdd']>, false>>;
export type _RetiredIsNotCallable = Assert<Equal<KeepsFunction<TsObjectKanbanSchema['onQuickAdd']>, false>>;
// Non-vacuity on the same instruments: the sibling slot is still callable…
export type _LiveSlotStillCallable = Assert<KeepsFunction<TsObjectKanbanSchema['onCardClick']>>;
// …and the never-declared near miss is no member at all (it fell through to
// `any` until objectui#8347 removed `BaseSchema`'s index signature).
export type _NearMissIsNoMember = Assert<Equal<'onQuickAdded' extends keyof TsObjectKanbanSchema ? true : false, false>>;
// Lit control for the detector: `IsAny` does answer `true`, so `_RetiredIsNotAny` is a reading.
export type _IsAnyCanAnswerTrue = Assert<IsAny<any>>;

const liveLiteral: TsObjectKanbanSchema = { ...NODE, onCardClick: () => undefined };
// This directive goes unused — and the type-check goes red with TS2578 — the
// moment the tombstone is widened back to a callable. A deletion keeps it used
// since objectui#8347 (the key is refused as undeclared) and is caught by the
// tombstone `Equal` row above instead.
// @ts-expect-error — `onQuickAdd` is RETIRED on this node (objectui#11234); mount `KanbanRenderer` for Quick Add
const retiredLiteral: TsObjectKanbanSchema = { ...NODE, onQuickAdd: LIVE_FUNCTION };
void liveLiteral;
void retiredLiteral;

/* -------------------------------------------------------------------------- */
/* Runtime — the zod mirror, and `safeValidateSchema`, the tolerant union.     */
/* -------------------------------------------------------------------------- */

const shape = (ObjectKanbanSchema as unknown as { shape: Record<string, { description?: string } | undefined> }).shape;

/** The first issue a node draws at one key's own path. */
function issueAt(value: unknown, key: string) {
  const parsed = ObjectKanbanSchema.safeParse({ ...NODE, [key]: value });
  if (parsed.success) return null;
  const issue = parsed.error.issues.find((i) => i.path.length === 1 && String(i.path[0]) === key);
  return issue ? { code: issue.code, path: issue.path.map(String), message: issue.message } : null;
}

describe('the JSON face refuses `onQuickAdd` BY NAME (objectui#11234)', () => {
  it('the member is still DECLARED — a tombstone, not a deletion', () => {
    expect(Object.keys(shape)).toContain(RETIRED);
    // Control: a key this arm never declared is absent from the same shape.
    expect(Object.keys(shape)).not.toContain(NEAR_MISS);
  });

  it.each([
    ['an authored action object', AUTHORED_ACTION_OBJECT],
    ['a live function', LIVE_FUNCTION],
  ])('refuses %s at the key\'s OWN path, as the objectui#6124 `custom` refusal', (_label, value) => {
    const issue = issueAt(value, RETIRED);
    expect({ code: issue?.code, path: issue?.path }).toEqual({ code: 'custom', path: [RETIRED] });
    expect(issue?.message).toContain(`\`${RETIRED}\``);
  });

  it('ONE string, BOTH author-facing channels — the `.describe()` metadata is the parse message', () => {
    const described = shape[RETIRED]?.description ?? '';
    expect(described).not.toEqual('');
    expect(issueAt(AUTHORED_ACTION_OBJECT, RETIRED)?.message).toBe(described);
  });

  it('the near miss is ACCEPTED, because this arm is not strict', () => {
    // The discriminator: an undeclared key is KEPT, which is why deleting the
    // member would have shipped the retirement as a silent accept.
    expect(issueAt(AUTHORED_ACTION_OBJECT, NEAR_MISS)).toBeNull();
    expect(ObjectKanbanSchema.safeParse({ ...NODE, [NEAR_MISS]: true }).success).toBe(true);
  });

  it('the CLI union refuses the key on a whole node, and still accepts the bare node', () => {
    const refused = safeValidateSchema({ ...NODE, [RETIRED]: AUTHORED_ACTION_OBJECT } as never) as {
      success: boolean;
    };
    expect(refused.success).toBe(false);
    expect((safeValidateSchema(NODE as never) as { success: boolean }).success).toBe(true);
  });
});

describe('the disposition is RETIRED, read against a lit runtime slot on the same arm (objectui#11234)', () => {
  /** What `handlerKeyRefusal()` wrote into a member's guidance. */
  const disposition = (key: string): 'retired' | 'runtime-slot' | 'neither' => {
    const text = shape[key]?.description ?? '';
    if (text.includes('RETIRED (objectui#6124') && !text.includes('RUNTIME SLOT')) return 'retired';
    if (text.includes('RUNTIME SLOT') && !text.includes('RETIRED')) return 'runtime-slot';
    return 'neither';
  };

  it('`onQuickAdd` reads RETIRED, while `onCardClick` on the same arm still reads RUNTIME SLOT', () => {
    expect({ [RETIRED]: disposition(RETIRED), [LIVE_SLOT]: disposition(LIVE_SLOT) }).toEqual({
      [RETIRED]: 'retired',
      [LIVE_SLOT]: 'runtime-slot',
    });
  });
});
