/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-grid` — the four keys ruled NON-AUTHOR SURFACE stay unlisted, and
 * stay read (objectui#5091).
 *
 * ## The card, and the ruling
 *
 * objectui#5091 found four keys `ObjectGrid` reads through `(schema as any)`
 * that `GRID_QUERY_INPUTS` does not publish. `inputs` is not documentation: it
 * is the published AUTHORING surface, serialized by `sdui-parser`'s
 * `gen-manifest.ts` into `sdui.manifest.json` (the save gate and parser
 * whitelist) and into `sdui-intrinsics.d.ts`, and read by the designer panel.
 * A key the renderer honours and `inputs` omits therefore draws `unknown-prop`
 * from the parser on a key that works — objectui#4648's complaint.
 *
 * The maintainer ruled per key on 2026-08-18. THREE of them — `columnState`,
 * `hideRowHeightToggle`, `maxInlineRowActions` — are NOT authoring surface and
 * stay out of the manifest and the docs: a cast read of theirs is deliberate,
 * not missed. This file is where that word "deliberate" is said to the tooling,
 * so the next census re-files the card only if something really changed.
 *
 * ## The fourth key, and the reversal that settled it (2026-08-19)
 *
 * `rowActionDefs` was ruled the other way on 2026-08-18 — INTO the manifest, on
 * the reading that it is the symmetric partner of the declared
 * `bulkActionDefs`. That premise was falsified by measurement, and on
 * 2026-08-19 the maintainer KNOWINGLY REVERSED that one line: the key is
 * NON-AUTHOR SURFACE, same as the other three. The reversal was flagged as a
 * reversal when it was accepted, so a reader who finds the older ruling has
 * found history, not a contradiction. The three measurements it rests on:
 *
 *   - `app-shell/src/views/ObjectView.tsx:1968` DERIVES the grid's
 *     `rowActionDefs` from `objectDef.actions` filtered by
 *     `locations: ['list_item']`, while passing `bulkActionDefs` straight
 *     through from the view author twenty lines below. Asymmetric by
 *     construction — one is computed, the other authored.
 *   - The spec's `ObjectGridPropsSchema` is a `strictObject` that accepts
 *     `bulkActionDefs` and REJECTS `rowActionDefs` by name, so declaring it
 *     would publish a key the save gate refuses.
 *   - `@object-ui/types`' `ObjectGridSchema` declares `bulkActionDefs` and no
 *     `rowActionDefs` — which is why the read is a cast at all.
 *
 * So the authored way to put an action on a row stays what it already was: the
 * object's own action with `locations: ['list_item']`, plus the declared legacy
 * `rowActions` name list. `bulkActionDefs` keeps its job here as the DECLARED
 * CONTROL below — the one key of the pair that IS authoring surface, which is
 * what makes every "not published" assertion mean something.
 *
 * ## The shape of the pin — four assertions per key, and why each is needed
 *
 * Reusable as-is for the same census one and two packages over (objectui#5097
 * on `record:*` / `view:object`, objectui#5102):
 *
 *   1. NOT PUBLISHED, on every tag the renderer is registered under. One
 *      renderer registered twice is two chances to disagree with itself.
 *   2. THE CONTRACT REJECTS IT BY NAME. `ComponentPropsMap['object-grid']` is
 *      strict, so the key comes back in `unrecognized_keys` — asserted as a KEY
 *      verdict (the fixture is otherwise legal), never as a whole-document
 *      `success`, which would confuse "this key is refused" with "this document
 *      is well-formed". This is the half that makes the exemption checkable
 *      rather than an opinion: publishing the key would put the manifest at
 *      odds with the gate that stores the document.
 *   3. THE PARSER SAYS SO OUT LOUD, through the real validator over a manifest
 *      built from the LIVE registry — never a hand-written one that could agree
 *      with itself. `unknown-prop` on these keys is the intended, ruled outcome,
 *      not a defect; pinning it is what stops a later "tidy-up" from declaring
 *      them to silence a warning.
 *   4. THE RENDERER STILL READS IT. The ruling kept every read site; only the
 *      status changed. Deleting a read is the one move that would make an
 *      author's stored document quietly do nothing, and it is exactly what a
 *      reader who sees "non-author surface" might think is the tidy finish.
 *
 * The control in 1-3 is `bulkActionDefs`: declared, spec-accepted, clean
 * through the parser. Without it, all three assertions would pass just as
 * happily against a registry that published nothing at all.
 *
 * ## The fifth key the census found — and why it is NOT a fifth non-author key
 *
 * objectui#5240 filed `userActions` as a sixth cast-read grid key, on the
 * reading that it was one more "deliberately unlisted" surface with no
 * producer. Measurement refuted that, twice over, so the maintainer ruled on
 * 2026-08-20 (Q1=A · Q2=B · Q3=B) that the fix lands with the MEASURED reason
 * rather than the assumed one. What is actually wrong is a **name collision**:
 *
 *   - VIEW-level `userActions` is TOOLBAR POLICY — the spec's
 *     `UserActionsConfigSchema` (`sort`, `search`, `filter`, `refresh`,
 *     `rowHeight`, `addRecordForm`, `editInline`, `buttons`), which REJECTS
 *     `edit` BY NAME. `ListViewSchema` accepts it, so it is spec-legal, and it
 *     is really written: `app-shell`'s `ObjectView` builds one unconditionally.
 *     "Nobody authors it" was false. (A second producer,
 *     `SpecBridge.transformListView`, copied it onto the `object-grid` node
 *     until the whole spec-bridge was retired — objectui#6366, 2026-08-27
 *     maintainer ruling: zero measured consumers on every reachable endpoint.)
 *   - OBJECT-level `userActions` is the CRUD-PREDICATE block (`edit` /
 *     `delete` / `create` carrying `visibleWhen` / `disabledWhen`,
 *     objectui#2614) — the only shape `listViewPredicates` can read, since its
 *     loop skips every non-object value.
 *
 * `ObjectGrid` used to read the key VIEW-FIRST when harvesting predicate
 * fields for `$select`, so an authored toolbar block SHADOWED the object's CRUD
 * predicates and silently dropped their operands from the projection —
 * objectui#3501's fail-closed CEL fault (`No such key`), reached with a success
 * receipt. That read is now object-only, and both read sites carry the
 * collision comment.
 *
 * The pin below is therefore shaped differently from the four above: it does
 * NOT assert "no producer writes this" (two do) and it does not claim the key
 * is non-author surface. It asserts the four things the comments DO claim —
 * the two shapes, the producer, and the harvest's blindness to the toolbar
 * one — plus the renderer behaviour that shadowing broke. The RENDER channel of
 * the surviving object-block read is already pinned four times over by
 * `rowCrudEffectiveOps.test.tsx`'s `userActions` opt-out control group, so it
 * is cited here rather than duplicated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry, collectPredicateFieldRefs, listViewPredicates } from '@object-ui/core';
import { ComponentPropsMap, ListViewSchema, UserActionsConfigSchema } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

import { ObjectGrid } from '../ObjectGrid';
// Module scope, not a hook: this import IS the registration (AGENTS.md's
// test-discipline section — an unbounded module load must not be billed to a
// bounded window).
import '../index';

registerAllFields();

/** The two tags this one renderer is published under. */
const GRID_TAGS = [
  { label: 'object-grid', type: 'object-grid', namespace: undefined },
  { label: 'view:grid', type: 'grid', namespace: 'view' },
] as const;

/**
 * The four keys ruled NON-AUTHOR SURFACE, each with the producer that writes
 * it and the date it was ruled. The producer is the evidence: "non-author" is a
 * claim about who WRITES the key, so a reader can check it rather than trust
 * it. The date is here because they are NOT all from one ruling —
 * `rowActionDefs` was ruled the other way first, and a failure message that
 * cites the wrong date sends the next reader to the ruling that was reversed.
 */
const NON_AUTHOR_KEYS = [
  {
    key: 'columnState',
    ruled: '2026-08-18',
    producer: "app-shell ObjectView: the list schema's `columnState` in (the user's list state, then the view), `persistListColumnState` back out",
    sample: { order: ['name'] },
  },
  {
    key: 'hideRowHeightToggle',
    ruled: '2026-08-18',
    producer: 'plugin-list ListView: the child view schema it builds sets it — the embedding view owns density',
    sample: true,
  },
  {
    key: 'maxInlineRowActions',
    ruled: '2026-08-18',
    producer: 'apps/console DevRowActions (`EnvGrid`) — an embedder layout call',
    sample: 2,
  },
  {
    key: 'rowActionDefs',
    // Ruled 2026-08-19, REVERSING the 2026-08-18 line that had sent this one
    // key into the manifest as `bulkActionDefs`'s symmetric partner.
    ruled: '2026-08-19 (reversing 2026-08-18)',
    producer:
      "app-shell ObjectView: the list schema's `rowActionDefs` — DERIVED from objectDef.actions filtered by locations:['list_item'], "
      + 'whereas bulkActionDefs beside it is passed through from the author',
    sample: [{ name: 'approve', label: 'Approve' }],
  },
] as const;

/** The declared control: ruled-in surface, spec-accepted, parser-clean. */
const DECLARED_CONTROL = 'bulkActionDefs';

const declaredInputNames = (type: string, namespace?: string): string[] =>
  ((ComponentRegistry.getConfig(type, namespace) as any)?.inputs ?? []).map((i: any) => i.name);

/**
 * A manifest built the way `gen-manifest.ts` and the JSX-page compiler build
 * theirs — from the live registry — so these verdicts are the ones a real
 * author gets, not the ones a fixture was written to produce.
 */
const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

/** Diagnostics a one-node `object-grid` document draws for `props`. */
const diagnose = (props: Record<string, unknown>) =>
  validateTree(
    { type: 'object-grid', objectName: 'account', ...props } as never,
    liveManifest(),
  ).diagnostics;

/** The spec's verdict on ONE key added to an otherwise legal grid document. */
const specVerdict = (key: string, value: unknown) =>
  (ComponentPropsMap as Record<string, any>)['object-grid'].safeParse({
    objectName: 'account',
    [key]: value,
  });

describe('the four ruled non-author keys are not published (objectui#5091)', () => {
  it.each(GRID_TAGS)('$label publishes none of them', ({ type, namespace }) => {
    const declared = declaredInputNames(type, namespace);
    for (const { key, producer, ruled } of NON_AUTHOR_KEYS) {
      expect(
        declared,
        [
          `\`${type}\` publishes \`${key}\` as authoring surface. The ${ruled} ruling on`,
          'objectui#5091 put it out of the manifest deliberately: it is written by the HOST',
          `(${producer}), and the spec's \`ObjectGridPropsSchema\` rejects it by name, so an`,
          'author who accepted the offer could not save the document.',
        ].join('\n'),
      ).not.toContain(key);
    }
  });

  it.each(GRID_TAGS)('$label does publish the declared control, so absence means something', ({ type, namespace }) => {
    // Without this, "not published" would pass against an empty registration.
    expect(declaredInputNames(type, namespace)).toContain(DECLARED_CONTROL);
  });
});

