/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7299 — the parent-relationship condition is compiled to match the
 * relationship field's ARITY.
 *
 * `RelatedList` composed `{ [referenceField]: parentId }` unconditionally. When
 * the child object declares that field `multiple: true` — `Field.user({
 * multiple: true })` is the platform's own shape for "one assignment names N
 * people" — the stored value is an ARRAY of ids, which the drivers persist as a
 * JSON-valued column. `=` on that column compares the whole serialized array
 * against a single value and can never equal one member. `driver-sql` says so,
 * by field name, and refuses:
 *
 *   400 INVALID_FILTER
 *   The bare equality spelling { "assignees": value } WAS NOT APPLIED:
 *   "assignees" is a multi-value (or otherwise JSON-valued) field … Use
 *   "$contains" for membership ({ "assignees": { "$contains": "a" } })
 *
 * The driver is not the defect and neither is the metadata: `relationshipField`
 * is a public, authorable key and the author named a legal, supported field
 * type. The renderer compiled it into a predicate the storage cannot answer.
 * So this card restores declared = enforced, and it widens no authoring
 * surface — there is no `relationshipOperator`, because the author is naming a
 * RELATIONSHIP and its storage form is the component's business.
 *
 * ## What this file pins, and why it is not "`$contains` appears somewhere"
 *
 * The acceptance is a CLASS predicate: a related list on a multi-valued
 * relationship field returns data, and single-valued behaviour is unchanged.
 * So the first describe below reads ROWS ON SCREEN through a fake backend that
 * EVALUATES the composed filter, rather than comparing `$filter` to a literal.
 * A spelling assertion cannot tell "asks the right question" from "asks a
 * question that happens to be spelled the way I typed in the expectation".
 *
 * ## Why the evaluator REFUSES bare equality instead of answering `false`
 *
 * Because that is what was measured against the live driver, and the difference
 * is the whole card. An evaluator that quietly answers "no rows" for `=` on an
 * array would make this file pass for a component that had merely stopped
 * fetching. Refusing reproduces the observable defect — a section that renders
 * an error — and it is also the one bug that would make this file lie in the
 * other direction: an evaluator permissive about shapes it does not recognise
 * answers "all rows" for anything, which the assertions below would read as a
 * pass. So `evaluate` throws on every shape it was not written for.
 *
 * ## Where the verdict comes from
 *
 * The arity VERDICT is `@objectstack/spec/data`'s exported `isMultiValueField`,
 * imported rather than re-implemented — the component only finds the field def
 * to hand it. That is not hygiene: a second copy of the rule inside this
 * package would be two readers of one question disagreeing, which is the defect
 * this card is about. The three `SPEC PREDICATE` cases below pin the places
 * where the spec's rule and an eyeballed `multiple === true` DIFFER, measured
 * on `@objectstack/spec` 17.4.0, in both directions.
 *
 * ⚠️ This header used to add that "the driver that refuses the query picks on
 * the spec's". It does NOT (objectui#8937). `driver-sql` gates the equality
 * family on its own STORAGE question — a JSON column when the type is one it
 * stores as JSON OR when `multiple` is merely TRUTHY, on ANY type — so the two
 * rules diverge for a type outside `MULTI_CAPABLE_TYPES` carrying
 * `multiple: true`. See the `INERT` case below and `parentRelationshipFieldDef`'s
 * docblock in `RelatedList.tsx`; the divergence itself is re-derived each run by
 * `relatedListParentScopeResidue-8937.test.ts` and owned upstream by
 * objectstack#17469.
 *
 * ## The control
 *
 * `SINGLE_VALUED` runs the same page against the same evaluator with a scalar
 * FK. It is green BEFORE and AFTER the fix — that is what makes it a control
 * rather than a second subject: it can only redden if the normal path breaks,
 * never merely because the multi-value path is broken.
 *
 * ## One read, after the child definition settles (objectui#10690)
 *
 * The row fetch used to go out before the child object's definition landed, so
 * a multi-value list sent the equality query first — refused — and then the
 * membership one; this file pinned that as a DECLARED COST. objectui#10690
 * (auto-adjudicated B) gates the fetch on `useSettledSchema`, the gate the
 * other views use. The `ONE READ` case is that pin flipped, and the `SETTLES`
 * cases pin why the gate cannot strand rows: the hook settles with NO
 * definition when there is no `getObjectSchema` or the read throws.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399, and the same `beforeAll`
 * its neighbours carry): below the 768 breakpoint a `type="table"` list renders
 * a card gallery with no cells, and the row assertions here read CELLS.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

