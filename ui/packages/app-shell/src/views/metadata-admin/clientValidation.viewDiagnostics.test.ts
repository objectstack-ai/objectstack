// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field-level diagnostics on the `view` EDIT path (objectui#3606).
 *
 * The edit gate is `ViewMetadataSchema` = `z.preprocess(strip, z.union([…]))`
 * (objectstack#5316 / objectui#3607). Zod reports a union failure as ONE root
 * issue — `path: []`, `message: 'Invalid input'` — with every member's real
 * diagnostics buried in `issue.errors`. Mapping that root issue literally
 * collapsed the whole edit path to a single un-addressable "Invalid input":
 * `SchemaForm` highlights by `path`, Monaco locates by `path`, and the guided
 * messages the spec wrote for these rejections (#4001) never reached the user.
 *
 * Two things are being pinned here, and they are different kinds of claim:
 *
 *  - CANARY — the union member selected by the draft's own discriminant
 *    produces THESE exact paths and messages. The selection indexes members
 *    positionally, which couples to a spec-internal detail; these assertions
 *    are what makes a reorder / insertion / removal of a `ViewMetadataSchema`
 *    union member fail loudly instead of silently mis-selecting.
 *  - PARITY — the verdict (`ok`) is byte-identical to what the un-expanded
 *    mapping produced. The expansion runs strictly inside the issue→form-issue
 *    mapping, downstream of `ok`; only presentation moves. Note this half
 *    CANNOT be red-before-green-after — it was green before the change and must
 *    stay green. That is the point of it.
 */

import { describe, it, expect } from 'vitest';
import { validateMetadataDraft } from './clientValidation';

const EDIT = { mode: 'edit' } as const;

/** A stored ViewItem: what `createBuildBody` emits plus the pin the view switcher wrote. */
const STORED_ITEM: Record<string, unknown> = {
  name: 'crm_lead.all_leads',
  object: 'crm_lead',
  viewKind: 'list',
  label: 'All Leads',
  isPinned: true,
  config: {
    type: 'grid',
    columns: [],
    data: { provider: 'object', object: 'crm_lead' },
  },
};

/** A record that was never expanded into ViewItems. */
const CONTAINER: Record<string, unknown> = {
  name: 'crm_lead',
  label: 'Lead views',
  object: 'crm_lead',
  list: { type: 'grid', columns: ['name'] },
};

describe('view edit path — union diagnostics are expanded to the selected member (objectui#3606)', () => {
  // ── CANARY ───────────────────────────────────────────────────────────────
  // Exact path + message of the member the discriminant selects. If the spec
  // reorders `ViewMetadataSchema`'s union, the positional index in
  // `clientValidation.ts` selects a different member and these go red.

  it('CANARY: a stored ViewItem with a bad layout type reports `config.type`, not a bare root issue', async () => {
    const res = await validateMetadataDraft(
      'view',
      { ...STORED_ITEM, config: { type: 'not_a_real_layout', columns: [] } },
      undefined,
      EDIT,
    );
    expect(res.ok).toBe(false);
    // Before #3606 this was the single issue `{ path: '', message: 'Invalid input' }`.
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].path).toBe('config.type');
    expect(res.issues[0].message).toContain('Invalid option');
    expect(res.issues[0].message).toContain('"grid"');
  });

  it('CANARY: a stored container with an unknown key reports the spec-authored guidance', async () => {
    const res = await validateMetadataDraft(
      'view',
      { ...CONTAINER, notAContainerKey: true },
      undefined,
      EDIT,
    );
    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    // The container member reports `unrecognized_keys` AT the object it applies
    // to, so the root path is correct here — the message is what was lost.
    expect(res.issues[0].path).toBe('');
    expect(res.issues[0].message).toContain('Unrecognized key(s) on this view container');
    expect(res.issues[0].message).toContain('notAContainerKey');
  });

  it('CANARY: a container key that belongs to a single view recovers the full `defineView` guidance', async () => {
    // #3606's report quoted the container rejection as ending in
    // "Wrap it: defineView({...})". Measured, that clause is not part of the
    // generic message above — it is a PER-KEY hint the spec attaches only to
    // keys that belong to a single view rather than to the container
    // (`type` / `columns` / `data` / `viewKind` / `filters` / `sort`). This is
    // the richest message the collapse was destroying, so it gets its own pin.
    const res = await validateMetadataDraft('view', { ...CONTAINER, columns: ['name'] }, undefined, EDIT);
    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].message).toContain('belongs to a single VIEW, not to the container');
    expect(res.issues[0].message).toContain('Wrap it: `defineView(');
    expect(res.issues[0].message).toContain("The container's own keys are");
  });

  it('CANARY: a missing required field on a stored ViewItem is addressed to that field', async () => {
    const draft = { ...STORED_ITEM };
    delete draft.name;
    const res = await validateMetadataDraft('view', draft, undefined, EDIT);
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toEqual(['name']);
    expect(res.issues[0].message).toContain('expected string');
  });

  it('CANARY: a bad nested filter operator keeps its full array path', async () => {
    const res = await validateMetadataDraft(
      'view',
      {
        ...STORED_ITEM,
        config: {
          ...(STORED_ITEM.config as Record<string, unknown>),
          filter: [{ field: 'status', operator: 'not_an_operator', value: 'open' }],
        },
      },
      undefined,
      EDIT,
    );
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toEqual(['config.filter.0.operator']);
    expect(res.issues[0].message).toContain('Invalid option');
  });

  // ── Noise control ────────────────────────────────────────────────────────

  it('shows ONLY the selected member — never the other members’ rejections', async () => {
    // All four members reject this body. The three we did not select say things
    // like "this is not a view container" / "expected undefined, received
    // object", which would be pure noise to someone editing a ViewItem.
    const res = await validateMetadataDraft(
      'view',
      { ...STORED_ITEM, config: { type: 'not_a_real_layout', columns: [] } },
      undefined,
      EDIT,
    );
    const messages = res.issues.map((i) => i.message).join('\n');
    // Positive anchor FIRST: without it the negatives below pass vacuously
    // against the collapsed "Invalid input", which contains no forbidden
    // substring either — green because nothing is produced, not because the
    // selection is right.
    expect(messages).toContain('Invalid option');
    expect(messages).not.toContain('view container');
    expect(messages).not.toContain('expected undefined');
  });

  it('selects by the draft’s discriminant, not by "fewest issues / deepest path"', async () => {
    // The heuristic picks wrong here, measurably: for this container the
    // ViewItem member reports a DEEPER path (`viewKind`, discriminator
    // mismatch) than the container member's root `unrecognized_keys` — and it
    // is the wrong message. The discriminant has no `viewKind`, so the
    // container member is selected regardless of group shape.
    const res = await validateMetadataDraft(
      'view',
      { ...CONTAINER, notAContainerKey: true },
      undefined,
      EDIT,
    );
    const messages = res.issues.map((i) => i.message).join('\n');
    // Positive anchor first, same reason as above.
    expect(messages).toContain('Unrecognized key(s) on this view container');
    expect(messages).not.toContain('Invalid discriminator value');
  });

  // ── Fallbacks: never lose a diagnostic ───────────────────────────────────

  it('a rejected draft always renders at least one issue', async () => {
    // Includes the residual case: `config.columns` fails a union that is nested
    // BELOW the root, which this change deliberately does not expand (a nested
    // member issue's path is relative to its own node, and there is no
    // documented discriminant down there). It still carries a real path, so it
    // is addressable — which the root case was not.
    const bodies: unknown[] = [
      { ...STORED_ITEM, config: { type: 'not_a_real_layout', columns: [] } },
      { ...STORED_ITEM, viewKind: 'not_a_kind' },
      {
        ...STORED_ITEM,
        config: { ...(STORED_ITEM.config as Record<string, unknown>), columns: [{ field: 123 }] },
      },
      { ...CONTAINER, notAContainerKey: true },
      'not even an object',
      null,
    ];
    for (const body of bodies) {
      const res = await validateMetadataDraft('view', body, undefined, EDIT);
      expect(res.ok, JSON.stringify(body)).toBe(false);
      expect(res.issues.length, JSON.stringify(body)).toBeGreaterThan(0);
    }
  });

  it('leaves non-union failures exactly as they were', async () => {
    // `page` has a plain object schema — no ROOT union, so the mapping is
    // untouched. The draft carries a valid `label`: see the pin below for why
    // that is now load-bearing rather than incidental.
    const res = await validateMetadataDraft('page', { name: 'page_x', label: 'Page X', type: 42 });
    expect(res.ok).toBe(false);
    expect(res.issues.length).toBeGreaterThan(0);
    expect(res.issues.every((i) => i.message !== 'Invalid input')).toBe(true);
    // The specific message is what "exactly as they were" means here.
    expect(res.issues.some((i) => /Invalid option/.test(i.message))).toBe(true);
  });

  /**
   * A LEAF union still reports `Invalid input`, and rc.6 created leaf unions
   * where there were none — recorded here rather than fixed (objectui#4163).
   *
   * objectui#3606's expansion is about a ROOT union: it picks the member the
   * draft was aiming at so the author reads that member's diagnostics instead of
   * zod's aggregate `Invalid input`. It does not, and was never asked to, reach
   * a union nested at a FIELD.
   *
   * That distinction cost nothing until now because the fields in question were
   * scalars. @objectstack/spec 17.0.0-rc.6 widened `I18nLabel` from `string` to
   * `string | Record< string, string >`, so every `label` in the vocabulary
   * became a leaf union — and an author who simply OMITS a required label now
   * reads `Invalid input` where they used to read a typed message naming the
   * field. It is a small regression, it is upstream in origin, and repairing it
   * means teaching the mapper about leaf unions, which is a diagnostics design
   * change rather than a bump repair.
   *
   * Pinned so the gap is measured rather than remembered: when the mapper learns
   * leaf unions, this test goes red and should be deleted along with the note.
   */
  it('a leaf union (rc.6 `I18nLabel`) still yields the bare `Invalid input` — objectui#4163', async () => {
    const res = await validateMetadataDraft('page', { name: 'page_x', type: 'record' });
    expect(res.ok).toBe(false);
    const labelIssue = res.issues.find((i) => /(^|\.)label$/.test(String(i.path ?? '')));
    expect(labelIssue, 'expected a diagnostic on `label`').toBeTruthy();
    expect(labelIssue!.message).toBe('Invalid input');
  });
});