describe('the contract rejects the four by name — the exemption is checkable (objectui#5091)', () => {
  it.each(NON_AUTHOR_KEYS)('the spec refuses $key as an unrecognized key', ({ key, sample, ruled }) => {
    const result = specVerdict(key, sample);
    expect(result.success, `\`@objectstack/spec\` now ACCEPTS object-grid.${key} — re-open the ${ruled} ruling`).toBe(false);
    // A KEY verdict, not a document verdict: the rest of the fixture is legal,
    // so the only thing that can be reported is this key's rejection.
    const unrecognized = (result as { error: { issues: Array<{ code: string; keys?: string[] }> } }).error.issues
      .filter((issue) => issue.code === 'unrecognized_keys')
      .flatMap((issue) => issue.keys ?? []);
    expect(unrecognized).toContain(key);
  });

  it(`accepts the declared control ${DECLARED_CONTROL}`, () => {
    // The control that separates "this key is refused" from "this schema
    // refuses everything". A FULL parse, because the claim here is that the
    // whole document is legal — the asymmetry the ruling rests on.
    const result = specVerdict(DECLARED_CONTROL, []);
    expect(result.success).toBe(true);
  });
});

describe('the parser reports them as unknown props — the ruled outcome (objectui#5091)', () => {
  it.each(NON_AUTHOR_KEYS)('$key draws unknown-prop from the real validator', ({ key, sample, ruled }) => {
    const codes = diagnose({ [key]: sample }).filter((d) => d.code === 'unknown-prop');
    expect(
      codes.map((d) => d.message).join('\n'),
      `\`${key}\` no longer draws \`unknown-prop\`. If that is deliberate it means the key was`
        + ` declared — which the ${ruled} ruling forbids for this key.`,
    ).toContain(key);
  });

  it('a declared key draws nothing, so the diagnosis is not vacuous', () => {
    // `rowHeight` is declared and its value is legal, so a clean run here is
    // what proves the four above are reporting the KEY and not the fixture.
    expect(diagnose({ rowHeight: 'compact' }).filter((d) => d.code === 'unknown-prop')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The reads themselves — unchanged by the ruling, and the half a reader of
// "non-author surface" is most likely to delete.
// ---------------------------------------------------------------------------

const rows = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: 'bob@example.com' },
];

function makeAdapter(objectSchema?: Record<string, unknown>) {
  return {
    find: vi.fn().mockResolvedValue({ data: rows, total: rows.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'test_object',
      fields: { id: { type: 'text' }, name: { type: 'text' }, email: { type: 'text' } },
      ...objectSchema,
    }),
  };
}

function renderGrid(extra: Record<string, unknown>, objectSchema?: Record<string, unknown>) {
  const schema = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [{ field: 'name', label: 'Name' }, { field: 'email', label: 'Email' }],
    data: { provider: 'value', items: rows },
    ...extra,
  } as any;
  // `dataSource` is a PROP of this component, not something it reads from the
  // provider context (`ObjectGrid.tsx:371`) — the provider is what threads it
  // through in the `SchemaRenderer` path. Passing it here is what lets the grid
  // fetch `objectSchema` for inline data (`ObjectGrid.tsx:967`), which is where
  // the object's action declarations come from.
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={makeAdapter(objectSchema) as any} />
    </ActionProvider>,
  );
}

const settled = async () => {
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
};

beforeEach(() => {
  // The `columnState` seed falls back to localStorage per storage key; a
  // leaked entry would make the next case pass for the wrong reason.
  localStorage.clear();
});

describe('the renderer still reads all four (objectui#5091 kept every read site)', () => {
  it('columnState.order still reorders the columns', async () => {
    const { container } = renderGrid({ id: 'ordered', columnState: { order: ['email', 'name'] } });
    await settled();
    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
    // The two data columns, in the order the HOST's saved state asked for.
    expect(headers.filter((h) => h === 'Name' || h === 'Email')).toEqual(['Email', 'Name']);
  });

  it('columnState absent leaves the authored column order alone', async () => {
    const { container } = renderGrid({ id: 'unordered' });
    await settled();
    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
    expect(headers.filter((h) => h === 'Name' || h === 'Email')).toEqual(['Name', 'Email']);
  });

  it('hideRowHeightToggle still hides the toolbar toggle a declared rowHeight offers', async () => {
    const shown = renderGrid({ id: 'toggle-on', rowHeight: 'compact' });
    await settled();
    expect(screen.getByTitle(/^Row height:/)).toBeInTheDocument();
    shown.unmount();

    renderGrid({ id: 'toggle-off', rowHeight: 'compact', hideRowHeightToggle: true });
    await settled();
    expect(screen.queryByTitle(/^Row height:/)).toBeNull();
  });

  it('maxInlineRowActions still widens the inline-button budget', async () => {
    const actions = [
      { name: 'approve', label: 'Approve', variant: 'primary' },
      { name: 'reject', label: 'Reject', variant: 'primary' },
    ];
    const rowActions = ['approve', 'reject'];

    // Default budget (the `?? 1` at the read site): one primary inline, the
    // other folded into the "⋮" menu, which renders nothing until it is opened.
    const single = renderGrid({ id: 'budget-default', rowActions }, { actions });
    await settled();
    await waitFor(() => expect(screen.getAllByTestId('row-action-inline-approve').length).toBe(rows.length));
    expect(screen.queryAllByTestId('row-action-inline-reject')).toEqual([]);
    single.unmount();

    // The host raises the budget to two: both render inline.
    renderGrid({ id: 'budget-two', rowActions, maxInlineRowActions: 2 }, { actions });
    await settled();
    await waitFor(() => expect(screen.getAllByTestId('row-action-inline-reject').length).toBe(rows.length));
    expect(screen.getAllByTestId('row-action-inline-approve').length).toBe(rows.length);
  });

  // `rowActionDefs` has TWO read sites and they are different channels, so one
  // assertion cannot stand for both. The first renders the defs; the second
  // decides which FIELDS the server is asked for. A deletion of either is
  // silent in a way the other would not catch.

  it('rowActionDefs still reaches the row menu — read site 1, the render channel', async () => {
    // Passed on the SCHEMA with no matching object action, so the only path
    // from this key to the screen is the `(schema as any).rowActionDefs` read
    // that seeds `resolveLegacyRowActions`. A def arriving any other way (the
    // legacy `rowActions` name list, resolved against the object) would not
    // exercise it — which is what the `maxInlineRowActions` case above uses.
    renderGrid({
      id: 'row-defs-render',
      rowActionDefs: [{ name: 'escalate', label: 'Escalate', variant: 'primary' }],
    });
    await settled();
    await waitFor(() => expect(screen.getAllByTestId('row-action-inline-escalate').length).toBe(rows.length));
    expect(screen.getAllByTestId('row-action-inline-escalate')[0]).toHaveTextContent('Escalate');
  });

  it('rowActionDefs still feeds the $select projection — read site 2, the fetch channel', async () => {
    // The read inside `getSelectFields` harvests each def's `visible` predicate
    // and adds the fields it names to `$select` (objectui#3501). Without it the
    // server is asked for every field EXCEPT the one the row action is gated
    // on, and CEL faults on the absent key — which fails CLOSED, so the button
    // vanishes for everyone with nothing pointing at the projection. That is
    // why deleting this read is worse than it looks, and why it is pinned
    // separately from the render channel above.
    const adapter = makeAdapter({
      fields: { id: { type: 'text' }, name: { type: 'text' }, status: { type: 'select' } },
    });
    render(
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'test_object',
            // `status` is deliberately NOT a column: a predicate-only field is
            // the ordinary case the harvest exists for.
            columns: [{ field: 'name', label: 'Name' }],
            rowActionDefs: [
              { name: 'escalate', label: 'Escalate', visible: 'record.status == "open"' },
            ],
          } as any}
          dataSource={adapter as any}
        />
      </ActionProvider>,
    );
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const select = (adapter.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
    expect(
      select,
      'the `visible` predicate\'s operand is missing from `$select` — the row action would'
        + ' fault on an absent key and fail closed for every row.',
    ).toContain('status');
    // The harvest ADDS; it never replaces what the columns asked for.
    expect(select).toContain('name');
    expect(select).toContain('id');
  });
});

