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
// ── What the sweep does not judge as plain cells ─────────────────────────────
//
//  • The 4 `showcase_field_ops_delegate` × `sys_*` rows. Their verdicts are not
//    plain cells: the platform's OWN baseline sets grant some of that surface
//    independently of the app's matrix (measured: a member holding no app set
//    beyond the baseline reads `/data/sys_user` 200 — the organization's
//    directory — while the matrix lists `sys_user` read only for the delegate),
//    `sys_user` exposes no create or delete over the API at all (405 for every
//    caller), and the delegate's `sys_user_position` writes are decided by the
//    ADR-0090 D12 adminScope subtree gate. So the sweep leaves them out and one
//    dedicated case drives all 16 cells with those three facts spelled out
//    (#26571): a delegate holding exactly the set, `sys_user_position` judged on
//    rows the delegate made inside its subtree.
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
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

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

/** The `sys_*` rows the sweep leaves out — named so the exclusion is visible; one dedicated case drives them. */
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
 * reason while looking like a CRUD denial. `assignee` on `showcase_task` is set
 * for the same reason — the same set selects tasks by
 * `assignee == current_user.email` (`task_own_rows`), and the set's policies
 * hold for this persona, which holds the set by a direct grant.
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
  showcase_task: (c) => ({ title: c.mark, project: c.projectId, status: 'todo', assignee: c.email }),
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
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    const firstId = async (object: string) =>
      String((await ql.find(object, { limit: 1, context: SYS }))?.[0]?.id ?? '');
    // [#18682] NOT `firstId`: `showcase_invoice` now carries a real business
    // rule — an invoice may not be issued against a CHURNED account — so an
    // arbitrary first account makes this file's "admin control payload is
    // VALID" assertion depend on seed ordering. The control has to be a payload
    // the platform actually accepts, so the account is chosen to satisfy the
    // rule rather than by position.
    seed.accountId = String(
      (await ql.find('showcase_account', {
        where: { status: { $ne: 'churned' } }, limit: 1, context: SYS,
      }))?.[0]?.id ?? '',
    );
    seed.productId = await firstId('showcase_product');
    seed.projectId = await firstId('showcase_project');
    // NOT `firstId` either, for the same reason as the account: the showcase
    // locks a PAID invoice's lines (its `showcase_guard_paid_invoice_line_*`
    // hooks), so a line can be neither added under one nor removed from one.
    // `firstId` takes whichever invoice a `limit: 1` read returns, and with
    // random ids that is a different invoice on every boot — several seeded
    // invoices are paid, so the admin control below failed on some boots and
    // not others. Every line this file creates under a seeded invoice hangs
    // off this one, so the parent is chosen by the state the lock reads.
    seed.invoiceId = String(
      (await ql.find('showcase_invoice', {
        where: { status: { $ne: 'paid' } }, limit: 1, context: SYS,
      }))?.[0]?.id ?? '',
    );
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
        const ps = await catalogPermissionSet(ql, set);
        expect(ps, `permission set ${set} served by the security catalog`).toBeTruthy();
        const uid = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
        expect(uid, `persona ${email} provisioned`).toBeTruthy();
        await ql.insert(
          'sys_user_permission_set',
          { user_id: uid, permission_set: ps.name },
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

  // ── VAMA on the rest of the auditor's objects (clause 3, #26571) ─────────
  // The private-note case above is one of the four objects the auditor's
  // viewAllRecords names. The other three each hide a foreign row from a
  // persona that HOLDS read but not the bit, by a different mechanism: the
  // private OWD (inquiry), the contributor's owner RLS (invoice) and the
  // master-derived scope (line, controlled_by_parent).
  it('viewAllRecords: the auditor reads a FOREIGN inquiry, invoice and invoice line by id AND in lists; a contributor gets none of them', async () => {
    const auditor = persona.get('showcase_auditor')!;
    const contributor = persona.get('showcase_contributor')!;
    const mark = `MX-vama3-${Date.now()}`;
    const make = async (object: string, body: Record<string, unknown>) => {
      const r = await stack.apiAs(adminTok, 'POST', `/data/${object}`, body);
      const json = await bodyOf(r);
      expect(r.status, `admin creates the foreign ${object} — got ${JSON.stringify(json)}`).toBeLessThan(300);
      return String(idOf(json));
    };
    const inquiry = await make('showcase_inquiry', PAYLOAD.showcase_inquiry(ctxFor('admin@objectos.ai', mark)));
    const invoice = await make('showcase_invoice', PAYLOAD.showcase_invoice(ctxFor('admin@objectos.ai', mark)));
    const line = await make('showcase_invoice_line', PAYLOAD.showcase_invoice_line(ctxFor('admin@objectos.ai', mark, invoice)));

    for (const [object, id] of [
      ['showcase_inquiry', inquiry],
      ['showcase_invoice', invoice],
      ['showcase_invoice_line', line],
    ] as const) {
      const listPath = `/data/${object}?$filter=${encodeURIComponent(JSON.stringify({ id }))}`;
      const byId = await stack.apiAs(auditor.token, 'GET', `/data/${object}/${id}`);
      expect(byId.status, `auditor reads the foreign ${object} by id`).toBe(200);
      const listed = rowsOf(await bodyOf(await stack.apiAs(auditor.token, 'GET', listPath))).map((r: any) => r.id);
      expect(listed, `and in the ${object} list`).toContain(id);

      const otherById = await stack.apiAs(contributor.token, 'GET', `/data/${object}/${id}`);
      expect(otherById.status, `the contributor cannot read the foreign ${object} by id`).toBeGreaterThanOrEqual(300);
      const otherList = await stack.apiAs(contributor.token, 'GET', listPath);
      expect(otherList.status, `the contributor's ${object} list itself is served`).toBe(200);
      expect(rowsOf(await bodyOf(otherList)).map((r: any) => r.id), `nor sees the ${object} in a list`).not.toContain(id);
    }
  }, 120_000);

  // ── Wrong persona, both sides (negative[0], #26571) ──────────────────────
  // One denied cell per permission set, re-run as the admin: a denial that also
  // refuses the admin is a broken route or payload, not the persona's grant.
  it('one denied cell per set succeeds when re-run as the admin', async () => {
    const firstDenied = new Map<string, Cell>();
    for (const cell of VERDICTS) {
      if (cell.expected === 'deny' && !firstDenied.has(cell.set)) firstDenied.set(cell.set, cell);
    }
    const setsWithDenials = [...new Set(VERDICTS.filter((c) => c.expected === 'deny').map((c) => c.set))].sort();
    expect([...firstDenied.keys()].sort(), 'every set that has a denied cell is re-run').toEqual(setsWithDenials);
    expect(setsWithDenials.length, 'the sweep has denials to re-run').toBeGreaterThan(0);

    const adminMake = async (object: string, mark: string) => {
      const r = await stack.apiAs(adminTok, 'POST', `/data/${object}`, PAYLOAD[object](ctxFor('admin@objectos.ai', mark)));
      expect(r.status, `admin seeds a ${object} target`).toBeLessThan(300);
      return String(idOf(await bodyOf(r)));
    };
    for (const cell of firstDenied.values()) {
      const label = `${cell.set} × ${cell.object} ${cell.verb}, re-run as admin`;
      const mark = `MX-n0-${cell.set}-${cell.object}`;
      let r: Response;
      if (cell.verb === 'create') {
        r = await stack.apiAs(adminTok, 'POST', `/data/${cell.object}`, PAYLOAD[cell.object](ctxFor('admin@objectos.ai', mark)));
      } else if (cell.verb === 'read') {
        r = await stack.apiAs(adminTok, 'GET', `/data/${cell.object}`);
      } else if (cell.verb === 'edit') {
        const { field, value } = EDIT_PROBE[cell.object](mark);
        r = await stack.apiAs(adminTok, 'PATCH', `/data/${cell.object}/${await adminMake(cell.object, mark)}`, { [field]: value });
      } else {
        r = await stack.apiAs(adminTok, 'DELETE', `/data/${cell.object}/${await adminMake(cell.object, mark)}`);
      }
      expect(r.status, `${label} — got ${JSON.stringify(await bodyOf(r))}`).toBeLessThan(300);
    }
  }, 180_000);

  // ── The delegate × sys_* rows (clauses 0, 1 and 6, #26571) ───────────────
  // The four rows the sweep above leaves out, driven by a delegate holding
  // exactly `showcase_field_ops_delegate`. Two cells are not permission
  // verdicts at all: sys_user declares no create and no delete over the API, so
  // the API-exposure gate answers 405 for every caller, the admin included.
  // The sys_user_position cells are judged on rows the DELEGATE made, inside
  // its Field Operations subtree: a row another principal made meets the
  // platform's write-ownership floor instead, and an out-of-subtree write the
  // ADR-0090 D12 gate (the permission zoo pins both sides of that gate).
  it('the 16 showcase_field_ops_delegate × sys_* cells answer the matrix', async () => {
    const DELEGATE = 'crudmx-field-ops-delegate@verify.test';
    const TARGET = 'crudmx-delegate-target@verify.test';
    const delegateTok = await stack.signUp(DELEGATE);
    await stack.signUp(TARGET);
    const uid = async (email: string) =>
      String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id ?? '');
    const delegateId = await uid(DELEGATE);
    const targetId = await uid(TARGET);
    expect(delegateId && targetId, 'delegate and target provisioned').toBeTruthy();
    const ps = await catalogPermissionSet(ql, 'showcase_field_ops_delegate');
    expect(ps, 'delegate set served by the security catalog').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: delegateId, permission_set: ps.name }, { context: SYS });
    await ql.insert('sys_business_unit_member', { business_unit_id: 'bu_field_ops', user_id: delegateId }, { context: SYS });
    await ql.insert('sys_business_unit_member', { business_unit_id: 'bu_west_coast', user_id: targetId }, { context: SYS });

    const sysMake = async (object: string, data: Record<string, unknown>) =>
      String(idOf(await ql.insert(object, data, { context: SYS })));
    const delegateRows = UNJUDGED_ROWS.filter((r) => r.permissionSet === 'showcase_field_ops_delegate');
    const cells: Array<{ cell: string; status: number; code?: string; expected: string }> = [];
    const drive = (object: string, verb: Verb, status: number, json: any, expected: 'allow' | 'deny' | 405) => {
      cells.push({ cell: `${object} ${verb}`, status, code: json?.code, expected: String(expected) });
      return json;
    };
    const send = async (object: string, verb: Verb, r: Response, expected: 'allow' | 'deny' | 405) =>
      drive(object, verb, r.status, await bodyOf(r), expected);

    for (const row of delegateRows) {
      const o = row.object;
      const expectOf = (verb: Verb): 'allow' | 'deny' | 405 =>
        o === 'sys_user' && (verb === 'create' || verb === 'delete') ? 405 : row[verb] ? 'allow' : 'deny';
      if (o === 'sys_user_position') {
        const created = await stack.apiAs(delegateTok, 'POST', `/data/${o}`, {
          user_id: targetId, position: 'contributor', business_unit_id: 'bu_west_coast',
        });
        const own = String(idOf(await send(o, 'create', created, expectOf('create'))));
        await send(o, 'read', await stack.apiAs(delegateTok, 'GET', `/data/${o}`), expectOf('read'));
        await send(o, 'edit', await stack.apiAs(delegateTok, 'PATCH', `/data/${o}/${own}`, { reason: 'crudmx delegate edit' }), expectOf('edit'));
        await send(o, 'delete', await stack.apiAs(delegateTok, 'DELETE', `/data/${o}/${own}`), expectOf('delete'));
        continue;
      }
      const createBody: Record<string, unknown> =
        o === 'sys_business_unit' ? { name: 'crudmx delegate BU' }
          : o === 'sys_business_unit_member' ? { business_unit_id: 'bu_west_coast', user_id: delegateId }
            : { email: 'crudmx-forged@verify.test', name: 'forged' };
      const probe =
        o === 'sys_business_unit' ? await sysMake(o, { name: 'crudmx probe BU' })
          : o === 'sys_business_unit_member' ? await sysMake(o, { business_unit_id: 'bu_hq_finance', user_id: targetId })
            : targetId;
      const editBody: Record<string, unknown> =
        o === 'sys_business_unit_member' ? { business_unit_id: 'bu_acme' } : { name: 'crudmx delegate edit' };
      await send(o, 'create', await stack.apiAs(delegateTok, 'POST', `/data/${o}`, createBody), expectOf('create'));
      await send(o, 'read', await stack.apiAs(delegateTok, 'GET', `/data/${o}`), expectOf('read'));
      await send(o, 'edit', await stack.apiAs(delegateTok, 'PATCH', `/data/${o}/${probe}`, editBody), expectOf('edit'));
      await send(o, 'delete', await stack.apiAs(delegateTok, 'DELETE', `/data/${o}/${probe}`), expectOf('delete'));
    }
    expect(cells.length, 'four rows × four verbs').toBe(16);
    for (const c of cells) {
      if (c.expected === 'allow') expect(c.status, `${c.cell}: allowed`).toBeLessThan(300);
      else if (c.expected === '405') expect([c.status, c.code], `${c.cell}: not exposed over the API`).toEqual([405, 'OBJECT_API_METHOD_NOT_ALLOWED']);
      else expect([c.status, c.code], `${c.cell}: withheld`).toEqual([403, 'PERMISSION_DENIED']);
    }

    // The admin control on the two 405 cells: the exposure gate answers before
    // any permission is judged, so the admin is refused the same way.
    const adminCreate = await stack.apiAs(adminTok, 'POST', '/data/sys_user', { email: 'crudmx-admin-forged@verify.test', name: 'x' });
    expect([adminCreate.status, (await bodyOf(adminCreate))?.code], 'admin sys_user create').toEqual([405, 'OBJECT_API_METHOD_NOT_ALLOWED']);
    const adminDelete = await stack.apiAs(adminTok, 'DELETE', `/data/sys_user/${targetId}`);
    expect([adminDelete.status, (await bodyOf(adminDelete))?.code], 'admin sys_user delete').toEqual([405, 'OBJECT_API_METHOD_NOT_ALLOWED']);
  }, 180_000);

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
  it('names the matrix rows the sweep leaves to the delegate case (the sys_* delegate surface)', () => {
    // The two retired catalog row objects (ADR-0131 D3) leave the matrix with
    // C3 stage 8; the rest of the delegate surface stays.
    const RETIRED = new Set(['sys_permission_set', 'sys_position']);
    expect(UNJUDGED_ROWS.map((r) => r.object).filter((o) => !RETIRED.has(o)).sort()).toEqual([
      'sys_business_unit',
      'sys_business_unit_member',
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
