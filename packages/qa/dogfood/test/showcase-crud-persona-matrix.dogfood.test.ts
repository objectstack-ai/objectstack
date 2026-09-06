// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `access-security.crud-permission-matrix` — the PERSONA × CRUD-CELL half (#9481).
//
// `objectstack verify` proves object-level CRUD and cross-owner RLS, and the
// item's `automated.ref` says outright that the persona-grained cells remain
// manual. This file drives them: for every `showcase_*` row of the showcase's
// own `access-matrix.json`, one fresh member holding exactly that permission set
// runs all four verbs over the real HTTP surface, and each cell is judged
// against the table.
//
// ── The union, which is the whole trap ───────────────────────────────────────
//
// `access-matrix.json` lists what each set grants ON ITS OWN. Every authenticated
// member ALSO holds the app's everyone-baseline `showcase_member_default`
// additively (ADR-0090 D5), and capability is a UNION — there are no subtraction
// sets. So the expectation for a cell is
//
//     effective(set, object, verb) = row(set)[verb] OR row(member_default)[verb]
//
// and judging a cell against the raw row is simply wrong: it turns 9 correctly
// ALLOWED cells into fabricated violations. `showcase_auditor` is a read-only
// compliance set that nonetheless CAN create an inquiry, because the baseline
// can. The union is computed below and the flipped cells are asserted as
// allowed, which is what pins D5's additivity end-to-end.
//
// ── Why the allow half is not decoration ─────────────────────────────────────
//
// A permission matrix that only asserts denials stays green when everything
// denies — an over-tightening regression is invisible to it. This table is
// deliberately balanced and the balance is CHECKED: `records the verdict of
// every cell` asserts the exact allow/deny split, so narrowing the sweep (or
// letting a persona silently fail to be provisioned) breaks the build instead of
// quietly shrinking what is proven.
//
// ── Why a denial here is a PERMISSION verdict and not a bad payload ──────────
//
// A 403 proves nothing if the request would have failed anyway. Before any
// persona runs, the admin creates every object FROM THE SAME PAYLOAD BUILDER
// (`the admin control`). If a required field moves in the showcase, that control
// goes red naming the object, instead of every persona's denial staying green
// for the wrong reason.
//
// ── What this file deliberately does NOT cover ───────────────────────────────
//
//  • The 6 `showcase_field_ops_delegate` × `sys_*` rows. Their verdicts are not
//    plain cells: the platform's OWN baseline sets grant some of that surface
//    independently of the app's matrix (measured: a member holding no app set
//    beyond the baseline reads `/data/sys_user` 200 — self-scoped — while the
//    matrix lists `sys_user` read only for the delegate), and the delegate's
//    `sys_user_position` writes are decided by the ADR-0090 D12 adminScope
//    subtree gate, which `showcase-permission-zoo.dogfood.test.ts` already pins
//    on both sides. A raw cell verdict for those rows would be a false negative
//    or a false positive depending on the row. They stay manual.
//  • The guest-anchor intake asymmetry (`guest_portal`: create without read).
//    It is NOT observable on a member persona: the everyone baseline grants read
//    on `showcase_inquiry`, so the union says read — and this file asserts the
//    union, because that IS what a member holding the set may do. The asymmetry
//    lives on the unauthenticated guest anchor, a different admission lane.
//
// @proof: showcase-crud-persona-matrix

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;
const HERE = dirname(fileURLToPath(import.meta.url));
// packages/qa/dogfood/test → repo root.
const REPO_ROOT = join(HERE, '../../../..');
const MATRIX_PATH = join(REPO_ROOT, 'examples/app-showcase/access-matrix.json');

type Verb = 'create' | 'read' | 'edit' | 'delete';
const VERBS: Verb[] = ['create', 'read', 'edit', 'delete'];

interface MatrixRow {
  permissionSet: string;
  object: string;
  create: boolean;
  read: boolean;
  edit: boolean;
  delete: boolean;
  viewAllRecords: boolean;
  modifyAllRecords: boolean;
}

const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf8')) as { version: number; entries: MatrixRow[] };
/** The app's everyone-baseline rows, keyed by object — the union's other half. */
const BASELINE_SET = 'showcase_member_default';
const baselineByObject = new Map(
  matrix.entries.filter((e) => e.permissionSet === BASELINE_SET).map((e) => [e.object, e]),
);
/** Business-object rows only — see the header for why the `sys_*` rows are out. */
const ROWS = matrix.entries.filter((e) => e.object.startsWith('showcase_'));