/** The card's own coordinates, kept verbatim so the repro reads back. */
const CHILD = 'duly_assignment';
const REL = 'assignees';
const PARENT_ID = 'ql8NO1TcKsuFrrH-';
const OTHER_ID = 'zzzOTHERzzzPARENT';

/**
 * Four rows built so each branch of the arity decision reads a DIFFERENT
 * number, in both directions:
 *
 *   - membership over `assignees` admits exactly the two rows naming PARENT_ID;
 *   - a filter that dropped the parent condition would admit all four;
 *   - a filter that kept equality is refused outright.
 *
 * Two rows rather than one so a fix that accidentally returned the first match
 * still fails the count assertion.
 */
const MULTI_ROWS = [
  { id: 'a1', subject: 'Ship the thing', assignees: [PARENT_ID, 'other-user'] },
  { id: 'a2', subject: 'Review the thing', assignees: ['other-user', PARENT_ID] },
  { id: 'a3', subject: 'Someone else’s job', assignees: ['other-user'] },
  { id: 'a4', subject: 'Nobody’s job', assignees: [] },
];
const MULTI_MEMBER_COUNT = MULTI_ROWS.filter((r) => r.assignees.includes(PARENT_ID)).length;

/** The single-valued CONTROL fixture — same page shape, scalar FK. */
const SINGLE_ROWS = [
  { id: 'c1', subject: 'Alice', account: PARENT_ID },
  { id: 'c2', subject: 'Bob', account: OTHER_ID },
];
const SINGLE_MATCH_COUNT = SINGLE_ROWS.filter((r) => r.account === PARENT_ID).length;

/** Arithmetic read off the fixtures, so a later edit that flattens them fails here. */
const FIXTURE_ARITHMETIC = { members: MULTI_MEMBER_COUNT, all: MULTI_ROWS.length, control: SINGLE_MATCH_COUNT };

/** The driver's refusal, reproduced as a rejection rather than as an empty answer. */
class InvalidFilterError extends Error {}

/**
 * Evaluate ONE `{field: comparand}` condition against a row, the way the
 * measured backend does.
 *
 * `$contains` over an array member is the membership the driver prescribes;
 * over a string it is the substring the operator contractually is elsewhere
 * (`FILTER_TEXT_CASES`), kept so a mis-aimed membership filter on a scalar
 * field does not accidentally pass.
 */
const matchOne = (row: Record<string, any>, field: string, comparand: unknown): boolean => {
  const stored = row[field];
  if (comparand !== null && typeof comparand === 'object' && !Array.isArray(comparand)) {
    const ops = Object.entries(comparand as Record<string, unknown>);
    if (ops.length !== 1) {
      throw new Error(`fixture evaluator: unrecognised operator object ${JSON.stringify(comparand)}`);
    }
    const [op, operand] = ops[0];
    // `$in` is here because the component ALSO issues a lookup-label probe
    // (`{ id: { $in: [...] } }` against the referenced object) whenever a
    // rendered column is relational. Admitting it keeps the evaluator honest —
    // the alternative is an evaluator that throws on a query the subject
    // legitimately makes, which reads as a defect that is not there.
    if (op === '$in') return Array.isArray(operand) && operand.includes(stored);
    if (op !== '$contains') {
      throw new Error(`fixture evaluator: unrecognised operator object ${JSON.stringify(comparand)}`);
    }
    if (Array.isArray(stored)) return stored.includes(operand);
    return typeof stored === 'string' && stored.includes(String(operand));
  }
  if (Array.isArray(stored)) {
    throw new InvalidFilterError(
      `400 INVALID_FILTER — The bare equality spelling { "${field}": value } WAS NOT APPLIED: ` +
        `"${field}" is a multi-value (or otherwise JSON-valued) field, stored by this driver as a ` +
        `JSON TEXT column, and "=" compares that whole serialized text against a single value — it ` +
        `can never equal one member. Use "$contains" for membership.`,
    );
  }
  return stored === comparand;
};

