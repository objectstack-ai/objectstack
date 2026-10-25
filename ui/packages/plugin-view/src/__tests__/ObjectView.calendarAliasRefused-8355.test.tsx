/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8355 — THE SECOND ROUTE to `ObjectCalendar`, and the one the first
 * two rounds of this card missed.
 *
 * `generateViewSchema` runs precisely when no host supplied `renderListView` —
 * the authored `object-view` element — so it never passes through `ListView`,
 * and the strip this card landed in `plugin-list` does not reach it. Its own
 * `case 'calendar':` comment has said "the SECOND route to `ObjectCalendar`"
 * since objectui#7029; the same distinction the kanban branch records for
 * objectui#9242 one card over.
 *
 * ## ⭐ WHY THIS FILE IS PART OF THE RETIREMENT AND NOT A FOLLOW-UP
 *
 * The retirement removed `ObjectCalendar`'s alias ladder. On THIS route the
 * producer kept spreading `...(viewOptions.calendar || {})` raw, so a document
 * that drew at the merge-base stopped drawing at head — the exact shape the
 * ruling calls not-ruled ("removed the ladder while the producer kept spreading
 * the alias, so documents failed silently"). A follow-up card cannot un-ship
 * that; the regression and its remedy belong to the same delivery.
 *
 * ## MEASURED BEFORE ANY MECHANISM WAS CHOSEN
 *
 * This file was written and run against the UNMODIFIED head (`c82937e3b`),
 * which is the strongest form of the reverse-verification leg: the "before" arm
 * is the real tree rather than an injected mutation, so there is no on-disk
 * mutation to prove and no restore leg to get wrong (the objectui#9242 idiom,
 * one card over, for the same reason). Predicted, then observed, on `c82937e3b`:
 *
 *   - half 1 (the emitted node) RED — the node carries a flat `dateField` /
 *     `endField` and no `startDateField`;
 *   - half 2 (the read door) RED — `safeValidateSchema` ACCEPTS the document;
 *   - every CONTROL green.
 *
 * ⚠️ AND ONE PREMISE DIED ON CONTACT. The read-door gap is NOT this PR's doing
 * and is NOT specific to the calendar: measured in the same pass, a named view
 * carrying the objectui#8365 stray `kanban.groupBy` was ACCEPTED here too, while
 * the identical key on a `list-view` document was refused (objectui#10321 has
 * since added that key to this door; the reading below is the one taken
 * then). `ObjectViewSchema`'s
 * `listViews` is unmirrored by ruling and rides `.passthrough()`, so NOTHING
 * that lands on a view-kind block reaches a named view. ⇒ what this card
 * regressed on this route is the BEHAVIOUR (drew → mute); the silence at the
 * door was already there, for every alias refusal this module carries.
 *
 * ## THE REFUSAL'S SHAPE HERE, and why it is not a mirror
 *
 * `listViews` stayed unmirrored when this file was written, waiting on its
 * VALUE TYPE. objectui#7928 answered that (ruling A): the key is the protocol's
 * strict `ObjectListViewSchema` record by reference now, so the protocol refuses
 * both spellings under `listViews.KEY.calendar` itself. The `.check()` this
 * card added stays beside that member, still not the mirror: it reads the
 * protocol's refusal and adds the by-name pointer at the key (the protocol's own
 * hint answers `dateField` → `endDateField`). The legacy `options.calendar`
 * nesting is refused WHOLE now (`options` is not a member) and is no longer read
 * off a named view; a stored body's bag is folded at `ViewPreview`
 * (objectui#7928 director ruling, Q1 A). The scope controls below were
 * inverted to that tree, ⛔ none deleted.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { safeValidateSchema } from '@object-ui/types/zod';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

/** Every schema the view hands to SchemaRenderer, in order. */
const rendered: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const ReactMod = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: ReactMod.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const dataSource = (): any => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'task',
    fields: {
      name: { name: 'name', type: 'text', label: 'Name' },
      kickoff: { name: 'kickoff', type: 'date', label: 'Kickoff' },
      wrapup: { name: 'wrapup', type: 'date', label: 'Wrapup' },
    },
  }),
});

/**
 * Renders a named calendar view through the REGISTERED renderer's path — i.e.
 * with no `renderListView` — and returns the `object-calendar` node the branch
 * emits.
 *
 * ⚠️ `cleanup()` is load-bearing, not hygiene: without it the previously
 * mounted views keep pushing into `rendered`, so the last entry is a STALE node
 * and every reading comes back shifted by one fixture. Recorded as a real
 * failure on objectui#9242, next door.
 */