// ---------------------------------------------------------------------------
// The FIFTH key the census found — `userActions` — which is a NAME COLLISION,
// not a fifth non-author key (objectui#5240, maintainer ruling 2026-08-20:
// Q1=A · Q3=B). See the docblock's last section for the full story; each
// assertion below pins one clause of the collision comment now carried at both
// read sites in `ObjectGrid.tsx`.
// ---------------------------------------------------------------------------

/** What a VIEW author legitimately writes: toolbar policy. */
const VIEW_TOOLBAR_BLOCK = { sort: true, search: true, filter: false };
/** What an OBJECT declares under the same name: a CRUD predicate block. */
const OBJECT_CRUD_BLOCK = { edit: { visibleWhen: 'record.status == "open"' } };
/** The toolbar vocabulary the comment lists by name. */
const TOOLBAR_KEYS = [
  'sort', 'search', 'filter', 'refresh', 'rowHeight', 'addRecordForm', 'editInline', 'buttons',
];

/** Unrecognized KEYS from a failed parse — a key verdict, never a document one. */
const unrecognizedKeys = (result: { success: boolean; error?: unknown }): string[] =>
  ((result as { error: { issues: Array<{ code: string; keys?: string[] }> } }).error?.issues ?? [])
    .filter((issue) => issue.code === 'unrecognized_keys')
    .flatMap((issue) => issue.keys ?? []);