/**
 * The CREATE path is judged by the authoring gates (`ViewItemSchema` /
 * `ViewSchema`), neither of which is a root union — so the expansion is a
 * structural no-op there. Pinned with exact values rather than argued.
 */
describe('view create path — unchanged by objectui#3606', () => {
  it('reports the same field-level issue it always did', async () => {
    const res = await validateMetadataDraft('view', {
      name: 'crm_lead.all_leads',
      object: 'crm_lead',
      viewKind: 'list',
      label: 'All Leads',
      config: { type: 'not_a_real_layout', columns: [] },
    });
    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].path).toBe('config.type');
    expect(res.issues[0].message).toContain('Invalid option');
  });

  it('still rejects platform-written keys on the authoring surface', async () => {
    const res = await validateMetadataDraft('view', STORED_ITEM);
    expect(res.ok).toBe(false);
    expect(res.issues.length).toBeGreaterThan(0);
  });
});

/**
 * PARITY — the verdict is decided by ONE gate and this change did not touch it.
 *
 * Read this as the anti-regression half of the pair above: whatever the
 * diagnostics now say, `ok` for every shape × mode is what `ViewMetadataSchema`
 * (edit) and the authoring gates (create) already decided. A `try both, pass if
 * either passes` fallback — the thing #3606 explicitly is NOT — would show up
 * here as an expectation flipping to `true`.
 */
describe('view verdict parity — presentation moved, judgement did not (objectui#3606)', () => {
  const CASES: Array<{ label: string; body: unknown; edit: boolean; create: boolean }> = [
    { label: 'clean stored ViewItem (pinned)', body: STORED_ITEM, edit: true, create: false },
    {
      label: 'stored ViewItem with nested console row ids',
      body: {
        ...STORED_ITEM,
        sortOrder: 3,
        config: {
          ...(STORED_ITEM.config as Record<string, unknown>),
          filter: [{ field: 'status', operator: 'equals', value: 'open', id: 'row-1' }],
        },
      },
      edit: true,
      create: false,
    },
    { label: 'aggregated container', body: CONTAINER, edit: true, create: true },
    {
      label: 'ViewItem with a bad layout type',
      body: { ...STORED_ITEM, config: { type: 'not_a_real_layout', columns: [] } },
      edit: false,
      create: false,
    },
    {
      label: 'container with an unknown key',
      body: { ...CONTAINER, notAContainerKey: true },
      edit: false,
      create: false,
    },
    { label: 'ViewItem with an unknown viewKind', body: { ...STORED_ITEM, viewKind: 'nope' }, edit: false, create: false },
    { label: 'not an object at all', body: 'nope', edit: false, create: false },
  ];

  for (const c of CASES) {
    it(`${c.label}: edit=${c.edit ? 'ok' : 'not ok'}, create=${c.create ? 'ok' : 'not ok'}`, async () => {
      const edited = await validateMetadataDraft('view', c.body, undefined, EDIT);
      const created = await validateMetadataDraft('view', c.body, undefined, { mode: 'create' });
      expect(edited.ok, `edit: ${JSON.stringify(edited.issues)}`).toBe(c.edit);
      expect(created.ok, `create: ${JSON.stringify(created.issues)}`).toBe(c.create);
      // ok and issues stay consistent in both directions.
      expect(edited.issues.length === 0).toBe(c.edit);
      expect(created.issues.length === 0).toBe(c.create);
    });
  }
});

/**
 * ── NESTED union diagnostics: `config.columns` (objectui#3626) ──
 *
 * #3606 expanded the ROOT union only, and said so: `config.columns` is
 * `string[] | ColumnDef[]` with no discriminant, and it stayed collapsed. It
 * collapsed on BOTH gates, and had done on the create gate since long before
 * #3606 — measured on @objectstack/spec 17.0.0-rc.5, before this change:
 *
 *   create (`ViewItemSchema`)      → path `config.columns`  msg `Invalid input`
 *   edit   (`ViewMetadataSchema`)  → path `config.columns`  msg `Invalid input`
 *
 * The path was real, so the field was reachable; the message said nothing about
 * WHICH column or WHAT was expected. The rule that fixes it selects the union
 * member the value's own first element elects — a fact about what the author
 * wrote, the same class of rule as the root's `viewKind`, and not a ranking of
 * the error groups against each other.
 *
 * Three kinds of claim are pinned below, and they fail for different reasons:
 *
 *  - CANARY — the elected member's exact `path` + `message`. Members are
 *    indexed positionally, so a spec-side reorder of the `columns` union turns
 *    these red instead of quietly reporting the other variant's complaint.
 *  - NARROWING — the unions this rule must NOT speak for. `config.sort`
 *    (`string | ColumnSort[]`) is the live counter-example: drop the guard that
 *    ignores members which rejected the node's type outright, and a bare
 *    first-element test starts answering for it. These pin today's untouched
 *    output, so that regression is loud.
 *  - CONVERGENCE — create and edit report the SAME thing. #3626 was filed on
 *    the observation that PR #3624 made the two gates agree on a bad message;
 *    they have to keep agreeing on the good one.
 */