const effective = (row: MatrixRow, verb: Verb): boolean =>
  Boolean(row[verb]) || Boolean(baselineByObject.get(row.object)?.[verb]);

/** The `sys_*` rows this file does not judge — named so the exclusion is visible. */
const UNJUDGED_ROWS = matrix.entries.filter((e) => !e.object.startsWith('showcase_'));

/**
 * Marker field per object: what a created row is findable by afterwards.
 *
 * ⚠️ NOT every object has one. `showcase_project_membership` is a pure
 * junction — two required master-detail parents, a select and a percent, with
 * no free-text column to stamp a mark into — so it is deliberately absent here
 * and the one place that reads this map (the denied-CREATE absence probe)
 * asserts the entry exists before using it. Today no matrix row denies create
 * on that object, so the probe never runs for it; when one arrives, the sweep
 * fails RED naming the object instead of querying `where: { undefined: … }`
 * and passing vacuously.
 */
const MARKER: Record<string, string> = {
  showcase_account: 'name',
  showcase_announcement: 'title',
  showcase_business_unit: 'name',
  showcase_cascade: 'name',
  showcase_category: 'name',
  // [#9308 fixture 2] The share-link object. It enters this sweep because the
  // matrix gained a `showcase_client_liaison × showcase_client_brief` row, and
  // the sweep is DERIVED from the matrix — a new granted object arrives here
  // automatically, which is the design. Only the fixture maps grow; not one
  // assertion below changes.
  showcase_client_brief: 'title',
  showcase_contact: 'name',
  showcase_expense_line: 'merchant',
  showcase_expense_report: 'name',
  showcase_field_zoo: 'name',
  showcase_inquiry: 'name',
  showcase_invoice: 'name',
  showcase_invoice_line: 'description',
  showcase_preference: 'name',
  showcase_private_note: 'title',
  showcase_product: 'name',
  showcase_project: 'name',
  showcase_task: 'title',
  showcase_team: 'name',
};

interface PayloadCtx {
  mark: string;
  email: string;
  accountId: string;
  productId: string;
  projectId: string;
  /** The invoice a line should hang off — the caller's OWN where they have one. */
  invoiceId: string;
  /**
   * The expense report an expense line hangs off, and the team a project
   * membership joins. Both are seeded rows and both stay seeded rows for
   * EVERY persona — unlike `invoiceId`, which has to be the caller's own.
   * The difference is record-level and worth naming: `showcase_invoice`
   * carries an owner-scoped RLS rule, whereas `showcase_expense_report` and
   * `showcase_team` are `public_read_write`, so a persona reaches the seeded
   * parent exactly as well as one it made itself. (`showcase_expense_line` is
   * `controlled_by_parent`, so its record scope is the report's — also open.)
   */
  expenseReportId: string;
  teamId: string;
}

/**
 * Minimal VALID create payloads. Required fields are named explicitly rather
 * than derived, so a showcase change that adds one fails the admin control with
 * the object's name instead of degrading a persona's cell into a silent 400.
 *
 * `owner` is set to the acting persona on the two objects that carry an owner
 * TEXT column, because `showcase_contributor`'s RLS selects invoices by
 * `owner == current_user.email`: a row created without it would be invisible to
 * its own creator, and the contributor's EDIT cell would fail for a record-level
 * reason while looking like a CRUD denial.
 */