describe('`userActions` is two blocks sharing one name — the view one is toolbar policy (objectui#5240)', () => {
  it.each(['edit', 'delete', 'create'])('the view-level schema refuses the CRUD key `%s` by name', (key) => {
    const result = UserActionsConfigSchema.safeParse({ [key]: { visibleWhen: 'record.status == "open"' } });
    expect(
      result.success,
      `\`UserActionsConfigSchema\` now ACCEPTS \`${key}\` — the two \`userActions\` blocks no longer`
        + ' collide, so re-read the collision comments in `ObjectGrid.tsx`: their premise was that a'
        + ' CRUD predicate block can never legally arrive on a VIEW.',
    ).toBe(false);
    expect(unrecognizedKeys(result)).toContain(key);
  });

  it('…and accepts the toolbar vocabulary, so those refusals are about the KEY', () => {
    // The control. Without it, "the view schema refuses `edit`" would pass just
    // as happily against a schema that refuses everything.
    expect(UserActionsConfigSchema.safeParse(VIEW_TOOLBAR_BLOCK).success).toBe(true);
    expect(
      Object.keys((UserActionsConfigSchema as unknown as { shape: Record<string, unknown> }).shape),
      'the toolbar vocabulary changed — the comments at both read sites spell it out by name.',
    ).toEqual(expect.arrayContaining(TOOLBAR_KEYS));
  });
});