/** Walk the MongoDB-style object this list sends when nothing else is authored. */
const evaluate = (filter: unknown, rows: Record<string, any>[]): Record<string, any>[] => {
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
    // ⛔ The permissive arm is the one bug that would make this whole file lie:
    // it would answer "all rows" for a filter nobody wrote, which every
    // assertion below would read as a pass.
    throw new Error(`fixture evaluator: unsupported $filter shape ${JSON.stringify(filter)}`);
  }
  const entries = Object.entries(filter as Record<string, unknown>);
  if (entries.length === 0) throw new Error('fixture evaluator: refusing an EMPTY $filter (that is a full-table fetch)');
  return rows.filter((row) => entries.every(([field, comparand]) => matchOne(row, field, comparand)));
};

/** A schema whose `fields` is the Record shape the metadata API usually serves. */
const recordSchema = (name: string, fields: Record<string, unknown>) => ({ name, fields });
/** …and the ARRAY shape it also serves (`FieldContainerLike`, `@object-ui/core`). */
const arraySchema = (name: string, fields: Record<string, any>) => ({
  name,
  fields: Object.entries(fields).map(([fieldName, def]) => ({ name: fieldName, ...def })),
});

/**
 * The `$select` every query of this file's lists carries since objectui#10186:
 * `renderList` authors one column, so the row fetch projects to it plus `id`.
 * Spread into each expected wire so the cases here keep pinning the WHOLE query
 * while their subject stays the `$filter` beside it.
 */
const PROJECTION = { $select: ['id', 'subject'] };

const makeDS = (objectSchema: unknown, rows: Record<string, any>[]) => ({
  find: vi.fn(async (_object: string, params: any) => evaluate(params?.$filter, rows)),
  getObjectSchema: vi.fn(async () => objectSchema),
});

const listElement = (
  ds: unknown,
  object: string,
  referenceField: string,
  extra: Record<string, any> = {},
) => (
  <RelatedList
    title="Assignments"
    type="table"
    api={object}
    objectName={object}
    referenceField={referenceField}
    parentId={PARENT_ID}
    columns={[{ field: 'subject', label: 'Subject' }]}
    dataSource={ds as any}
    {...extra}
  />
);

const renderList = (
  ds: unknown,
  object: string,
  referenceField: string,
  extra: Record<string, any> = {},
) => render(listElement(ds, object, referenceField, extra));

/**
 * The list's OWN queries, separated from the lookup-label probe the same mock
 * receives. Reading `mock.calls` raw would assert against whichever query
 * happened to land last, which is a different fact from the one under test.
 */
const scopedCalls = (ds: { find: { mock: { calls: any[][] } } }, object: string): any[] =>
  ds.find.mock.calls.filter((c) => c[0] === object).map((c) => c[1]);

/** The list's most recent own query. `Array.prototype.at` is outside this package's TS lib. */
const lastScopedCall = (ds: { find: { mock: { calls: any[][] } } }, object: string): unknown => {
  const calls = scopedCalls(ds, object);
  return calls[calls.length - 1];
};