const PAYLOAD: Record<string, (c: PayloadCtx) => Record<string, unknown>> = {
  showcase_account: (c) => ({ name: c.mark, status: 'prospect' }),
  showcase_announcement: (c) => ({ title: c.mark }),
  showcase_business_unit: (c) => ({ name: c.mark }),
  // `country` / `province` / `tier` are all left unset. The B3 fixture's
  // narrowing lives on one OPTION (`tier: 'restricted'`, admin-only) and the
  // objectql rule-validator judges SUBMITTED values, so a payload that submits
  // none of them cannot turn a CRUD verdict into an `invalid_option` 400 — the
  // exact confusion the admin control exists to prevent.
  showcase_cascade: (c) => ({ name: c.mark }),
  showcase_category: (c) => ({ name: c.mark }),
  // `status` is left at its `draft` default on purpose: this sweep judges CRUD
  // bits, and a brief that is not `published` cannot be mint-eligible for a
  // share link — so a row this sweep leaves behind can never become an
  // accidental share-link fixture for another file.
  showcase_client_brief: (c) => ({ title: c.mark, project: c.projectId }),
  showcase_contact: (c) => ({ name: c.mark, email: `contact-${Date.now()}@probe.test` }),
  showcase_expense_line: (c) => ({
    expense_report: c.expenseReportId,
    merchant: c.mark,
    amount: 12.5,
    status: 'submitted',
  }),
  // `status: 'draft'` is load-bearing, not filler. Both expense approval flows
  // (`showcase_expense_signoff`, `showcase_committee_quorum`) start on
  // `record-after-update` with `status == "submitted" && previous.status !=
  // "submitted"` and approve with `lockRecord: true`. A row this sweep creates
  // as `draft`, and only ever PATCHes on its `name` marker, can never launch
  // one — so a persona's EDIT/DELETE cell can never come back as a record lock
  // wearing a permission verdict's clothes.
  showcase_expense_report: (c) => ({ name: c.mark, status: 'draft' }),
  // `f_master_detail` is the zoo's required master (a project). Everything else
  // in the zoo is optional by design — it is a catalogue of field types, not a
  // form with a required core.
  showcase_field_zoo: (c) => ({ name: c.mark, f_master_detail: c.projectId }),
  showcase_inquiry: (c) => ({ name: c.mark, email: `inq-${Date.now()}@probe.test`, message: 'matrix probe' }),
  showcase_invoice: (c) => ({ name: c.mark, account: c.accountId, status: 'draft', owner: c.email }),
  showcase_invoice_line: (c) => ({ invoice: c.invoiceId, product: c.productId, quantity: 1, description: c.mark }),
  showcase_preference: (c) => ({ name: c.mark }),
  showcase_private_note: (c) => ({ title: c.mark }),
  showcase_product: (c) => ({ name: c.mark, sku: `SKU-${Date.now()}` }),
  showcase_project: (c) => ({ name: c.mark, account: c.accountId, status: 'planned', owner: c.email }),
  // The team↔project junction: BOTH master-detail parents are required, and
  // neither is unique-constrained (the seed dedupes on the pair by `mode:
  // 'ignore'`, not by an index), so re-joining an already-joined pair is a
  // legal write rather than a 409 masquerading as a CRUD verdict.
  showcase_project_membership: (c) => ({ team: c.teamId, project: c.projectId, engagement: 'owner' }),
  showcase_task: (c) => ({ title: c.mark, project: c.projectId, status: 'todo' }),
  showcase_team: (c) => ({ name: c.mark }),
};

/**
 * The EDIT probe per object: which field a persona patches, and to what.
 *
 * Every object with a free-text MARKER stamps `<mark>-edited` into it. The
 * junction has no such column (see MARKER), so it names its own pair: a fresh
 * membership is created `engagement: 'owner'` above and the probe moves it to
 * `reviewer` — an unrestricted field, a value the option set accepts, and one
 * that always differs from the created row, which is what makes both the
 * "persisted" and the "changed nothing" assertions below meaningful.
 */
const EDIT_PROBE: Record<string, (mark: string) => { field: string; value: unknown }> = {
  ...Object.fromEntries(
    Object.entries(MARKER).map(([object, field]) => [
      object,
      (mark: string) => ({ field, value: `${mark}-edited` }),
    ]),
  ),
  showcase_project_membership: () => ({ field: 'engagement', value: 'reviewer' }),
};

const OBJECTS = [...new Set(ROWS.map((r) => r.object))].sort();
const SETS = [...new Set(ROWS.map((r) => r.permissionSet))].sort();

const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id;
const rowsOf = (b: any) => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);

interface Cell {
  set: string;
  object: string;
  verb: Verb;
  expected: 'allow' | 'deny';
  /** true when the raw row says false and only the baseline union allows it. */
  baselineFlip: boolean;
  status: number;
  code?: string;
}
const VERDICTS: Cell[] = [];