describe('the view-level key is AUTHORED, not an unwritten surface (objectui#5240)', () => {
  it('a view document carrying the toolbar block is spec-legal', () => {
    // This is the measurement that killed the original "deliberately unlisted,
    // zero producers" reading. If it ever goes false, the collision comments
    // are describing a repo that no longer exists.
    const result = ListViewSchema.safeParse({
      name: 'my_view',
      label: 'My View',
      columns: [{ field: 'name' }],
      userActions: VIEW_TOOLBAR_BLOCK,
    });
    expect(result.success, JSON.stringify((result as { error?: unknown }).error ?? {})).toBe(true);
  });

  it('…while the CRUD block is refused on a view, at the userActions path', () => {
    const result = ListViewSchema.safeParse({
      name: 'my_view',
      label: 'My View',
      columns: [{ field: 'name' }],
      userActions: OBJECT_CRUD_BLOCK,
    });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('edit');
  });

  // A third `it` stood here: "the PRODUCER writes it onto the very
  // `object-grid` node ObjectGrid renders", witnessed with
  // `new SpecBridge().transformListView(...)`. Its own failure message said
  // "do not just delete this assertion" — that instruction covered the
  // producer-side fix routed through triage by the 2026-08-20 ruling, not what
  // actually happened: the WHOLE spec-bridge (`SpecBridge`, `bridgeListView`,
  // `bridgeFormView`) was retired by the 2026-08-27 maintainer ruling on
  // objectui#6366 (zero measured consumers at every reachable endpoint), so
  // the witness it rendered no longer exists. The key is still AUTHORED — the
  // surviving producer is `app-shell/src/views/ObjectView.tsx`, which builds a
  // view-level toolbar block unconditionally — and the two pins above still
  // hold the "spec-legal on a view" half of the claim.
});

describe('only the OBJECT block is interpretable by the predicate harvest (objectui#5240)', () => {
  it('the toolbar block yields ZERO predicate fields', () => {
    // Every value is a boolean, so `listViewPredicates` skips all of them. This
    // is why shadowing was silent: not an error, just nothing harvested.
    expect(collectPredicateFieldRefs(listViewPredicates({ userActions: VIEW_TOOLBAR_BLOCK }))).toEqual([]);
  });

  it('the object CRUD block yields its operand', () => {
    expect(collectPredicateFieldRefs(listViewPredicates({ userActions: OBJECT_CRUD_BLOCK }))).toContain('status');
  });
});