describe('view nested union — `config.columns` diagnostics (objectui#3626)', () => {
  // `STORED_ITEM` carries `isPinned`, which the AUTHORING gate rejects on
  // purpose (it is Studio state the console writes, pinned by "still rejects
  // platform-written keys on the authoring surface" above). Comparing the two
  // gates issue-for-issue needs a body whose only defect is the one under test,
  // so these cases author it themselves — same record, minus the console's pin.
  const AUTHORABLE_ITEM: Record<string, unknown> = { ...STORED_ITEM };
  delete AUTHORABLE_ITEM.isPinned;

  const withColumns = (columns: unknown) => ({
    ...AUTHORABLE_ITEM,
    config: { ...(AUTHORABLE_ITEM.config as Record<string, unknown>), columns },
  });

  /** Every case here must read identically through both gates. */
  const bothGates = async (body: unknown) => {
    const created = await validateMetadataDraft('view', body, undefined, { mode: 'create' });
    const edited = await validateMetadataDraft('view', body, undefined, EDIT);
    expect(created.ok).toBe(false);
    expect(edited.ok).toBe(false);
    // CONVERGENCE — the create gate reaches this union as a top-level issue,
    // the edit gate reaches it one level down inside the root member it
    // selected. Both compose to the same draft-absolute path.
    expect(edited.issues).toEqual(created.issues);
    return created.issues;
  };

  // ── CANARY ───────────────────────────────────────────────────────────────

  it('CANARY: a mis-typed key on a column object is addressed to that key', async () => {
    // Before: `config.columns` / `Invalid input` (both gates).
    const issues = await bothGates(withColumns([{ field: 123 }]));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('config.columns.0.field');
    expect(issues[0].message).toContain('expected string, received number');
  });

  it('CANARY: a column object missing its required `field` names the missing key', async () => {
    const issues = await bothGates(withColumns([{}]));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('config.columns.0.field');
    expect(issues[0].message).toContain('expected string, received undefined');
  });

  it('CANARY: a stray non-string in a field-NAME list is addressed to that element', async () => {
    // First element is a string, so the author is writing `string[]`; the
    // element that broke it is index 2. The object member's THREE rejections of
    // a shape they never chose are not shown — that is the noise control.
    const issues = await bothGates(withColumns(['a', 'b', 42]));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('config.columns.2');
    expect(issues[0].message).toContain('expected string, received number');
  });

  it('CANARY: a mixed list is judged by the variant its FIRST element elects', async () => {
    // Object first → this is a `ColumnDef[]`, and element 1 is the odd one out.
    const issues = await bothGates(withColumns([{ field: 'a' }, 'b']));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('config.columns.1');
    expect(issues[0].message).toContain('expected object, received string');
  });

  it('CANARY: the same union under the aggregated container reports `list.columns.…`', async () => {
    // The container reaches the identical union by a different route: top-level
    // on create, under root member [1] on edit. Prefix composition is the thing
    // under test — a member issue's path is relative to its own union node.
    const issues = await bothGates({
      ...CONTAINER,
      list: { type: 'grid', columns: [{ field: 123 }] },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('list.columns.0.field');
    expect(issues[0].message).toContain('expected string, received number');
  });

  it('shows ONLY the elected variant — never both members’ complaints', async () => {
    const issues = await bothGates(withColumns(['a', 'b', 42]));
    const messages = issues.map((i) => i.message).join('\n');
    // Positive anchor FIRST — without it the negative below passes vacuously
    // against a collapsed `Invalid input`, which contains no forbidden
    // substring either (the #3606 lesson, same trap).
    expect(messages).toContain('expected string, received number');
    expect(messages).not.toContain('expected object, received string');
  });

  // ── NARROWING: unions this rule must stay out of ─────────────────────────

  it('does NOT answer for `config.sort` — one member never accepted the array', async () => {
    // `sort` is `string | ColumnSort[]`. For `['name']` a bare first-element
    // test would elect the plain-`string` member and report "expected string,
    // received array" — true, and the wrong thing to tell someone who correctly
    // wrote an array. A member that rejected the node's TYPE outright never
    // looked at the contents, so the contents are not evidence for it, and the
    // CONTENT rule is left out of it. Remove that guard and this goes red.
    //
    // RE-PINNED BY #3678, and the claim above is unchanged: what this test
    // guards is that the plain-`string` member is never the one selected. The
    // expected value moved because a DIFFERENT rule — the sole-candidate rule —
    // now speaks here, and it selects the OTHER member, the one that actually
    // read the array. The forbidden mis-selection is asserted directly below so
    // the guard cannot pass vacuously: if #3626's narrowing guard is deleted,
    // the content rule elects `string[]` first and both assertions go red.
    const issues = await bothGates({
      ...AUTHORABLE_ITEM,
      config: { ...(AUTHORABLE_ITEM.config as Record<string, unknown>), sort: ['name'] },
    });
    expect(issues).toEqual([
      { path: 'config.sort.0', message: 'Invalid input: expected object, received string' },
    ]);
    expect(issues.map((i) => i.message).join('\n')).not.toContain(
      'expected string, received array',
    );
  });

  it('does NOT answer for a filter value union (five members, not two)', async () => {
    // The CONTENT rule needs exactly two members, and this union has five, so
    // it still declines — the claim this test was written for.
    //
    // RE-PINNED BY #3678: for an ARRAY value, four of the five members reject
    // the type outright and the array member is the sole candidate, so the
    // sole-candidate rule descends one level to the offending element. It then
    // STOPS: the element's own union (`string | number`) is rejected by every
    // member, nothing distinguishes them, and Zod's message is kept. The result
    // is a nearer path with the same message — `…value.0` rather than `…value`.
    const issues = await bothGates({
      ...AUTHORABLE_ITEM,
      config: {
        ...(AUTHORABLE_ITEM.config as Record<string, unknown>),
        filter: [{ field: 'f', operator: 'in', value: [{}] }],
      },
    });
    expect(issues).toEqual([{ path: 'config.filter.0.value.0', message: 'Invalid input' }]);
  });

  // ── Boundaries: what the content cannot elect ────────────────────────────

  it('an EMPTY `columns` is VALID — the undiscriminable case never arises', async () => {
    // Measured, not assumed: `[]` satisfies BOTH members, so the union succeeds
    // and there is no failure to expand. "What do we show for an empty array"
    // has no answer because it has no question.
    const created = await validateMetadataDraft('view', withColumns([]), undefined, {
      mode: 'create',
    });
    const edited = await validateMetadataDraft('view', withColumns([]), undefined, EDIT);
    expect(created.ok).toBe(true);
    expect(edited.ok).toBe(true);
  });

  it('a first element that elects NEITHER variant keeps the union’s own message', async () => {
    // `42` is neither a field name nor a column object; both members reject it
    // identically. Electing one would be inventing a preference the author
    // never expressed, so this stays exactly as it was — still addressable at
    // `config.columns`, which is what made #3626 milder than #3606.
    expect(await bothGates(withColumns([42]))).toEqual([
      { path: 'config.columns', message: 'Invalid input' },
    ]);
    expect(await bothGates(withColumns([null]))).toEqual([
      { path: 'config.columns', message: 'Invalid input' },
    ]);
  });

  it('a `columns` that is not an array at all keeps the union’s own message', async () => {
    // Both members do agree here ("expected array, received string"), but
    // promoting a message because all members happen to share it is a DIFFERENT
    // mechanism (#3626's direction 1), deliberately not built here.
    expect(await bothGates(withColumns('nope'))).toEqual([
      { path: 'config.columns', message: 'Invalid input' },
    ]);
  });

  it('stops at the next union down, but addressed to it rather than to `columns`', async () => {
    // `columns[0].summary` is `enum | {type, field}` — an OBJECT value, so the
    // array rule declines it and it keeps Zod's message. That is the descent
    // bound: not a depth counter, but a rule that has nothing to say here.
    // Before this change the whole thing collapsed to `config.columns`.
    const issues = await bothGates(withColumns([{ field: 'a', summary: { type: 'bogus' } }]));
    expect(issues).toEqual([{ path: 'config.columns.0.summary', message: 'Invalid input' }]);
  });
});

/**
 * PARITY, nested layer — same claim as the block above, same reason it is green
 * in both directions: the expansion runs inside the issue→form-issue mapping,
 * downstream of `ok`. Listed separately because these bodies are the ones
 * #3626 moves, so they are the ones worth re-pinning.
 */
describe('view verdict parity — `columns` bodies (objectui#3626)', () => {
  const withColumns = (columns: unknown) => ({
    ...STORED_ITEM,
    config: { ...(STORED_ITEM.config as Record<string, unknown>), columns },
  });

  const CASES: Array<{ label: string; body: unknown; ok: boolean }> = [
    { label: 'empty columns', body: withColumns([]), ok: true },
    { label: 'field-name list', body: withColumns(['name', 'amount']), ok: true },
    { label: 'column-def list', body: withColumns([{ field: 'name' }]), ok: true },
    { label: 'column def with a bad key type', body: withColumns([{ field: 123 }]), ok: false },
    { label: 'field-name list with a stray number', body: withColumns(['a', 42]), ok: false },
    { label: 'mixed list', body: withColumns([{ field: 'a' }, 'b']), ok: false },
    { label: 'columns elected by nothing', body: withColumns([42]), ok: false },
    { label: 'columns not an array', body: withColumns('nope'), ok: false },
  ];

  for (const c of CASES) {
    it(`${c.label}: edit=${c.ok ? 'ok' : 'not ok'}`, async () => {
      const edited = await validateMetadataDraft('view', c.body, undefined, EDIT);
      expect(edited.ok, `edit: ${JSON.stringify(edited.issues)}`).toBe(c.ok);
      expect(edited.issues.length === 0).toBe(c.ok);
    });
  }
});

/**
 * ── NESTED union diagnostics: the SOLE-CANDIDATE rule (objectui#3678) ──
 *
 * #3626 narrowed its content rule so it could not speak for `config.sort`, and
 * said what that left behind: when a union's members are censused by the
 * categorical test — did this member reject the value's TYPE at the node
 * itself, without ever reading it? — and EXACTLY ONE member is left standing,
 * naming that member is not a guess. It is the only member that read the value,
 * so it is the only one whose complaint can be about what the author wrote.
 *
 * Measured before implementing, on @objectstack/spec 17.0.0-rc.5:
 *
 *   sort: [{field:'n', order:'bogus'}]  member[0] `string`        rejected the type
 *                                       member[1] `ColumnSort[]`  [0].order Invalid option
 *
 * so the diagnostic that reached the user was `config.sort` / `Invalid input`
 * while the spec's own guided message sat one level down, unread.
 *
 * ── How this rule relates to #3626's content rule ────────────────────────────
 *
 * They are DISJOINT, not layered, and the dispatch for #3678 asked for that to
 * be measured rather than asserted. Let `k` be how many members accepted the
 * value's type. `k` partitions every nested union:
 *
 *   k === 1                → #3678 names the sole candidate.
 *   k === members.length   → every member read the value, so the value's own
 *                            CONTENT decides (#3626), which further declines
 *                            unless the union is `array<A> | array<B>`.
 *   otherwise              → no rule; the union keeps Zod's message.
 *
 * `k === 1` and `k === members.length` can only coincide at a one-member union,
 * which this schema does not produce — and #3626's rule requires exactly two
 * members anyway. The census below walks every nested-union shape the `view`
 * family produces and pins that no shape lands in two cells, so there is no
 * priority question to answer.
 *
 * Three kinds of claim are pinned here:
 *
 *  - CANARY — the sole candidate's exact `path` + `message`. This rule does not
 *    index members positionally, so a reorder cannot hurt it; what CAN hurt it
 *    is a spec change to the member SET (a third `sort` member that also accepts
 *    arrays would take `k` from 1 to 2 and collapse the node back). These turn
 *    red on that instead of quietly reverting to `Invalid input`.
 *  - DISJOINTNESS — the two rules never both select, asserted over the census.
 *  - MAINTAINED — the cells where this rule must stay silent (`k === 0`, and
 *    `k >= 2` where the content rule declines) still read exactly as #3626 left
 *    them.
 */
describe('view nested union — the sole-candidate rule (objectui#3678)', () => {
  const AUTHORABLE_ITEM: Record<string, unknown> = { ...STORED_ITEM };
  delete AUTHORABLE_ITEM.isPinned;

  const withConfig = (extra: Record<string, unknown>) => ({
    ...AUTHORABLE_ITEM,
    config: { ...(AUTHORABLE_ITEM.config as Record<string, unknown>), ...extra },
  });

  /** Every case here must read identically through both gates. */
  const bothGates = async (body: unknown) => {
    const created = await validateMetadataDraft('view', body, undefined, { mode: 'create' });
    const edited = await validateMetadataDraft('view', body, undefined, EDIT);
    expect(created.ok).toBe(false);
    expect(edited.ok).toBe(false);
    expect(edited.issues).toEqual(created.issues);
    return created.issues;
  };

  // ── CANARY ───────────────────────────────────────────────────────────────
  //
  // ⚠️ Since `@objectstack/spec` 17.5.0, `view.sort` is NOT a union any more:
  // the bare-string arm retired (objectui#11073 re-measured it — a plain
  // `z.array` whose own `error` map answers a string with the retirement
  // prescription). The three sort canaries below still pin what an author SEES,
  // which did not move; they no longer exercise the sole-candidate rule, whose
  // evidence is now the census's union rows (`columns`, `summary`,
  // `filter[].value`).

  it('CANARY: a bad `order` on a sort row reports the key and the allowed options', async () => {
    // THE case #3678 was filed on. Before: `config.sort` / `Invalid input`.
    const issues = await bothGates(withConfig({ sort: [{ field: 'n', order: 'bogus' }] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('config.sort.0.order');
    expect(issues[0].message).toContain('Invalid option');
    expect(issues[0].message).toContain('"asc"');
    expect(issues[0].message).toContain('"desc"');
  });

  it('CANARY: a non-object element in a sort list is addressed to that element', async () => {
    // The `string` member rejected the array outright, so `ColumnSort[]` is the
    // sole candidate and index 0 is where it broke. Measured, against the
    // dispatch's guess that BOTH members would reject `[42]`: they do not — the
    // array member accepts the type and complains about the element.
    const issues = await bothGates(withConfig({ sort: [42] }));
    expect(issues).toEqual([
      { path: 'config.sort.0', message: 'Invalid input: expected object, received number' },
    ]);
  });

  it('CANARY: every issue of the sole candidate is shown, and only that member’s', async () => {
    // `sort: [{}]` is missing `field` AND has no valid `order`. Both belong to
    // the selected member; the rejected member's "expected string, received
    // array" is not among them.
    const issues = await bothGates(withConfig({ sort: [{}] }));
    expect(issues.map((i) => i.path)).toEqual(['config.sort.0.field', 'config.sort.0.order']);
    const messages = issues.map((i) => i.message).join('\n');
    // Positive anchor FIRST — a collapsed `Invalid input` contains no forbidden
    // substring either, so the negative alone would pass vacuously (#3606's
    // lesson, and #3626 hit the same trap).
    expect(messages).toContain('expected string, received undefined');
    expect(messages).not.toContain('expected string, received array');
  });

  it('CANARY: the same union under the aggregated container reports `list.sort.…`', async () => {
    // Prefix composition on the other route: top-level on create, one level
    // down inside the selected root member on edit.
    const issues = await bothGates({
      ...CONTAINER,
      list: { type: 'grid', columns: ['name'], sort: [{ field: 'n', order: 'bogus' }] },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('list.sort.0.order');
    expect(issues[0].message).toContain('Invalid option');
  });

  it('CANARY: a scalar union member left standing names the options it wanted', async () => {
    // `columns[0].summary` is `enum | {type, field}`. Handed a STRING the object
    // member rejects the type, leaving the enum as sole candidate — so the path
    // is unchanged and the MESSAGE stops being `Invalid input`. (Handed an
    // OBJECT, k is 2 and this stays collapsed — pinned in the #3626 block.)
    const issues = await bothGates(withConfig({ columns: [{ field: 'a', summary: 'bogus' }] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('config.columns.0.summary');
    expect(issues[0].message).toContain('Invalid option');
    expect(issues[0].message).toContain('"count"');
  });

  it('descends more than one level when each level has a sole candidate', async () => {
    // `sections[].fields[]` is `string | FormField`. This is the reach #3678's
    // own scope paragraph did not expect: it read this union as rejecting
    // wholesale, which it does for a scalar element but not for an object one.
    const issues = await bothGates({
      ...AUTHORABLE_ITEM,
      viewKind: 'form',
      config: { type: 'simple', sections: [{ fields: [{}] }] },
    });
    expect(issues).toEqual([
      {
        path: 'config.sections.0.fields.0.field',
        message: 'Invalid input: expected string, received undefined',
      },
    ]);
  });

  // ── MAINTAINED: the cells this rule must stay out of ─────────────────────

  it('k === 0 — every member rejected the type, so the collapse is kept', async () => {
    // `columns: 'nope'` is an array under neither member. Nothing distinguishes
    // the members, and #3626 already ruled that inventing a preference is not
    // ours. (This row used `sort: 42` until `view.sort` stopped being a union
    // at `@objectstack/spec` 17.5.0; objectui#11073.)
    expect(await bothGates(withConfig({ columns: 'nope' }))).toEqual([
      { path: 'config.columns', message: 'Invalid input' },
    ]);
  });

  it('k >= 2 — two members read the value, so this rule stays silent', async () => {
    // `columns: [42]` — BOTH members accepted the array type, so there is no
    // sole candidate; the content rule then declines because `42` elects
    // neither variant, and the node keeps its own message. This is the
    // uniqueness requirement doing its job: drop it and take "the first member
    // that accepted" instead, and this reports `config.columns.0` /
    // "expected string, received number" — a preference nobody expressed.
    expect(await bothGates(withConfig({ columns: [42] }))).toEqual([
      { path: 'config.columns', message: 'Invalid input' },
    ]);
  });

  it('every nested union shape lands in exactly ONE rule’s cell — census', async () => {
    // The `k` partition is an argument about the code; this is the measurement
    // that stands behind it. For each shape: the nested union under test
    // (`unionAt`), where the diagnostic actually lands (`reportedAt`), and which
    // cell that implies.
    //
    // The cells are observable from outside, but NOT — as this test first
    // assumed and was corrected by running it — through the path alone. A rule
    // that spoke shows up as a nearer path OR as a named message, and each can
    // happen without the other:
    //
    //   selected member's issue is DEEPER  → path moves   (`sort` → `…sort.0.order`
    //                                        through 17.4.0; `filter[].value` now)
    //   selected member's issue is AT the  → path stays, message stops being
    //     union node (a scalar member)       `Invalid input` (`summary: 'bogus'`)
    //   descent ends in a `none` cell      → path moves, message stays
    //     one level further down             (`filter[].value: [{}]`)
    //
    // So the honest test of "did a rule speak" is the disjunction, and `none`
    // is exactly its negation: the address is still the union node AND the
    // message is still the node's own `Invalid input`.
    //
    // What makes this a disjointness measurement rather than a list: the two
    // rules would collide only if a k=2 union were also selected as a sole
    // candidate. The `columns` rows are the k=2 population — three of them, two
    // where the content rule speaks and one where nothing does — and none of
    // them reports the "first member that accepted" address (`config.columns.0`
    // / "expected string, received number" for `[42]`) that a collision would
    // produce. The `k >= 2` test above pins that single case directly.
    const CENSUS: Array<{
      label: string;
      body: unknown;
      unionAt: string;
      reportedAt: string;
      cell: 'sole' | 'content' | 'none';
      collapsedMessage: boolean;
    }> = [
      // The four `sort` rows that opened this census left it at `@objectstack/spec`
      // 17.5.0, when `view.sort` stopped being a union (objectui#11073): a plain
      // array reports at its natural path with no rule speaking, so keeping them
      // would read "a rule spoke" off a path no rule chose.
      { label: 'columns: bad key type', body: withConfig({ columns: [{ field: 123 }] }), unionAt: 'config.columns', reportedAt: 'config.columns.0.field', cell: 'content', collapsedMessage: false },
      { label: 'columns: stray element', body: withConfig({ columns: ['a', 42] }), unionAt: 'config.columns', reportedAt: 'config.columns.1', cell: 'content', collapsedMessage: false },
      { label: 'columns: elected by nothing', body: withConfig({ columns: [42] }), unionAt: 'config.columns', reportedAt: 'config.columns', cell: 'none', collapsedMessage: true },
      { label: 'columns: not an array', body: withConfig({ columns: 'nope' }), unionAt: 'config.columns', reportedAt: 'config.columns', cell: 'none', collapsedMessage: true },
      { label: 'summary: a bad enum string', body: withConfig({ columns: [{ field: 'a', summary: 'bogus' }] }), unionAt: 'config.columns.0.summary', reportedAt: 'config.columns.0.summary', cell: 'sole', collapsedMessage: false },
      { label: 'summary: an object', body: withConfig({ columns: [{ field: 'a', summary: { type: 'bogus' } }] }), unionAt: 'config.columns.0.summary', reportedAt: 'config.columns.0.summary', cell: 'none', collapsedMessage: true },
      { label: 'filter value: an array', body: withConfig({ filter: [{ field: 'f', operator: 'in', value: [{}] }] }), unionAt: 'config.filter.0.value', reportedAt: 'config.filter.0.value.0', cell: 'sole', collapsedMessage: true },
      { label: 'filter value: an object', body: withConfig({ filter: [{ field: 'f', operator: 'equals', value: {} }] }), unionAt: 'config.filter.0.value', reportedAt: 'config.filter.0.value', cell: 'none', collapsedMessage: true },
    ];
    for (const c of CENSUS) {
      const issues = await bothGates(c.body);
      expect(issues.map((i) => i.path), c.label).toEqual([c.reportedAt]);
      expect(issues[0].message === 'Invalid input', c.label).toBe(c.collapsedMessage);
      // The address never leaves the union node's subtree, whatever spoke.
      expect(
        c.reportedAt === c.unionAt || c.reportedAt.startsWith(`${c.unionAt}.`),
        c.label,
      ).toBe(true);
      const spoke = c.reportedAt !== c.unionAt || issues[0].message !== 'Invalid input';
      expect(spoke, c.label).toBe(c.cell !== 'none');
    }
  });

  it('a rule speaking is NOT the same as the message improving — both directions', async () => {
    // Two rows of the census move in only one of the two observables each, and
    // asserting the wrong one is how a pin passes for a reason that is not the
    // reason it claims. Written out so the next reader does not re-derive it.

    // Path moves, message does NOT. The sole-candidate rule named the element
    // that broke the list, but the element's own union is rejected by every
    // member, so the descent ends in a `none` cell and `Invalid input` is all
    // there is left to show.
    expect(
      await bothGates(withConfig({ filter: [{ field: 'f', operator: 'in', value: [{}] }] })),
    ).toEqual([{ path: 'config.filter.0.value.0', message: 'Invalid input' }]);

    // Message moves, path does NOT. The sole candidate is the ENUM member,
    // whose issue sits AT the union node, so the address is unchanged and the
    // entire gain is that the user is told which options exist.
    const summary = await bothGates(withConfig({ columns: [{ field: 'a', summary: 'bogus' }] }));
    expect(summary.map((i) => i.path)).toEqual(['config.columns.0.summary']);
    expect(summary[0].message).not.toBe('Invalid input');
    expect(summary[0].message).toContain('Invalid option');
  });
});

/**
 * PARITY, sole-candidate layer — the verdict cannot move, for the structural
 * reason #3606 and #3626 already pinned: the expansion runs inside the
 * issue→form-issue mapping, downstream of `ok`. Green before this change and
 * green after; that is the point of it, not a weakness of it.
 */
describe('view verdict parity — sole-candidate bodies (objectui#3678)', () => {
  const withConfig = (extra: Record<string, unknown>) => ({
    ...STORED_ITEM,
    config: { ...(STORED_ITEM.config as Record<string, unknown>), ...extra },
  });

  const CASES: Array<{ label: string; body: unknown; ok: boolean }> = [
    // `ok: true` through `@objectstack/spec` 17.4.0; 17.5.0 retired the bare
    // string clause and refuses it with its prescription (objectui#11073).
    { label: 'sort as a field name', body: withConfig({ sort: 'name' }), ok: false },
    { label: 'sort as an empty array', body: withConfig({ sort: [] }), ok: true },
    { label: 'sort as column sorts', body: withConfig({ sort: [{ field: 'n', order: 'asc' }] }), ok: true },
    { label: 'sort with a bad order', body: withConfig({ sort: [{ field: 'n', order: 'bogus' }] }), ok: false },
    { label: 'sort of field names', body: withConfig({ sort: ['name'] }), ok: false },
    { label: 'sort of numbers', body: withConfig({ sort: [42] }), ok: false },
    { label: 'sort as a number', body: withConfig({ sort: 42 }), ok: false },
    { label: 'summary as a bad enum', body: withConfig({ columns: [{ field: 'a', summary: 'bogus' }] }), ok: false },
  ];

  for (const c of CASES) {
    it(`${c.label}: edit=${c.ok ? 'ok' : 'not ok'}`, async () => {
      const edited = await validateMetadataDraft('view', c.body, undefined, EDIT);
      expect(edited.ok, `edit: ${JSON.stringify(edited.issues)}`).toBe(c.ok);
      expect(edited.issues.length === 0).toBe(c.ok);
    });
  }
});

/**
 * ── What `invalid_value` at a member's own root means (objectui#3694) ──
 *
 * The categorical test both nested rules stand on counts only `invalid_type`.
 * #3694 asked whether that is the rule's meaning or an implementation detail:
 * Zod answers `invalid_value` whenever an ENUM or a LITERAL rejects, whatever
 * the input's type, so an enum member handed an object is counted as a
 * candidate even though it never looked inside either.
 *
 * Measured over 51 shapes, the whole `view` family produces `invalid_value` at
 * a member's own root at exactly TWO union sites — `columns[].summary`
 * (`enum | {type, field}`) and `sections[].columns` (`enum | 1 | 2 | 3 | 4`) —
 * and re-qualifying it is a TRADE on the first of them, not an improvement:
 * the object-valued shapes gain a named `…summary.type`, the scalar-valued
 * shapes lose the enum's option list and collapse to `Invalid input`. #3694
 * therefore changed no behaviour. This block is the measurement made durable.
 *
 * These pins are green today and are meant to STAY green — they are the
 * regression half, not the red-before/green-after half. Their job is that the
 * next attempt to widen the predicate goes red on the shapes it would damage.
 * Verified by perturbation, results in the PR body: widening to
 * `invalid_type || invalid_value` reddens 4 tests, and the type-aware variant
 * reddens 2 — and WITHOUT this block four of the damaged shapes
 * (`summary: 42 | true | null | ['count']`) were pinned nowhere at all.
 *
 * Pinning the currently-collapsed shapes too is deliberate and is NOT an
 * endorsement of the collapse: it is what makes adopting any future relaxation
 * a visible, deliberate replacement of these expectations rather than a quiet
 * drift. The contract-first fix stays spec-side (objectstack#6391).
 */
describe('view nested union — the `invalid_value` qualification, measured (objectui#3694)', () => {
  const AUTHORABLE_ITEM: Record<string, unknown> = { ...STORED_ITEM };
  delete AUTHORABLE_ITEM.isPinned;

  const withConfig = (extra: Record<string, unknown>) => ({
    ...AUTHORABLE_ITEM,
    config: { ...(AUTHORABLE_ITEM.config as Record<string, unknown>), ...extra },
  });
  const withSummary = (summary: unknown) => withConfig({ columns: [{ field: 'a', summary }] });

  const bothGates = async (body: unknown) => {
    const created = await validateMetadataDraft('view', body, undefined, { mode: 'create' });
    const edited = await validateMetadataDraft('view', body, undefined, EDIT);
    expect(created.ok).toBe(false);
    expect(edited.ok).toBe(false);
    expect(edited.issues).toEqual(created.issues);
    return created.issues;
  };

  // ── The shapes a widened predicate would SILENCE ─────────────────────────

  it('an enum member left standing survives every non-enum value, not just a string', async () => {
    // `summary: 'bogus'` — the one shape #3678 pinned — is not special. For a
    // number, a boolean, `null` and an array alike the OBJECT member answers
    // `invalid_type` at its own root while the ENUM answers `invalid_value`, so
    // k stays 1 and the enum's option list is what the author is shown.
    //
    // Count `invalid_value` as a node-level rejection and every one of these
    // goes to k=0 and collapses. Four of them are pinned in no other test, so
    // this assertion is the only thing standing between that change and four
    // silent regressions.
    for (const value of [42, true, null, [], ['count'], [{ type: 'count' }]]) {
      const label = JSON.stringify(value);
      const issues = await bothGates(withSummary(value));
      expect(issues.map((i) => i.path), label).toEqual(['config.columns.0.summary']);
      // Positive anchor FIRST: a collapsed `Invalid input` satisfies no
      // `toContain`, so the negative alone would pass vacuously.
      expect(issues[0].message, label).toContain('Invalid option');
      expect(issues[0].message, label).toContain('"count_unique"');
      expect(issues[0].message, label).not.toBe('Invalid input');
    }
  });

  it('the same holds on the container and `listViews` routes', async () => {
    // Prefix composition is a different route on each gate; the census must not
    // be route-dependent.
    const viaContainer = await bothGates({
      ...CONTAINER,
      list: { type: 'grid', columns: [{ field: 'a', summary: 42 }] },
    });
    expect(viaContainer.map((i) => i.path)).toEqual(['list.columns.0.summary']);
    expect(viaContainer[0].message).toContain('Invalid option');

    const viaListViews = await bothGates({
      ...CONTAINER,
      listViews: { v1: { type: 'grid', columns: [{ field: 'a', summary: 'bogus' }] } },
    });
    expect(viaListViews.map((i) => i.path)).toEqual(['listViews.v1.columns.0.summary']);
    expect(viaListViews[0].message).toContain('Invalid option');
  });

  // ── The shapes a widened predicate would IMPROVE (pinned as they stand) ──

  it('an OBJECT summary keeps TWO candidates, so the node stays collapsed', async () => {
    // These are the shapes #3694 was filed on and the ones any relaxation
    // would gain: the enum answers `invalid_value` at the root (counted as a
    // candidate) and the object member reports at `['type']`, so k=2 and no
    // cell claims the node. `{type:'bogus'}` is already pinned by #3626's
    // descent-boundary test; the other two were pinned nowhere.
    for (const value of [{}, { type: 'bogus', field: 'x' }]) {
      const label = JSON.stringify(value);
      expect(await bothGates(withSummary(value)), label).toEqual([
        { path: 'config.columns.0.summary', message: 'Invalid input' },
      ]);
    }
  });

  it('the object-summary collapse is the same on the container and `listViews` routes', async () => {
    expect(
      await bothGates({
        ...CONTAINER,
        list: { type: 'grid', columns: [{ field: 'a', summary: { type: 'bogus' } }] },
      }),
    ).toEqual([{ path: 'list.columns.0.summary', message: 'Invalid input' }]);

    expect(
      await bothGates({
        ...CONTAINER,
        listViews: { v1: { type: 'grid', columns: [{ field: 'a', summary: { type: 'bogus' } }] } },
      }),
    ).toEqual([{ path: 'listViews.v1.columns.0.summary', message: 'Invalid input' }]);
  });

  // ── The OTHER `invalid_value` site, and why it never moves ───────────────

  it('`sections[].columns` — all five members answer `invalid_value`, and no cell claims it either way', async () => {
    // `enum('1'|'2'|'3'|'4') | 1 | 2 | 3 | 4`. Every member rejects the value
    // as a whole, so today k=5 (the content rule's cell, which declines a
    // five-member union) and under a widened predicate k=0 (the empty cell).
    // Different cell, same silence — which is why the second `invalid_value`
    // site contributes nothing to the trade above. Measured, not assumed.
    for (const value of ['bogus', 7, {}, null]) {
      const label = JSON.stringify(value);
      expect(
        await bothGates({
          ...AUTHORABLE_ITEM,
          viewKind: 'form',
          config: { type: 'simple', sections: [{ fields: ['a'], columns: value }] },
        }),
        label,
      ).toEqual([{ path: 'config.sections.0.columns', message: 'Invalid input' }]);
    }
  });

  // ── The content rule cannot be reached by this question ──────────────────

  it('the CONTENT rule’s reach cannot move — its one candidate shape still declines', async () => {
    // #3694 worried that re-qualifying the shared predicate would move BOTH
    // rules. Measured: it cannot. The content rule needs exactly two members
    // AND a non-empty array value, and `summary: ['count']` is the only shape
    // in the family meeting both at an `invalid_value` site. There the OBJECT
    // member answers `invalid_type`, so the narrowing guard is already true and
    // a widened predicate can only keep it true. The node is answered by the
    // sole-candidate rule (the enum), never by the content rule — which would
    // have reported the OBJECT member's "expected object, received array".
    const issues = await bothGates(withSummary(['count']));
    expect(issues.map((i) => i.path)).toEqual(['config.columns.0.summary']);
    expect(issues[0].message).toContain('Invalid option');
    expect(issues.map((i) => i.message).join('\n')).not.toContain('received array');
  });
});

/**
 * PARITY, #3694 layer. #3694 changed no behaviour at all, so this is doubly a
 * regression pin — but the bodies above are new to this file and the verdict
 * they produce is worth stating outright rather than leaving implied.
 */
describe('view verdict parity — `invalid_value` bodies (objectui#3694)', () => {
  const withSummary = (summary: unknown) => ({
    ...STORED_ITEM,
    config: {
      ...(STORED_ITEM.config as Record<string, unknown>),
      columns: [{ field: 'a', summary }],
    },
  });

  const CASES: Array<{ label: string; body: unknown; ok: boolean }> = [
    { label: 'summary as a valid enum', body: withSummary('count'), ok: true },
    { label: 'summary as a valid object', body: withSummary({ type: 'sum' }), ok: true },
    { label: 'summary as a number', body: withSummary(42), ok: false },
    { label: 'summary as a boolean', body: withSummary(true), ok: false },
    { label: 'summary as null', body: withSummary(null), ok: false },
    { label: 'summary as an array', body: withSummary(['count']), ok: false },
    { label: 'summary as an empty object', body: withSummary({}), ok: false },
    { label: 'summary as an object with a bad type', body: withSummary({ type: 'bogus', field: 'x' }), ok: false },
  ];

  for (const c of CASES) {
    it(`${c.label}: edit=${c.ok ? 'ok' : 'not ok'}`, async () => {
      const edited = await validateMetadataDraft('view', c.body, undefined, EDIT);
      expect(edited.ok, `edit: ${JSON.stringify(edited.issues)}`).toBe(c.ok);
      expect(edited.issues.length === 0).toBe(c.ok);
    });
  }
});

/**
 * ── Cross-field refusal: offering `'calendar'` requires a `calendar:` block
 *    (objectui#7122, @objectstack/spec 17.3.0) ──
 *
 * 17.3.0 added a cross-field rule to the list-view contract: if
 * `appearance.allowedVisualizations` contains `'calendar'`, the view must
 * declare `calendar: { startDateField }`. There is no truthful fallback — a
 * date the renderer guesses puts every record lacking that field on "today".
 * The same release made `calendar.titleField` OPTIONAL (the title falls back to
 * the ADR-0079 record display name), leaving `startDateField` as the block's
 * one required key. Both halves are pinned below.
 *
 * ⚠️ WHY HERE, and not in `packages/types`' spec-parity suites, which is where
 * objectui#7122's own text proposed it. Measured: those mirrors CANNOT carry a
 * spec refinement, ever. `ListViewSchema` there is built from
 * `specFieldsExcept(SpecListViewSchema.shape, …)`, and `specFieldsExcept` is
 * `z.object(kept).partial()` over the spec shape's ENTRIES — a brand-new object
 * schema. The spec's refinement is not omitted, it is STRUCTURALLY UNREACHABLE,
 * and the mirror accepts the refused body below cleanly. A pin there would
 * assert a property of the SPEC's schema while sitting in a suite whose
 * documented remit is objectui-vs-spec KEY drift. This gate imports the refined
 * doors themselves (`clientValidation.ts`'s `view` entry: `ViewMetadataSchema`
 * on edit, `ViewItemSchema` / `ViewSchema` on create), so what is pinned here is
 * a refusal a Console author actually meets. Ruled by the PM on this card.
 *
 * ⚠️ MESSAGE COUPLING, deliberate — as every CANARY in this file is. Only the
 * message's FIRST clause is asserted, the part that names the rule; never the
 * whole string, so the spec stays free to reword its guidance. The owner of the
 * coupling is `@objectstack/spec`'s list-view refinement (objectstack#14075,
 * `Fixes objectstack#13817`). If it is reworded, this pin is what tells
 * objectui — re-measure the clause, ⛔ never delete the assertion.
 *
 * ⚠️ BOTH DOORS carry a body, and that is not redundancy: create and edit are
 * judged by DIFFERENT schemas (`viewSchemaForDraft`'s authoring pair vs the
 * `ViewMetadataSchema` union), so a green on one says nothing about the other.
 * Measured, the refusal's path follows the BODY's own nesting rather than the
 * door: a ViewItem draft answers `config.calendar` on both, a container answers
 * `list.calendar` on both, and a flattened list-view overlay answers a bare
 * `calendar` (edit only — the authoring gate refuses that shape outright).
 *
 * ⚠️ This refusal does NOT travel through the union expansion the rest of this
 * file pins. Measured: it arrives as ONE issue already addressed to the right
 * path, i.e. the spec addresses it itself and the mapping leaves it alone (the
 * `leaves non-union failures exactly as they were` cell above). Stated so a
 * later reader does not take a green here as evidence about the expansion.
 */
describe('view cross-field refusal — a calendar visualization needs a calendar block (objectui#7122)', () => {
  /** What an author writes in the Console: a ViewItem carrying no platform-written keys. */
  const AUTHORED_ITEM = (config: Record<string, unknown>) => ({
    name: 'crm_lead.all_leads',
    object: 'crm_lead',
    viewKind: 'list',
    label: 'All Leads',
    config,
  });
  const LIST_CONFIG = { type: 'grid', columns: ['name'], data: { provider: 'object', object: 'crm_lead' } };
  const OFFERS_CALENDAR = { allowedVisualizations: ['grid', 'calendar'] };

  /** The clause that NAMES the rule. Everything after it is guidance prose, deliberately not asserted. */
  const RULE_CLAUSE = "`appearance.allowedVisualizations` includes 'calendar'";

  // ── CANARY ───────────────────────────────────────────────────────────────

  it('CANARY: a ViewItem offering calendar with no `calendar:` block is refused AT `config.calendar` on the EDIT door', async () => {
    const res = await validateMetadataDraft(
      'view',
      AUTHORED_ITEM({ ...LIST_CONFIG, appearance: OFFERS_CALENDAR }),
      undefined,
      EDIT,
    );
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toEqual(['config.calendar']);
    expect(res.issues[0].message).toContain(RULE_CLAUSE);
  });

  it('CANARY: the same body is refused AT `config.calendar` on the CREATE door — a different schema, the same answer', async () => {
    const res = await validateMetadataDraft('view', AUTHORED_ITEM({ ...LIST_CONFIG, appearance: OFFERS_CALENDAR }));
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toEqual(['config.calendar']);
    expect(res.issues[0].message).toContain(RULE_CLAUSE);
  });

  it('CANARY: an aggregated container is refused AT `list.calendar` on BOTH doors', async () => {
    const body = {
      ...CONTAINER,
      list: { type: 'grid', columns: ['name'], appearance: OFFERS_CALENDAR },
    };
    const edited = await validateMetadataDraft('view', body, undefined, EDIT);
    const created = await validateMetadataDraft('view', body, undefined, { mode: 'create' });
    for (const res of [edited, created]) {
      expect(res.ok).toBe(false);
      expect(res.issues.map((i) => i.path)).toEqual(['list.calendar']);
      expect(res.issues[0].message).toContain(RULE_CLAUSE);
    }
  });

  it('CANARY: a flattened list-view overlay is refused AT a bare `calendar` — the third door, edit only', async () => {
    // The overlay is a stored/wire shape, so only the edit gate accepts it at
    // all: the authoring gate refuses it for reasons that have nothing to do
    // with this rule (no `config`, `columns` unrecognized). Asserting create
    // here would pin those unrelated refusals, so it is deliberately not done.
    const overlay = { name: 'crm_lead.all_leads', object: 'crm_lead', viewKind: 'list', columns: ['name'] };
    const clean = await validateMetadataDraft('view', overlay, undefined, EDIT);
    expect(clean.ok, `overlay must parse clean first: ${JSON.stringify(clean.issues)}`).toBe(true);

    const res = await validateMetadataDraft('view', { ...overlay, appearance: OFFERS_CALENDAR }, undefined, EDIT);
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toEqual(['calendar']);
    expect(res.issues[0].message).toContain(RULE_CLAUSE);
  });

  it('CANARY: an EMPTY `calendar:` block is a different refusal — `startDateField` is the block’s one required key', async () => {
    // This is what makes the path in the canaries above mean something: the
    // cross-field rule answers AT the block, the block's own required key
    // answers one level deeper. It is also objectui#7122's item 1, pinned at
    // the door objectui opens: 17.3.0 made `titleField` optional, so
    // `startDateField` is the only key whose absence is reported here.
    const res = await validateMetadataDraft(
      'view',
      AUTHORED_ITEM({ ...LIST_CONFIG, appearance: OFFERS_CALENDAR, calendar: {} }),
      undefined,
      EDIT,
    );
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toEqual(['config.calendar.startDateField']);
    expect(res.issues[0].message).toContain('expected string');
  });

  // ── Control legs: what this rule must NOT refuse ──────────────────────────
  // A refusal without these is not a reading — they are what shows the gate is
  // `allowedVisualizations`, not the mere presence of `appearance` or of a
  // `calendar:` block. All four must stay clean on BOTH doors.

  const CLEAN_LEGS: Array<{ label: string; config: Record<string, unknown> }> = [
    { label: '`appearance` present but empty', config: { ...LIST_CONFIG, appearance: {} } },
    {
      label: "`allowedVisualizations` offers only 'grid'",
      config: { ...LIST_CONFIG, appearance: { allowedVisualizations: ['grid'] } },
    },
    {
      label: 'a `calendar:` block with NO `allowedVisualizations` at all',
      config: { ...LIST_CONFIG, calendar: { startDateField: 'due_on' } },
    },
    {
      label: "'calendar' offered AND declared — `startDateField` only, NO `titleField` (17.3.0 made it optional)",
      config: { ...LIST_CONFIG, appearance: OFFERS_CALENDAR, calendar: { startDateField: 'due_on' } },
    },
  ];

  for (const leg of CLEAN_LEGS) {
    it(`clean on both doors: ${leg.label}`, async () => {
      const body = AUTHORED_ITEM(leg.config);
      const edited = await validateMetadataDraft('view', body, undefined, EDIT);
      const created = await validateMetadataDraft('view', body, undefined, { mode: 'create' });
      expect(edited.ok, `edit: ${JSON.stringify(edited.issues)}`).toBe(true);
      expect(created.ok, `create: ${JSON.stringify(created.issues)}`).toBe(true);
    });
  }
});