async function generatedCalendarNode(entry: Record<string, unknown>): Promise<any> {
  cleanup();
  rendered.length = 0;
  render(
    <ObjectView
      schema={objectViewDoc(entry) as unknown as ObjectViewSchema}
      dataSource={dataSource()}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  const node = rendered[rendered.length - 1];
  expect(node.type).toBe('object-calendar');
  return node;
}

/**
 * The authored document shape, as `listViews` carries it on an object-view node
 * — and the ONE fixture BOTH halves read, so the node arm and the read-door arm
 * cannot drift onto different documents (the objectui#8365 idiom).
 *
 * ⚠️ Driven through `schema.listViews`, ⛔ never through the `views` PROP.
 * `viewOptions` is built from `currentNamedViewConfig`, which is resolved from
 * `schema.listViews` alone; the `views` prop only reaches `activeView`, whose
 * legacy limb is the whole view OBJECT rather than its `options` bag. Measured
 * while writing this file: a first cut used the prop, and the `options.calendar`
 * row passed VACUOUSLY because `viewOptions.calendar` was undefined — a green
 * that asserted nothing about the nesting it names.
 */
const objectViewDoc = (entry: Record<string, unknown>) => ({
  type: 'object-view',
  objectName: 'task',
  listViews: { v1: { type: 'calendar', ...entry } },
});

const issuesEndingIn = (doc: unknown, suffix: string) => {
  const result = safeValidateSchema(doc);
  if (result.success) return [];
  return result.error.issues.filter((i) => i.path.join('.').endsWith(suffix));
};

beforeEach(() => {
  rendered.length = 0;
});

describe('objectui#8355 · second route, half 1 — the emitted node carries canonical keys only', () => {
  it('neither retired spelling reaches the `object-calendar` node', async () => {
    const node = await generatedCalendarNode({ calendar: { dateField: 'kickoff', endField: 'wrapup', titleField: 'name' } });
    expect(Object.keys(node)).not.toContain('dateField');
    expect(Object.keys(node)).not.toContain('endField');
  });

  it('…and no canonical binding is invented from them', async () => {
    // ⛔ The arm that tells the ruling apart from option A. A producer-side fold
    // would emit `startDateField: 'kickoff'` and every other row here would
    // still pass. The ruling refused that end state on the first route; this
    // route follows it rather than forking.
    const node = await generatedCalendarNode({ calendar: { dateField: 'kickoff', endField: 'wrapup', titleField: 'name' } });
    expect(node.startDateField).toBeUndefined();
    expect(node.endDateField).toBeUndefined();
  });

  it('CONTROL: the canonical block still reaches the node intact', async () => {
    // Without this row, "the aliases do not reach the node" is satisfied by a
    // branch that forwards nothing at all.
    const node = await generatedCalendarNode({ calendar: { startDateField: 'kickoff', endDateField: 'wrapup', titleField: 'name' } });
    expect(node.startDateField).toBe('kickoff');
    expect(node.endDateField).toBe('wrapup');
    expect(node.titleField).toBe('name');
  });

  it('CONTROL: an unrelated renderer-ahead knob still rides the block through', async () => {
    // The branch strips exactly TWO keys; it did not become a whitelist.
    const node = await generatedCalendarNode({ calendar: { startDateField: 'kickoff', allDayField: 'is_all_day' } });
    expect(node.allDayField).toBe('is_all_day');
  });

  it('CONTROL: the LEGACY `options.calendar` nesting is stripped on the same path — and since objectui#7928 not read at all', async () => {
    // `viewOptions` merged the canonical block over the legacy `options` bag
    // until objectui#7928, and that bag "is where the legacy field aliases …
    // `dateField` live". The two assertions that follow still hold; the third is
    // the inversion: the bag is no longer READ off a named view (a stored body's
    // bag is folded at `ViewPreview`, where it becomes `calendar` and meets the
    // strip above), so its `titleField` does not reach the node either.
    const node = await generatedCalendarNode({ options: { calendar: { dateField: 'kickoff', titleField: 'name' } } });
    expect(Object.keys(node)).not.toContain('dateField');
    expect(node.startDateField).toBeUndefined();
    expect(node.titleField).toBeUndefined();
  });
});

describe('objectui#8355 · second route, half 2 — the document is REFUSED at the read door', () => {
  // ⭐ RE-PINNED at objectui#11073. These two rows pinned objectui's pointer
  // (`custom` at `calendar.ALIAS`, "Did you mean …"), which ran beside the
  // protocol's refusal inside a named view. `@objectstack/spec` 17.5.0 makes that
  // refusal terminal, zod skips even a `when`-guarded check after it, and the
  // pointer was retired (seat ruling Q2 → A). The document is still refused, by
  // the protocol, naming the key at the `calendar` block.
  it.each([['dateField'], ['endField']])('a named view authoring `calendar.%s` is refused by the protocol, naming the key', (alias) => {
    const doc = objectViewDoc({ calendar: { startDateField: 'kickoff', [alias]: 'kickoff' } });
    expect(issuesEndingIn(doc, `calendar.${alias}`)).toHaveLength(0);
    const refusal = issuesEndingIn(doc, 'listViews.v1.calendar') as Array<{ code: string; keys?: string[] }>;
    expect(refusal).toHaveLength(1);
    expect(refusal[0].code).toBe('unrecognized_keys');
    expect(refusal[0].keys).toEqual([alias]);
  });

  it('INVERTED: the LEGACY `options.calendar` nesting is refused WHOLE — `options` by name — and no longer judged inside (objectui#7928)', () => {
    // Was "refused too, with the same message" at `options.calendar.dateField`.
    // The named view is the protocol's strict record now, which refuses the
    // `options` key itself; the check no longer reads inside a bag the contract
    // refuses and the renderer does not read. A stored body's bag is folded onto
    // `calendar` at `ViewPreview`, where the arms above judge it.
    const doc = objectViewDoc({ options: { calendar: { dateField: 'kickoff' } } });
    const issues = issuesEndingIn(doc, 'options.calendar.dateField');
    expect(issues).toHaveLength(0);
    expect(issues.some((i) => i.message.includes('Did you mean `dateField` → `startDateField`?'))).toBe(false);
    const whole = issuesEndingIn(doc, 'listViews.v1').filter((i) => i.code === 'unrecognized_keys');
    expect(whole).toHaveLength(1);
    expect((whole[0] as { keys?: string[] }).keys).toEqual(['options']);
  });

  it('DARK CONTROL: the canonical named view parses GREEN through the same door', () => {
    // `columns` since objectui#7928: the protocol's named view requires it, so a
    // canonical view carries it.
    const r = safeValidateSchema(objectViewDoc({ columns: ['name'], calendar: { startDateField: 'kickoff', endDateField: 'wrapup' } }));
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('INVERTED SCOPE CONTROL: `listViews` IS the protocol\'s record since objectui#7928 — the MIRROR judges a named view now; this door adds only the named alias pointers', () => {
    // Was "`listViews` is still UNMIRRORED — nothing else about a named view is
    // judged": the unmirrored ruling waited on the key's VALUE TYPE, and
    // objectui#7928 chose the protocol's. Each of the three documents that
    // parsed green then is refused now, by the mirror and at the key.
    const undeclared = safeValidateSchema(objectViewDoc({ columns: ['name'], calendar: { startDateField: 'kickoff', zzqxNoSuchField: 'x' } }));
    expect(undeclared.success, 'an undeclared key inside a named view is accepted — the mirror is not the protocol\'s strict record').toBe(false);
    expect(issuesEndingIn(objectViewDoc({ columns: ['name'], calendar: { startDateField: 'kickoff', zzqxNoSuchField: 'x' } }), 'listViews.v1.calendar')
      .some((i) => i.code === 'unrecognized_keys')).toBe(true);
    const noColumns = safeValidateSchema(objectViewDoc({ calendar: { startDateField: 'kickoff' } }));
    expect(noColumns.success, 'a named view without `columns` is accepted — the spec value type is not the mirror').toBe(false);
    const legacyBag = safeValidateSchema(objectViewDoc({ columns: ['name'], options: { calendar: { startDateField: 'kickoff' } } }));
    expect(legacyBag.success, 'the legacy `options` bag is accepted on a named view — the contract refuses it (objectui#7928)').toBe(false);
    // …and the check still judges only the two calendar spellings: none of the
    // three draws a `custom` issue.
    for (const doc of [
      objectViewDoc({ columns: ['name'], calendar: { startDateField: 'kickoff', zzqxNoSuchField: 'x' } }),
      objectViewDoc({ calendar: { startDateField: 'kickoff' } }),
      objectViewDoc({ columns: ['name'], options: { calendar: { startDateField: 'kickoff' } } }),
    ]) {
      const r = safeValidateSchema(doc);
      const custom = r.success ? [] : r.error.issues.filter((i) => i.code === 'custom');
      expect(custom).toEqual([]);
    }
  });

  it('SCOPE CONTROL: the TIMELINE alias is untouched BY THIS CHECK — the protocol\'s strict record refuses it since objectui#7928', () => {
    const doc = {
      type: 'object-view',
      objectName: 'task',
      listViews: { v1: { type: 'timeline', timeline: { dateField: 'kickoff' } } },
    };
    const r = safeValidateSchema(doc);
    // INVERTED from `success === true`: the protocol's timeline block declares
    // no `dateField` (and requires `startDateField` / `titleField`), and the
    // named view is that block by reference now.
    expect(r.success).toBe(false);
    expect(issuesEndingIn(doc, 'listViews.v1.timeline').some((i) => i.code === 'unrecognized_keys')).toBe(true);
    // The scope this control exists for is unchanged: the calendar check adds
    // nothing under `timeline`.
    expect(issuesEndingIn(doc, 'timeline.dateField').filter((i) => i.code === 'custom')).toEqual([]);
  });
});