/**
 * `$select` for a grid whose OBJECT declares the CRUD predicate block, with
 * whatever the view carries layered on top.
 */
const projectionSelect = async (viewExtra: Record<string, unknown>): Promise<string[]> => {
  const adapter = makeAdapter({
    // `status` is deliberately NOT a column: a predicate-only field is the
    // ordinary case the harvest exists for.
    fields: { id: { type: 'text' }, name: { type: 'text' }, status: { type: 'select' } },
    userActions: OBJECT_CRUD_BLOCK,
  });
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: 'test_object',
          columns: [{ field: 'name', label: 'Name' }],
          ...viewExtra,
        } as any}
        dataSource={adapter as any}
      />
    </ActionProvider>,
  );
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return (adapter.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
};

describe('a view-level toolbar block must not shadow the object CRUD predicates (objectui#5240)', () => {
  it('the object block reaches $select — the surviving read is still there', async () => {
    // Pins the READ, not the fix: green on both legs of the shadowing change,
    // red the moment the `userActions` line is dropped from the harvest.
    expect(
      await projectionSelect({}),
      "the object's `userActions.edit.visibleWhen` operand is missing from `$select` — CEL faults"
        + ' on the absent key and the row Edit button fails closed for everyone (objectui#3501).',
    ).toContain('status');
  });

  it('…and a spec-legal toolbar block on the view does not knock it out', async () => {
    // The regression itself. Read view-first, the `??` took this block, the
    // harvest found no predicates in it, and `status` left the projection —
    // with a success receipt at every step.
    expect(
      await projectionSelect({ userActions: VIEW_TOOLBAR_BLOCK }),
      'a view-level toolbar block is shadowing the object CRUD predicates again: the projection'
        + ' lost `status`. The read at the `$select` harvest must stay object-only.',
    ).toContain('status');
  });
});

// ---------------------------------------------------------------------------
// The SIXTH key the census reached — `onNavigate` — a NON-AUTHOR key that is
// nevertheless DECLARED, and the one callback the grid reads off the schema
// (objectui#5234, maintainer ruling 2026-08-19, Option C).
//
// ## Why it is not a sixth entry in NON_AUTHOR_KEYS above
//
// Those four are CAST reads: `@object-ui/types` does not declare them, which is
// what makes `(schema as any).key` the only way to read them. `onNavigate` is
// the opposite — it is an explicitly declared member of `ObjectGridSchema` with
// its own doc comment, so the read at the `useNavigationOverlay` call is plain.
//
// The card originally argued the reverse: that the key was ABSENT from the
// interface and type-checked only because `BaseSchema`'s `[key: string]: any`
// absorbed it. Its own author withdrew that on 2026-08-18 after re-measuring —
// the evidence had been a grep bounded to lines 532-760 of an interface that
// runs past 760. So `declaresOnNavigate` below is not decoration: it pins the
// corrected fact, and it is the assertion that would have stopped the original
// error. Do not re-describe this key as drift or as an oversight.
//
// ## What the ruling actually decided, and what pins it
//
// Option C: keep the declaration, keep the read, and SAY that it is an
// exception — an exemption comment at the read site in the shape PR #5241
// established for the four above, and a programmatic-only note on the type.
// Option A (remove the key) was rejected as a breaking public type change for
// zero measured harm; option B (declare it in `GRID_QUERY_INPUTS`) as
// publishing to the designer a key no author can ever express.
//
// That makes this card's deliverable PROSE, and prose is exactly what a pin
// normally cannot see. Every assertion about the world — not published, spec
// rejects it, parser says unknown-prop, the renderer still reads it, the type
// still declares it — was already TRUE before this card and stays true if its
// change is reverted. They are the ledger's premises and are pinned so the
// exemption cannot decay, but on their own they would pin nothing.
//
// So the two `documents its exemption` cases below read the SOURCE, the way
// `ObjectGrid.exportOptionsKeys.test.ts` in this directory does. They are the
// only assertions here that can tell the two states of the world apart, and
// they are anchored on text that exists in BOTH — the read line itself and the
// declaration line itself — so a failure means the comment went missing, never
// that the anchor moved.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-grid/src/__tests__ -> repo root
const repoRoot = path.resolve(here, '../../../..');
const GRID_SOURCE = path.join(repoRoot, 'packages/plugin-grid/src/ObjectGrid.tsx');
const TYPES_SOURCE = path.join(repoRoot, 'packages/types/src/objectql.ts');

const gridLines = readFileSync(GRID_SOURCE, 'utf8').split('\n');
const typesLines = readFileSync(TYPES_SOURCE, 'utf8').split('\n');

/**
 * The contiguous comment block immediately above `index` — `//` lines or a
 * `/** ... *\/` block, stopping at the first line that is neither. Adjacency is
 * the point: a matching phrase anywhere else in a 3500-line file would satisfy
 * a whole-file `toContain` while the read site itself carried nothing.
 */