describe('showcase: persona × CRUD-cell matrix (#9481)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  /** persona token / email / own-row ids, keyed by permission set name. */
  const persona = new Map<string, { token: string; email: string; own: Map<string, string> }>();
  /** Admin-created foreign probe row per object. */
  const foreign = new Map<string, string>();
  const seed = {
    accountId: '',
    productId: '',
    projectId: '',
    invoiceId: '',
    expenseReportId: '',
    teamId: '',
  };

  const ctxFor = (email: string, mark: string, invoiceId?: string): PayloadCtx => ({
    mark,
    email,
    accountId: seed.accountId,
    productId: seed.productId,
    projectId: seed.projectId,
    invoiceId: invoiceId || seed.invoiceId,
    expenseReportId: seed.expenseReportId,
    teamId: seed.teamId,
  });

  const bodyOf = async (r: Response) => {
    try {
      return (await r.json()) as any;
    } catch {
      return undefined;
    }
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    const firstId = async (object: string) =>
      String((await ql.find(object, { limit: 1, context: SYS }))?.[0]?.id ?? '');
    seed.accountId = await firstId('showcase_account');
    seed.productId = await firstId('showcase_product');
    seed.projectId = await firstId('showcase_project');
    seed.invoiceId = await firstId('showcase_invoice');
    seed.expenseReportId = await firstId('showcase_expense_report');
    seed.teamId = await firstId('showcase_team');
    expect(
      seed.accountId &&
        seed.productId &&
        seed.projectId &&
        seed.invoiceId &&
        seed.expenseReportId &&
        seed.teamId,
      'the showcase seed provides the lookup parents every payload needs',
    ).toBeTruthy();

    // Personas. `showcase_member_default` is the baseline itself — that persona
    // is a plain sign-up holding no extra grant, which is exactly the shape the
    // matrix row describes.
    for (const set of SETS) {
      const email = `crudmx-${set.replace(/^showcase_/, '')}@verify.test`;
      const token = await stack.signUp(email);
      if (set !== BASELINE_SET) {
        const ps = await ql.findOne('sys_permission_set', { where: { name: set }, context: SYS });
        expect(ps?.id, `permission set ${set} seeded by the security bootstrap`).toBeTruthy();
        const uid = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
        expect(uid, `persona ${email} provisioned`).toBeTruthy();
        await ql.insert(
          'sys_user_permission_set',
          { user_id: uid, permission_set_id: ps.id },
          { context: SYS },
        );
      }
      persona.set(set, { token, email, own: new Map() });
    }

    // Admin FOREIGN probe rows — the edit/delete target for personas that may
    // not create, and simultaneously the payload control (see header).
    for (const object of OBJECTS) {
      const mark = `MX-admin-${object}`;
      const r = await stack.apiAs(adminTok, 'POST', `/data/${object}`, PAYLOAD[object](ctxFor('admin@objectos.ai', mark)));
      const body = await bodyOf(r);
      expect(
        r.status,
        `admin control: the ${object} payload is VALID (a persona 403 must be a permission verdict, not a 400 in disguise) — got ${JSON.stringify(body)}`,
      ).toBeLessThan(300);
      foreign.set(object, String(idOf(body)));
      expect(foreign.get(object), `admin probe row id for ${object}`).toBeTruthy();
    }
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  // ── The sweep ────────────────────────────────────────────────────────────
  for (const row of ROWS) {
    const label = `${row.permissionSet} × ${row.object}`;
    it(`${label}: all four verbs answer the matrix (baseline-unioned)`, async () => {
      const p = persona.get(row.permissionSet)!;
      const record = (verb: Verb, status: number, code?: string) => {
        VERDICTS.push({
          set: row.permissionSet,
          object: row.object,
          verb,
          expected: effective(row, verb) ? 'allow' : 'deny',
          baselineFlip: !row[verb] && effective(row, verb),
          status,
          code,
        });
      };
      const why = (verb: Verb) =>
        `${label} ${verb}: row=${row[verb]} baseline=${Boolean(baselineByObject.get(row.object)?.[verb])} ⇒ effective=${effective(row, verb)}`;

      // ── CREATE ──────────────────────────────────────────────────────────
      const mark = `MX-${row.permissionSet}-${row.object}`;
      const createBody = PAYLOAD[row.object](ctxFor(p.email, mark, p.own.get('showcase_invoice')));
      const created = await stack.apiAs(p.token, 'POST', `/data/${row.object}`, createBody);
      const createdJson = await bodyOf(created);
      record('create', created.status, createdJson?.code);
      if (effective(row, 'create')) {
        expect(created.status, `${why('create')} — got ${JSON.stringify(createdJson)}`).toBeLessThan(300);
        const newId = String(idOf(createdJson));
        expect(newId, `${label}: the allowed create returns an id`).toBeTruthy();
        p.own.set(row.object, newId);
        // The effect persists (clause 0's value oracle, not the status alone).
        const stored = await ql.findOne(row.object, { where: { id: newId }, context: SYS });
        expect(stored, `${label}: the created row is really there`).toBeTruthy();
      } else {
        expect(created.status, why('create')).toBe(403);
        expect(createdJson?.code, `${label}: the ledgered denial code`).toBe('PERMISSION_DENIED');
        // Clause 2 — a denied CREATE leaves NO row behind. Proving an ABSENCE
        // needs a field to look the row up by; without one the query below
        // would find nothing for the wrong reason and pass vacuously.
        const marker = MARKER[row.object];
        expect(
          marker,
          `${label}: proving a denied create left nothing needs a MARKER field for ${row.object}`,
        ).toBeTruthy();
        const left = await ql.find(row.object, {
          where: { [marker]: mark },
          context: SYS,
        });
        expect(left?.length ?? 0, `${label}: the denied create persisted nothing`).toBe(0);
      }

      // ── READ (list) ─────────────────────────────────────────────────────
      const listed = await stack.apiAs(p.token, 'GET', `/data/${row.object}`);
      const listedJson = await bodyOf(listed);
      record('read', listed.status, listedJson?.code);
      if (effective(row, 'read')) {
        expect(listed.status, `${why('read')} — got ${JSON.stringify(listedJson)}`).toBe(200);
        expect(Array.isArray(rowsOf(listedJson)), `${label}: a readable list answers with rows`).toBe(true);
      } else {
        expect(listed.status, why('read')).toBe(403);
        expect(listedJson?.code).toBe('PERMISSION_DENIED');
      }

      // ── EDIT ────────────────────────────────────────────────────────────
      // Own row where the persona could make one; the admin's foreign row
      // otherwise. Either way the target EXISTS, so a refusal cannot be a
      // 404 in disguise.
      const editTarget = p.own.get(row.object) ?? foreign.get(row.object)!;
      const { field: editField, value: editValue } = EDIT_PROBE[row.object](mark);
      const edited = await stack.apiAs(p.token, 'PATCH', `/data/${row.object}/${editTarget}`, {
        [editField]: editValue,
      });
      const editedJson = await bodyOf(edited);
      record('edit', edited.status, editedJson?.code);
      if (effective(row, 'edit')) {
        expect(edited.status, `${why('edit')} — got ${JSON.stringify(editedJson)}`).toBeLessThan(300);
        const after = await ql.findOne(row.object, { where: { id: editTarget }, context: SYS });
        expect(after?.[editField], `${label}: the allowed edit persisted`).toBe(editValue);
      } else {
        expect(edited.status, why('edit')).toBe(403);
        expect(editedJson?.code).toBe('PERMISSION_DENIED');
        const after = await ql.findOne(row.object, { where: { id: editTarget }, context: SYS });
        expect(after?.[editField], `${label}: the denied edit changed nothing`).not.toBe(editValue);
      }

      // ── DELETE ──────────────────────────────────────────────────────────
      // An allowed delete gets a throwaway row of its own so the sweep does not
      // destroy a target a later assertion still needs.
      let deleteTarget = p.own.get(row.object) ?? foreign.get(row.object)!;
      if (effective(row, 'delete') && effective(row, 'create')) {
        const throwaway = await stack.apiAs(
          p.token,
          'POST',
          `/data/${row.object}`,
          PAYLOAD[row.object](ctxFor(p.email, `${mark}-del`, p.own.get('showcase_invoice'))),
        );
        const tid = idOf(await bodyOf(throwaway));
        if (tid) deleteTarget = String(tid);
      }
      const deleted = await stack.apiAs(p.token, 'DELETE', `/data/${row.object}/${deleteTarget}`);
      const deletedJson = await bodyOf(deleted);
      record('delete', deleted.status, deletedJson?.code);
      if (effective(row, 'delete')) {
        expect(deleted.status, `${why('delete')} — got ${JSON.stringify(deletedJson)}`).toBeLessThan(300);
        const gone = await ql.findOne(row.object, { where: { id: deleteTarget }, context: SYS });
        expect(gone ?? null, `${label}: the deleted row is gone`).toBeNull();
      } else {
        expect(deleted.status, why('delete')).toBe(403);
        expect(deletedJson?.code).toBe('PERMISSION_DENIED');
        const still = await ql.findOne(row.object, { where: { id: deleteTarget }, context: SYS });
        expect(still, `${label}: the denied delete left the row standing`).toBeTruthy();
      }
    }, 180_000);
  }

  // ── VAMA, both sides (clause 3) ──────────────────────────────────────────
  it('viewAllRecords: the auditor reads a FOREIGN private note by id AND in lists; a plain member gets it neither way', async () => {
    const auditor = persona.get('showcase_auditor')!;
    const plain = persona.get(BASELINE_SET)!;
    // The plain member's OWN note is foreign to the auditor and vice versa.
    const mark = `MX-vama-${Date.now()}`;
    const mine = await stack.apiAs(plain.token, 'POST', '/data/showcase_private_note', { title: mark });
    const noteId = String(idOf(await bodyOf(mine)));
    expect(noteId, 'the plain member owns a note').toBeTruthy();

    const byId = await stack.apiAs(auditor.token, 'GET', `/data/showcase_private_note/${noteId}`);
    expect(byId.status, 'viewAllRecords reaches the foreign row by id').toBe(200);

    const listed = await stack.apiAs(auditor.token, 'GET', '/data/showcase_private_note');
    const titles = rowsOf(await bodyOf(listed)).map((r: any) => r.title);
    expect(titles, 'and in the LIST — the bypass is not by-id only').toContain(mark);

    // The negative persona: same row, no bit.
    const other = persona.get('showcase_contributor')!;
    const otherById = await stack.apiAs(other.token, 'GET', `/data/showcase_private_note/${noteId}`);
    expect(otherById.status, 'a persona without the bit cannot read it by id').not.toBe(200);
    const otherList = await stack.apiAs(other.token, 'GET', '/data/showcase_private_note');
    const otherTitles = rowsOf(await bodyOf(otherList)).map((r: any) => r.title);
    expect(otherTitles, 'nor see it in a list').not.toContain(mark);
  }, 120_000);

  // ── MAMA, both sides (clause 4) ──────────────────────────────────────────
  it('modifyAllRecords: ops PATCHes a FOREIGN announcement; the same PATCH by a plain member is denied and the row is unchanged', async () => {
    const ops = persona.get('showcase_ops')!;
    const plain = persona.get(BASELINE_SET)!;
    const target = foreign.get('showcase_announcement')!; // admin-owned

    const opsValue = `MX-mama-ops-${Date.now()}`;
    const opsPatch = await stack.apiAs(ops.token, 'PATCH', `/data/showcase_announcement/${target}`, {
      title: opsValue,
    });
    expect(opsPatch.status, 'modifyAllRecords grants the foreign write').toBeLessThan(300);
    const afterOps = await ql.findOne('showcase_announcement', { where: { id: target }, context: SYS });
    expect(afterOps?.title, 'and it persisted').toBe(opsValue);

    const plainValue = `MX-mama-plain-${Date.now()}`;
    const plainPatch = await stack.apiAs(plain.token, 'PATCH', `/data/showcase_announcement/${target}`, {
      title: plainValue,
    });
    expect(plainPatch.status, 'the same write without the bit is refused').toBe(403);
    expect((await bodyOf(plainPatch))?.code).toBe('PERMISSION_DENIED');
    const afterPlain = await ql.findOne('showcase_announcement', { where: { id: target }, context: SYS });
    expect(afterPlain?.title, 'and the row is untouched').toBe(opsValue);
  }, 120_000);

  // ── The verdict table itself (clause 6) ──────────────────────────────────
  //
  // This is the anti-vacuity check. Without it the sweep could shrink — a
  // persona failing to be provisioned, a row quietly filtered out — and every
  // remaining assertion would still pass.
  it('records the verdict of every cell, with both halves non-trivially populated', () => {
    expect(VERDICTS.length, 'one verdict per (set × object × verb)').toBe(ROWS.length * VERBS.length);

    const allow = VERDICTS.filter((c) => c.expected === 'allow');
    const deny = VERDICTS.filter((c) => c.expected === 'deny');
    // A matrix in which everything denies proves nothing about over-tightening,
    // and one in which everything allows proves nothing about enforcement.
    //
    // These two are a CENSUS of the matrix, so they move whenever the matrix
    // legitimately grows — and the arithmetic of each move belongs here, or the
    // next author cannot tell a widened grant from a widened fixture.
    // 50/50 → 54/54 with the two rows #9308 added, both on the new
    // `showcase_client_liaison` set:
    //   • × showcase_client_brief — create/read/edit allow, delete deny  (3/1)
    //   • × showcase_project      — read allow; create/edit/delete deny  (1/3)
    //
    // 54/54 → 87/77 with the fourteen rows #14453 added. That issue closed the
    // gap where nine showcase objects sat in the shared navigation with no
    // permission set granting them at all; granting them is what pulled those
    // objects into this matrix-derived sweep, so the census moves with it
    // (+33 allow, +23 deny):
    //   • showcase_contributor × showcase_expense_line      (3/1)
    //   • showcase_contributor × showcase_expense_report    (3/1)
    //   • showcase_contributor × showcase_field_zoo         (3/1)
    //   • showcase_member_default × showcase_business_unit  (1/3)  read-only
    //   • showcase_member_default × showcase_cascade        (3/1)
    //   • showcase_member_default × showcase_category       (1/3)  read-only
    //   • showcase_member_default × showcase_expense_report (1/3)  read-only
    //   • showcase_member_default × showcase_field_zoo      (1/3)  read-only
    //   • showcase_member_default × showcase_preference     (3/1)
    //   • showcase_member_default × showcase_team           (1/3)  read-only
    //   • showcase_ops × showcase_business_unit             (3/1)
    //   • showcase_ops × showcase_category                  (3/1)
    //   • showcase_ops × showcase_project_membership        (4/0)  the only
    //       row in the whole matrix granting all four bits — `allowDelete` is
    //       what un-staffs a team from a project.
    //   • showcase_ops × showcase_team                      (3/1)
    // No pre-existing cell changed side; `git diff` on access-matrix.json is
    // the check that this is still true. (None of the nine objects carried ANY
    // row before, which is also why the baseline-flip count below is unmoved.)
    expect(allow.length, 'the ALLOW half is what catches an over-tightening regression').toBe(87);
    expect(deny.length, 'the DENY half is what catches a widening regression').toBe(77);

    // Every set and every object of the business-object matrix was really driven.
    expect([...new Set(VERDICTS.map((c) => c.set))].sort()).toEqual(SETS);
    expect([...new Set(VERDICTS.map((c) => c.object))].sort()).toEqual(OBJECTS);

    // Denials are the ledgered code, never an incidental 404/400.
    for (const cell of deny) {
      expect(cell.status, `${cell.set} × ${cell.object} ${cell.verb}`).toBe(403);
      expect(cell.code, `${cell.set} × ${cell.object} ${cell.verb}`).toBe('PERMISSION_DENIED');
    }
    for (const cell of allow) {
      expect(cell.status, `${cell.set} × ${cell.object} ${cell.verb}`).toBeLessThan(300);
    }
  });

  // ── ADR-0090 D5: the additive baseline, pinned as such ───────────────────
  it('the everyone-baseline union is load-bearing: cells the tested set denies are ALLOWED through it', () => {
    const flips = VERDICTS.filter((c) => c.baselineFlip);
    expect(
      flips.length,
      'the showcase really does contain cells whose only grant is the baseline — if this hits 0 the union has stopped mattering and the sweep silently stopped testing it',
    ).toBe(9);
    for (const cell of flips) {
      expect(cell.expected, `${cell.set} × ${cell.object} ${cell.verb} is a baseline flip`).toBe('allow');
      expect(
        cell.status,
        `${cell.set} × ${cell.object} ${cell.verb}: the baseline grant really answers 2xx`,
      ).toBeLessThan(300);
    }
  });

  // ── The exclusion is declared, not silent ────────────────────────────────
  it('names the matrix rows this file does not judge (the sys_* delegate surface)', () => {
    expect(UNJUDGED_ROWS.map((r) => r.object).sort()).toEqual([
      'sys_business_unit',
      'sys_business_unit_member',
      'sys_permission_set',
      'sys_position',
      'sys_user',
      'sys_user_position',
    ]);
    expect(
      [...new Set(UNJUDGED_ROWS.map((r) => r.permissionSet))],
      'they are all one set — if an app set starts granting sys_* surface, this list moves and the exclusion must be re-argued',
    ).toEqual(['showcase_field_ops_delegate']);
    expect(ROWS.length + UNJUDGED_ROWS.length, 'the two partitions cover the whole matrix').toBe(
      matrix.entries.length,
    );
  });
});