describe('RelatedList — a related list on a MULTI-VALUE relationship returns data (objectui#7299)', () => {
  it('FIXTURE — each branch reads a different number, so dropping a conjunct is visible', () => {
    expect(FIXTURE_ARITHMETIC).toEqual({ members: 2, all: 4, control: 1 });
  });

  it('SUBJECT — renders the parent’s rows when the relationship field is `multiple: true`', async () => {
    const ds = makeDS(recordSchema(CHILD, { [REL]: { type: 'user', reference: 'sys_user', multiple: true } }), MULTI_ROWS);
    renderList(ds, CHILD, REL);
    // On screen, not on the wire: the acceptance is "the list returns data".
    expect(await screen.findByText('Ship the thing')).toBeInTheDocument();
    expect(await screen.findByText('Review the thing')).toBeInTheDocument();
    // …and NOT the other parent's rows — a fix that simply stopped scoping
    // would satisfy the two assertions above and fail these two.
    expect(screen.queryByText('Someone else’s job')).toBeNull();
    expect(screen.queryByText('Nobody’s job')).toBeNull();
  });

  it('SUBJECT — the composed predicate is the membership spelling the driver prescribes', async () => {
    const ds = makeDS(recordSchema(CHILD, { [REL]: { type: 'user', multiple: true } }), MULTI_ROWS);
    renderList(ds, CHILD, REL);
    await waitFor(() => {
      expect(lastScopedCall(ds, CHILD)).toEqual({ ...PROJECTION, $filter: { [REL]: { $contains: PARENT_ID } } });
    });
  });

  it('ONE READ — the fetch waits for the settled child definition; its first and only query is the membership one (objectui#10690)', async () => {
    // This case was the DECLARED COST: the arity was `false` until the child
    // definition landed, so a multi-value list sent the equality query first —
    // refused — and then the membership one. The fetch now waits on
    // `useSettledSchema`, so the arity is known before the first query. The
    // stranding that decision guarded against — no `getObjectSchema`, or a
    // read that rejects — cannot happen, because the hook settles with no
    // definition on both; the `SETTLES` cases below pin that.
    const ds = makeDS(recordSchema(CHILD, { [REL]: { type: 'user', multiple: true } }), MULTI_ROWS);
    renderList(ds, CHILD, REL);
    expect(await screen.findByText('Ship the thing')).toBeInTheDocument();
    // Give a (wrong) trailing read a few turns to show up before reading the
    // whole list of queries.
    await new Promise((r) => setTimeout(r, 10));
    expect(scopedCalls(ds, CHILD)).toEqual([
      { ...PROJECTION, $filter: { [REL]: { $contains: PARENT_ID } } },
    ]);
  });

  it('CONTROL — a single-valued relationship keeps bare equality, byte for byte', async () => {
    const ds = makeDS(recordSchema('contact', { account: { type: 'lookup', reference: 'account' } }), SINGLE_ROWS);
    renderList(ds, 'contact', 'account');
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).toBeNull();
    // The pre-card wire, unchanged: a MongoDB-style object, not an AST, and not
    // an operator map. EVERY scoped call, not just the last — one read, as the
    // `ONE READ` case above asks of the multi-value list, and a second,
    // different call is how an arity flip would show.
    expect(scopedCalls(ds, 'contact')).toEqual([{ ...PROJECTION, $filter: { account: PARENT_ID } }]);
  });

  it('CONTROL — `multiple: false` is single-valued, stated explicitly', async () => {
    const ds = makeDS(recordSchema('contact', { account: { type: 'lookup', multiple: false } }), SINGLE_ROWS);
    renderList(ds, 'contact', 'account');
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(scopedCalls(ds, 'contact')).toEqual([{ ...PROJECTION, $filter: { account: PARENT_ID } }]);
  });

  it('reads the ARRAY-shaped field container the metadata API also serves', async () => {
    const ds = makeDS(arraySchema(CHILD, { [REL]: { type: 'user', multiple: true } }), MULTI_ROWS);
    renderList(ds, CHILD, REL);
    expect(await screen.findByText('Ship the thing')).toBeInTheDocument();
    expect(lastScopedCall(ds, CHILD)).toEqual({ ...PROJECTION, $filter: { [REL]: { $contains: PARENT_ID } } });
  });

  it('SPEC PREDICATE — an inherently-array option type is multi-valued with no `multiple` flag', async () => {
    // The verdict is `@objectstack/spec/data`'s `isMultiValueField`, not a local
    // rule, and this case is why that distinction is load-bearing rather than
    // tidy: `MULTI_OPTION_TYPES` (`multiselect` / `checkboxes` / `tags`) persist
    // an ARRAY with no flag at all. An eyeballed `multiple === true` answers
    // "single-valued" here and emits the equality the driver refuses — this
    // card's own defect, reproduced one layer up by the fix for it.
    const ds = makeDS(recordSchema(CHILD, { [REL]: { type: 'multiselect' } }), MULTI_ROWS);
    renderList(ds, CHILD, REL);
    await waitFor(() => {
      expect(lastScopedCall(ds, CHILD)).toEqual({ ...PROJECTION, $filter: { [REL]: { $contains: PARENT_ID } } });
    });
  });

  it('SPEC PREDICATE — `multiple: true` is INERT on a type outside MULTI_CAPABLE_TYPES', async () => {
    // The same delegation read the other way: `master_detail` is not a
    // multi-capable type, so the SPEC's rule says the flag does not make the
    // stored value an array, and this component sends `=`.
    //
    // ⚠️ What this case pins is the component's DELEGATION, ⛔ not that `=` is
    // the predicate the storage will answer (objectui#8937). `driver-sql` reads
    // `multiple` as truthy on ANY type, stores a JSON column, and refuses `=`
    // here with the same `400 INVALID_FILTER` this card was filed for. That
    // divergence is KNOWN and owned upstream (objectstack#17469); it is ⛔ not a
    // regression of this card — the pre-fix renderer sent `=` for this shape
    // too — and ⛔ not repairable by widening the predicate on this side, which
    // would only move the disagreement rather than end it.
    //
    // The opposite error is still real and still guarded: an eyeballed
    // `multiple === true` would send `$contains` against a genuinely scalar
    // column, which fails as "no rows" rather than as a refusal.
    const ds = makeDS(
      recordSchema('contact', { account: { type: 'master_detail', reference: 'account', multiple: true } }),
      SINGLE_ROWS,
    );
    renderList(ds, 'contact', 'account');
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(scopedCalls(ds, 'contact')).toEqual([{ ...PROJECTION, $filter: { account: PARENT_ID } }]);
  });

  it('COUNTER-PROBE — a def that declares no `type` is single-valued', async () => {
    const ds = makeDS(recordSchema('contact', { account: { multiple: true } }), SINGLE_ROWS);
    renderList(ds, 'contact', 'account');
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(scopedCalls(ds, 'contact')).toEqual([{ ...PROJECTION, $filter: { account: PARENT_ID } }]);
  });

  it('COUNTER-PROBE — an off-spec truthy `multiple` is NOT coerced into multi-value', async () => {
    // AGENTS.md #0.1: `multiple: 'yes'` is a producer bug. Reading it as `true`
    // here would make the renderer a second, looser contract for field arity —
    // and would silently change the predicate for metadata the spec rejects.
    // The spec's predicate refuses it for the same reason (`=== true`).
    const ds = makeDS(recordSchema('contact', { account: { type: 'lookup', multiple: 'yes' } }), SINGLE_ROWS);
    renderList(ds, 'contact', 'account');
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(scopedCalls(ds, 'contact')).toEqual([{ ...PROJECTION, $filter: { account: PARENT_ID } }]);
  });

  it('COUNTER-PROBE — no schema at all is single-valued, not "unknown, so skip the fetch"', async () => {
    // A `DataSource` without `getObjectSchema` must keep fetching. Gating the
    // rows on a resolved schema would trade this card's loud 400 on one shape
    // for a silent empty list on every related list in the app.
    const ds = { find: vi.fn(async (_o: string, p: any) => evaluate(p?.$filter, SINGLE_ROWS)) };
    renderList(ds, 'contact', 'account');
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(scopedCalls(ds as any, 'contact')).toEqual([{ ...PROJECTION, $filter: { account: PARENT_ID } }]);
  });

  it('ANDs the list’s own declared scope with the membership condition, through the shared sink', async () => {
    // WIRE only, and deliberately so: the subject here is the COMPOSITION, and
    // the evaluator above answers the MongoDB-style object arm alone. Teaching
    // it the AST would mean writing a second filter engine inside a test file
    // to assert a shape the shared sink already owns (`RelatedList.listFilter`
    // pins that sink); the class predicate is covered by the on-screen cases.
    const ds = { find: vi.fn(async () => [] as any[]), getObjectSchema: vi.fn(async () => recordSchema(CHILD, { [REL]: { type: 'user', multiple: true } })) };
    renderList(ds, CHILD, REL, { filter: [{ field: 'status', operator: 'equals', value: 'open' }] });
    // The parent condition is lowered by `toFilterNode` like every other source
    // — `$contains` becomes the AST operator `contains` — and stays its own
    // child under one `and`, never substituted for.
    await waitFor(() => {
      expect(lastScopedCall(ds as any, CHILD)).toEqual({
        ...PROJECTION,
        $filter: ['and', [REL, 'contains', PARENT_ID], [['status', 'equals', 'open']]],
      });
    });
  });

  it('GUARD INTACT — still refuses to fetch at all without a referenceField', async () => {
    // objectui#7299 must not trade a loud 400 for a silent full-table scan: the
    // unscoped-fetch guard is untouched by the arity decision.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = makeDS(recordSchema(CHILD, { [REL]: { type: 'user', multiple: true } }), MULTI_ROWS);
    render(
      <RelatedList title="Assignments" type="table" api={CHILD} objectName={CHILD} parentId={PARENT_ID} dataSource={ds as any} />,
    );
    await new Promise((r) => setTimeout(r, 10));
    // `find` NOT CALLED is the whole guard — the console hint beside it has its
    // own (narrower) firing condition and is not what protects the table.
    expect(ds.find).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('RelatedList — the fetch waits for the SETTLED child definition, and settling never strands rows (objectui#10690)', () => {
  it('SETTLES — no `getObjectSchema`: the gate opens inside the mount itself, one read, rows shown', async () => {
    const ds = { find: vi.fn(async (_o: string, p: any) => evaluate(p?.$filter, SINGLE_ROWS)) };
    renderList(ds, 'contact', 'account');
    // Read with NO `await` first. RTL's `render` returns only after React has
    // flushed the mount's effects and every update they scheduled, and the
    // hook's no-source exit settles synchronously inside its first effect,
    // before any `await`. So the query is already out: the gate costs one
    // extra render here, and no definition read.
    expect(scopedCalls(ds as any, 'contact')).toHaveLength(1);
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).toBeNull();
    expect(scopedCalls(ds as any, 'contact')).toEqual([{ ...PROJECTION, $filter: { account: PARENT_ID } }]);
  });

  it('SETTLES — a definition read that throws: one read, rows shown', async () => {
    // The hook reports the failed read on `console.error`; silenced, not pinned.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ds = {
        find: vi.fn(async (_o: string, p: any) => evaluate(p?.$filter, SINGLE_ROWS)),
        getObjectSchema: vi.fn(async () => {
          throw new Error('metadata read refused');
        }),
      };
      renderList(ds, 'contact', 'account');
      // objectui#10657 PR 2: after a failed definition read every cell is
      // WITHHELD (drawn as the mask), so the shown rows are counted, not read
      // by name: the parent-scoped query returns the one matching row.
      await waitFor(() => {
        expect(document.querySelector('tbody')?.textContent ?? '').toContain('••••••');
        expect(document.querySelectorAll('tbody tr')).toHaveLength(SINGLE_MATCH_COUNT);
      });
      expect(screen.queryByText('Bob')).toBeNull();
      await new Promise((r) => setTimeout(r, 10));
      expect(scopedCalls(ds as any, 'contact')).toEqual([{ ...PROJECTION, $filter: { account: PARENT_ID } }]);
    } finally {
      error.mockRestore();
    }
  });

  it('SWITCH — a switched `api` queries with the NEW object’s definition, never the previous one’s', async () => {
    // Mounted on a single-valued child, then switched to the multi-valued one.
    // A fetch that ran on the previous object's definition would read the new
    // relationship as single-valued and send the equality the driver refuses.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const schemas: Record<string, unknown> = {
        contact: recordSchema('contact', { account: { type: 'lookup', reference: 'account' } }),
        [CHILD]: recordSchema(CHILD, { [REL]: { type: 'user', multiple: true } }),
      };
      const rowsByObject: Record<string, Record<string, any>[]> = { contact: SINGLE_ROWS, [CHILD]: MULTI_ROWS };
      const ds = {
        find: vi.fn(async (object: string, params: any) => evaluate(params?.$filter, rowsByObject[object] ?? [])),
        getObjectSchema: vi.fn(async (object: string) => schemas[object]),
      };
      const { rerender } = renderList(ds, 'contact', 'account');
      expect(await screen.findByText('Alice')).toBeInTheDocument();
      rerender(listElement(ds, CHILD, REL));
      expect(await screen.findByText('Ship the thing')).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 10));
      expect(scopedCalls(ds, CHILD)).toEqual([{ ...PROJECTION, $filter: { [REL]: { $contains: PARENT_ID } } }]);
      expect(scopedCalls(ds, 'contact')).toEqual([{ ...PROJECTION, $filter: { account: PARENT_ID } }]);
    } finally {
      error.mockRestore();
    }
  });
});