const commentBlockAbove = (lines: string[], index: number): string => {
  const out: string[] = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const t = lines[i].trim();
    if (t === '' && out.length === 0) continue;
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) out.unshift(t);
    else break;
  }
  return out.join('\n');
};

/** Indices of every line whose trimmed form satisfies `match`. */
const indicesWhere = (lines: string[], match: (t: string) => boolean): number[] =>
  lines.map((l, i) => (match(l.trim()) ? i : -1)).filter((i) => i >= 0);

/** `export interface ObjectGridSchema` .. its closing brace, as line indices. */
const objectGridSchemaSpan = (): [number, number] => {
  const start = typesLines.findIndex((l) => l.startsWith('export interface ObjectGridSchema'));
  const end = typesLines.findIndex((l, i) => i > start && l === '}');
  return [start, end];
};

/** The nine sibling callbacks the type note and the README claim are props-only. */
const NINE_SIBLINGS = [
  'onRowClick', 'onRowSelect', 'onCellChange', 'onRowSave', 'onBatchSave',
  'onEdit', 'onDelete', 'onBulkDelete', 'onAddRecord',
] as const;

describe('`onNavigate` — the ledger premises (objectui#5234)', () => {
  it.each(GRID_TAGS)('$label does not publish it as authoring surface', ({ type, namespace }) => {
    expect(
      declaredInputNames(type, namespace),
      '`onNavigate` is now published to the manifest, the designer panel and the generated'
        + ' `sdui-intrinsics.d.ts`. That is option B, which the 2026-08-19 ruling on objectui#5234'
        + ' rejected as the most AI-error-prone of the three: it advertises to an author a key that'
        + ' is a FUNCTION VALUE, and therefore one no JSON or YAML document can ever carry.',
    ).not.toContain('onNavigate');
    // The control from the four above, restated here so "not published" cannot
    // pass against a registration that published nothing at all.
    expect(declaredInputNames(type, namespace)).toContain(DECLARED_CONTROL);
  });

  it('the spec refuses it as an unrecognized key', () => {
    const result = specVerdict('onNavigate', () => {});
    expect(
      result.success,
      '`@objectstack/spec` now ACCEPTS object-grid.onNavigate — re-open the 2026-08-19 ruling.',
    ).toBe(false);
    // A KEY verdict, not a document one: the rest of the fixture is legal.
    const unrecognized = (result as { error: { issues: Array<{ code: string; keys?: string[] }> } }).error.issues
      .filter((issue) => issue.code === 'unrecognized_keys')
      .flatMap((issue) => issue.keys ?? []);
    expect(unrecognized).toContain('onNavigate');
  });

  it('the parser reports it as unknown-prop — the ruled outcome, not a defect', () => {
    const codes = diagnose({ onNavigate: () => {} }).filter((d) => d.code === 'unknown-prop');
    expect(
      codes.map((d) => d.message).join('\n'),
      '`onNavigate` no longer draws `unknown-prop`. If that is deliberate it means the key was'
        + ' declared to the manifest — which the 2026-08-19 ruling forbids for this key.',
    ).toContain('onNavigate');
  });

  it('`@object-ui/types` DOES declare it — the corrected premise, pinned', () => {
    // The fact the card got wrong. `onNavigate` appears three times in
    // `objectql.ts` (also on `ObjectViewSchema` and `ListViewRuntimeProps`), so
    // the search is bounded to the interface rather than run over the file —
    // the unbounded-versus-mis-bounded read is what produced the original error.
    const [start, end] = objectGridSchemaSpan();
    expect(start, 'ObjectGridSchema is gone from objectql.ts').toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const declarations = indicesWhere(typesLines, (t) => t.startsWith('onNavigate?:'))
      .filter((i) => i > start && i < end);
    expect(
      declarations.length,
      'ObjectGridSchema no longer declares `onNavigate` exactly once. If it was REMOVED, that is'
        + ' option A — a breaking public type change the 2026-08-19 ruling declined to take in the'
        + ' launch window, so it needs its own ruling, not a tidy-up.',
    ).toBe(1);
  });

  it('…and does NOT declare the nine siblings, which is the contrast the note draws', () => {
    // The type note and both docs pages say the nine live only on
    // `ObjectGridComponentProps`. Measured here so the claim cannot go stale
    // under them: a tenth callback arriving on the schema would make the note
    // false while every other assertion in this file stayed green.
    const [start, end] = objectGridSchemaSpan();
    const declaredInSpan = new Set(
      typesLines
        .slice(start, end)
        .map((l) => l.trim().match(/^([A-Za-z_$][\w$]*)\??\s*:/)?.[1])
        .filter(Boolean) as string[],
    );
    // Non-vacuity: the scan found the interface's members at all.
    expect(declaredInSpan.size).toBeGreaterThan(20);
    expect(declaredInSpan.has('onNavigate')).toBe(true);
    for (const sibling of NINE_SIBLINGS) {
      expect(
        declaredInSpan.has(sibling),
        `\`${sibling}\` is now declared on ObjectGridSchema. The programmatic-only note on`
          + ' `onNavigate` and the README both say the nine live ONLY on'
          + ' `ObjectGridComponentProps` — one of them is now wrong.',
      ).toBe(false);
    }
  });

  it('the renderer still reads it — the half a reader of "non-author surface" would delete', async () => {
    // Behavioural, not textual: the schema-supplied callback must still reach
    // `useNavigationOverlay` and fire on a row click in the default `page`
    // mode. Deleting the read is the one move that makes a programmatic
    // caller's grid quietly stop navigating.
    const onNavigate = vi.fn();
    const { container } = renderGrid({ id: 'nav-read', navigation: { mode: 'page' }, onNavigate });
    await settled();
    const cell = Array.from(container.querySelectorAll('tbody td')).find(
      (td) => td.textContent?.trim() === 'Alice',
    );
    expect(cell, 'the fixture row never rendered, so a silent no-call would look like a pass').toBeTruthy();
    (cell as HTMLElement).click();
    await waitFor(() =>
      expect(
        onNavigate,
        'the schema-supplied `onNavigate` no longer fires on a row click — the read at the'
          + ' `useNavigationOverlay` call was dropped.',
      ).toHaveBeenCalled(),
    );
    expect(onNavigate.mock.calls[0][0]).toBe('1');
  });
});

