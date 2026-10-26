/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The bare `kanban` NODE TYPE key is retired, and a document naming it is
 * refused BY NAME (objectui#8802 — maintainer ruling 2026-09-09, verbatim and
 * untranslated: 「从我们的业务需求角度，我应该只需要 `object-kanban`」).
 *
 * ## What it supersedes, and why those files are gone rather than edited
 *
 * Two pin files had the retired arm as their whole subject and are replaced by
 * this one — the third disposition in fixture triage, "the fixture pins exactly
 * the branch you deleted", where an edit would have left assertions that keep
 * passing because nothing is produced any more:
 *
 *   - `kanban-arm-batch70-7742.test.ts` — batch #70's four arm-scoped refusals
 *     (`allowCollapse` / `cardTemplates` / `columnWidths` / `titleField`) and
 *     its one widening (`navigation`). Every one of them was a claim about
 *     `type: 'kanban'` documents, which no longer exist.
 *   - `kanban-plugin-dialect-authoritative-7664.test.ts` — that the `'kanban'`
 *     arm declared the plugin dialect, that `SchemaRegistry['kanban']` named
 *     it, and a 20-member census of it.
 *
 * ⭐ The one claim inside them that was NOT about the retired arm is carried
 * forward here as suite 3: retiring this arm must not move the SIBLING
 * `object-kanban` arm's verdicts. That is what turns this from a deletion into
 * a retirement. ⛔ It is not the wider claim that those verdicts never move at
 * all — `allowCollapse` later moved on that arm's own ruling (objectui#8801),
 * which suite 3's comments cover.
 *
 * ## ⚠️ The mechanism, which is NOT the passthrough rule
 *
 * `BaseSchema` is `.passthrough()`, so a dropped MEMBER key is KEPT, not
 * refused — the failure objectui#7664's first cut shipped at `onCardClick`.
 * ⛔ That rule does not govern a TYPE LITERAL. `AnyComponentSchema` is a
 * DISCRIMINATED union (objectui#8498), so it selects one arm from the authored
 * literal and an unclaimed literal matches nothing: deleting the arm would
 * already refuse. What deleting would NOT do is say why or what to write
 * instead — the union answers a missed discriminator with its own remedy-free
 * `Invalid input`. So the arm stays, claiming the literal, and refuses through
 * `retiredNodeType()`. Suite 1 measures the refusal AND its remedy; suite 4
 * measures that the generic path is still what an unknown literal gets, which
 * is the control that separates the two.
 *
 * ## ⛔ The layer this retirement does NOT touch
 *
 * `kanban` also names a STORED `NamedListView.type` — the value
 * `CreateViewDialog` writes and every tenant's database holds. Suite 5 pins that
 * it is still admitted, because a migration that pattern-matched the string
 * would have rewritten it and broken every stored kanban view in every
 * deployment. `plugin-view`'s `ObjectView` maps a stored `kanban` view onto the
 * `object-kanban` NODE type, so this retirement moves zero stored documents.
 */

import { describe, it, expect } from 'vitest';
import { safeValidateSchema } from '../zod/index.zod';
import type { ComplexSchema } from '../complex';
import type { SchemaRegistry, ComponentType } from '../registry';
import type { NamedListView, ObjectKanbanSchema } from '../objectql';

/* -------------------------------------------------------------------------- */
/* Compile-time pins — read by tsc -p tsconfig.test.json, not by vitest.       */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;

// 1. The `ComplexSchema` union no longer has an arm for the literal, so `tsc`
//    refuses it at the authoring site.
type _ComplexHasNoKanbanArm = Assert<Equal<IsNever<Extract<ComplexSchema, { type: 'kanban' }>>, true>>;
//    Non-vacuity on the same instrument: a live sibling arm IS still selectable,
//    so the `never` above is a reading and not an `Extract` that yields `never`
//    for everything (which is what a broken import of `ComplexSchema` gives).
type _ComplexStillHasLiveArms = Assert<Equal<IsNever<Extract<ComplexSchema, { type: 'carousel' }>>, false>>;

// 2. The published `ComponentType` union no longer offers the retired key.
type _ComponentTypeDropsKanban = Assert<Equal<'kanban' extends ComponentType ? true : false, false>>;
type _ComponentTypeKeepsLiveKeys = Assert<Equal<'chatbot' extends ComponentType ? true : false, true>>;
type _RegistryDropsKanban = Assert<Equal<'kanban' extends keyof SchemaRegistry ? true : false, false>>;

// 3. ⛔ The STORED view type is a DIFFERENT layer and keeps the spelling. This
//    pin is the trap-guard: it goes red the moment someone "finishes" the
//    retirement by pattern-matching the string.
type _StoredViewTypeKeepsKanban = Assert<Equal<'kanban' extends NonNullable<NamedListView['type']> ? true : false, true>>;
type _StoredViewTypeKeepsGantt = Assert<Equal<'gantt' extends NonNullable<NamedListView['type']> ? true : false, true>>;

// 4. The surviving node face is untouched and still tagged with its own key.
type _SurvivorIsTagged = Assert<Equal<ObjectKanbanSchema['type'], 'object-kanban'>>;

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

/** The board that used to validate under the retired key, spelled unchanged. */
const RETIRED_BOARD = {
  type: 'kanban',
  objectName: 'tasks',
  groupBy: 'status',
  cardTitle: 'title',
} as const;

describe('suite 1 — a `type: "kanban"` document is REFUSED, by name (objectui#8802)', () => {
  it('refuses the document', () => {
    expect(refusals(RETIRED_BOARD)).not.toEqual([]);
  });

  it('the refusal names the remedy `object-kanban`, not just a type complaint', () => {
    // ⭐ This is the whole reason the arm survives as a refusal instead of being
    // deleted. Suite 4 is its control: an unknown literal gets the union's
    // generic message, which names no remedy at all.
    const text = refusals(RETIRED_BOARD).map((r) => r.message).join('\n');
    expect(text).toContain('object-kanban');
    expect(text).toContain('RETIRED');
  });

  it('⛔ and it does NOT tell the author to rewrite their stored view type', () => {
    // The trap this family's rulings warn about, asserted in the one place an
    // author would read: the message must say the stored spelling is a
    // different layer, so nobody "finishes the job" in their database.
    const text = refusals(RETIRED_BOARD).map((r) => r.message).join('\n');
    expect(text).toContain('STORED');
  });
});

describe('suite 2 — the refusal is not a validator that turned strict', () => {
  it('an ACCEPTED document on the same call proves the instrument still says yes', () => {
    // Firing control. Without it every assertion in suite 1 would also pass
    // under a `safeValidateSchema` that had started refusing everything.
    expect(refusals({ type: 'object-kanban', objectName: 'tasks', groupBy: 'status' })).toEqual([]);
  });
});

describe('suite 3 — retiring the bare `kanban` arm moved NO verdict on the SIBLING `object-kanban` arm', () => {
  // Carried forward from `kanban-arm-batch70-7742.test.ts`, whose `titleField`
  // pair is the reason this suite exists: the batch #70 refusals were
  // ARM-SCOPED, so retiring the arm must not move the sibling's answers.
  it.each([
    ['titleField', 'name'],
    ['coverImageField', 'cover'],
  ])('accepts `%s`, exactly as it did before the retirement', (key, value) => {
    expect(refusals({ type: 'object-kanban', objectName: 'tasks', groupBy: 'status', [key]: value })).toEqual([]);
  });

  // ⭐ `allowCollapse` is NOT a row in this suite, and its absence is the point
  // rather than an omission. It sat among the accepting rows above until
  // objectui#8801 ruled on THIS arm's own protocol reading
  // (`ComponentPropsMap['object-kanban']` never declared the key; no registered
  // board reads it) and the key became a refusal. ⛔ Do not read that as batch
  // #70 finally reaching the sibling: its verdict did NOT move because the bare
  // `kanban` arm retired — an arm-scoped refusal still cannot cross an arm, and
  // the rows above are the measurement that says so. `quickAdd` left the
  // accepting rows the same way, on its own ruling (objectui#8285, pinned in
  // `object-kanban-quick-add-retired-8285.test.ts`).
  //
  // ⛔ Do not restore it here in either direction. The refusal — with its
  // message, its `invalid_type` code, its `.describe()` channel and its own
  // firing controls — is asserted by
  // `object-kanban-allow-collapse-retired-8801.test.ts`, in the `it` named
  // "refuses the value %p at the key's OWN path, with the prescription".
  // Restating it here would put one pin in two files, which is the shape that
  // let the stale ACCEPTING row survive here for a week after objectui#8802.

  it('and still REFUSES what it always refused — `groupField`, its own tombstone', () => {
    // The other half: suite 3 would be vacuous if the sibling arm accepted
    // everything.
    const found = refusals({ type: 'object-kanban', objectName: 'tasks', groupBy: 'status', groupField: 'status' });
    expect(found.filter((f) => f.path === 'groupField')).not.toEqual([]);
  });
});

describe('suite 4 — control: an unknown literal takes the GENERIC path', () => {
  it('a name no arm claims is refused without any remedy text', () => {
    // ⭐ The separator. If this document ALSO named `object-kanban` in its
    // message, suite 1's remedy assertion would be measuring the union's
    // boilerplate rather than this arm's guidance.
    const text = refusals({ type: 'zzz-not-a-type' }).map((r) => r.message).join('\n');
    expect(text).not.toEqual('');
    expect(text).not.toContain('object-kanban');
  });
});