describe('RelatedList — the raw-URL fallback cannot express membership (objectui#7299)', () => {
  let warn: MockInstance<typeof console.warn>;
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async () => ({ json: async () => [] }) as any);
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    warn.mockRestore();
    globalThis.fetch = originalFetch;
  });

  /** No `find`, so the legacy querystring is the only channel; `getObjectSchema` still answers arity. */
  const schemaOnlyDS = (objectSchema: unknown) => ({ getObjectSchema: vi.fn(async () => objectSchema) });

  it('refuses, and names the field, rather than sending a predicate it knows is wrong', async () => {
    // `filter[<field>]=<value>` carries no operator. The repo's one operator
    // contract for that spelling is `drillUrlFilters`' `URL_FILTER_OPS` —
    // gte/lte/gt/lt — whose parser DROPS an unrecognised suffix, so a hopeful
    // `filter[f][contains]=` would arrive as NO condition: an unscoped fetch of
    // the whole child table. Empty-and-loud is the posture the sibling arm and
    // the unscoped-fetch guard already take.
    renderList(schemaOnlyDS(recordSchema(CHILD, { [REL]: { type: 'user', multiple: true } })), CHILD, REL);
    await waitFor(() => {
      const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(said).toContain('multi-value field "assignees"');
      expect(said).toContain('no membership operator');
    });
    // No request at all (objectui#10690). This used to be the adapter path's
    // declared cost: the equality URL went out once before the arity was known.
    // The fetch now waits for the settled child definition, so the arity is
    // known before the first request and this path refuses without sending one.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([]);
  });

  it('CONTROL — leaves the single-valued fallback URL untouched', async () => {
    renderList(schemaOnlyDS(recordSchema('contact', { account: { type: 'lookup' } })), 'contact', 'account');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      `contact?filter%5Baccount%5D=${encodeURIComponent(PARENT_ID)}`,
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});