describe('`onNavigate` — the exemption is DOCUMENTED, which is what this card delivered (objectui#5234)', () => {
  it('the read site in ObjectGrid.tsx carries the exemption comment', () => {
    // Anchored on the read line, which exists in both states of the world, so a
    // red here means the COMMENT went missing — never that the anchor moved.
    // Re-aimed by objectui#9547: the read became `onNavigate ?? schema.onNavigate`
    // (the component prop first, the schema key as its fallback — ruling C on
    // that card), and `onNavigateProp-9547.test.tsx` pins that precedence.
    const reads = indicesWhere(gridLines, (t) => t === 'onNavigate: onNavigate ?? schema.onNavigate,');
    expect(
      reads.length,
      'the `onNavigate: onNavigate ?? schema.onNavigate` read is gone or duplicated; re-aim this'
        + ' pin before trusting anything else in this describe.',
    ).toBe(1);

    const block = commentBlockAbove(gridLines, reads[0]);
    expect(block.length, 'the read site carries no comment at all').toBeGreaterThan(0);
    for (const phrase of [
      'NON-AUTHOR SURFACE',
      '`onNavigate`',
      '`GRID_QUERY_INPUTS`',
      'FUNCTION VALUE',
      'SERIALISABLE DOCUMENT',
      '`ObjectGridComponentProps`',
      'objectui#5234',
      'gridNonAuthorKeys.test.tsx',
    ]) {
      expect(
        block,
        `the exemption comment at the \`onNavigate\` read site no longer states ${phrase}.`
          + ' The 2026-08-19 ruling on objectui#5234 chose option C precisely because the key stays'
          + ' and the EXCEPTION is stated; without this comment the ruling left nothing behind.',
      ).toContain(phrase);
    }
  });

  it('the declaration in objectql.ts carries the programmatic-only note', () => {
    const [start, end] = objectGridSchemaSpan();
    const declarations = indicesWhere(typesLines, (t) => t.startsWith('onNavigate?:'))
      .filter((i) => i > start && i < end);
    expect(declarations.length).toBe(1);

    const block = commentBlockAbove(typesLines, declarations[0]);
    expect(block.length, 'the declaration carries no doc comment at all').toBeGreaterThan(0);
    for (const phrase of [
      'PROGRAMMATIC ONLY',
      'GRID_QUERY_INPUTS',
      'FUNCTION VALUE',
      'SERIALISABLE DOCUMENT',
      'ObjectGridComponentProps',
      'objectui#5234',
    ]) {
      expect(
        block,
        `the programmatic-only note on \`ObjectGridSchema.onNavigate\` no longer states ${phrase}.`
          + ' The 2026-08-19 ruling required it on the declaration itself, because an agent that'
          + ' reads the type and finds a documented callback concludes callbacks are authorable.',
      ).toContain(phrase);
    }
  });

  it('and the four keys ruled in objectui#5091 still carry theirs — this extension weakened nothing', () => {
    // The control for the two cases above: they assert "a comment is present",
    // which would also pass if this file had quietly stopped being able to see
    // comments at all. The four older exemptions are the independent witness.
    const gridSource = gridLines.join('\n');
    for (const { key } of NON_AUTHOR_KEYS) {
      expect(
        gridSource,
        `the objectui#5091 exemption comment for \`${key}\` is gone from ObjectGrid.tsx.`,
      ).toContain(`NON-AUTHOR SURFACE — \`${key}\``);
    }
  });
});
