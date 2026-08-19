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

/** Marker field per object: what a created row is findable by afterwards. */
const MARKER: Record<string, string> = {
  showcase_account: 'name',
  showcase_announcement: 'title',
  // [#9308 fixture 2] The share-link object. It enters this sweep because the
  // matrix gained a `showcase_client_liaison × showcase_client_brief` row, and
  // the sweep is DERIVED from the matrix — a new granted object arrives here
  // automatically, which is the design. Only the fixture maps grow; not one
  // assertion below changes.
  showcase_client_brief: 'title',
  showcase_contact: 'name',
  showcase_inquiry: 'name',
  showcase_invoice: 'name',
  showcase_invoice_line: 'description',
  showcase_private_note: 'title',
  showcase_product: 'name',
  showcase_project: 'name',
  showcase_task: 'title',
};

interface PayloadCtx {
  mark: string;
  email: string;
  accountId: string;
  productId: string;
  projectId: string;
  /** The invoice a line should hang off — the caller's OWN where they have one. */
  invoiceId: string;
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
  // `status` is left at its `draft` default on purpose: this sweep judges CRUD
  // bits, and a brief that is not `published` cannot be mint-eligible for a
  // share link — so a row this sweep leaves behind can never become an
  // accidental share-link fixture for another file.
  showcase_client_brief: (c) => ({ title: c.mark, project: c.projectId }),
  showcase_contact: (c) => ({ name: c.mark, email: `contact-${Date.now()}@probe.test` }),
  showcase_inquiry: (c) => ({ name: c.mark, email: `inq-${Date.now()}@probe.test`, message: 'matrix probe' }),
  showcase_invoice: (c) => ({ name: c.mark, account: c.accountId, status: 'draft', owner: c.email }),
  showcase_invoice_line: (c) => ({ invoice: c.invoiceId, product: c.productId, quantity: 1, description: c.mark }),
  showcase_private_note: (c) => ({ title: c.mark }),
  showcase_product: (c) => ({ name: c.mark, sku: `SKU-${Date.now()}` }),
  showcase_project: (c) => ({ name: c.mark, account: c.accountId, status: 'planned', owner: c.email }),
  showcase_task: (c) => ({ title: c.mark, project: c.projectId, status: 'todo' }),
};

/** Field patched on the EDIT probe — always an unrestricted one. */
const EDIT_FIELD: Record<string, string> = { ...MARKER };

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
  const seed = { accountId: '', productId: '', projectId: '', invoiceId: '' };

  const ctxFor = (email: string, mark: string, invoiceId?: string): PayloadCtx => ({
    mark,
    email,
    accountId: seed.accountId,
    productId: seed.productId,
    projectId: seed.projectId,
    invoiceId: invoiceId || seed.invoiceId,
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
    expect(
      seed.accountId && seed.productId && seed.projectId && seed.invoiceId,
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
        // Clause 2 — a denied CREATE leaves NO row behind.
        const left = await ql.find(row.object, {
          where: { [MARKER[row.object]]: mark },
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
      const editField = EDIT_FIELD[row.object];
      const editValue = `${mark}-edited`;
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
    // No pre-existing cell changed side; `git diff` on access-matrix.json is
    // the check that this is still true.
    expect(allow.length, 'the ALLOW half is what catches an over-tightening regression').toBe(54);
    expect(deny.length, 'the DENY half is what catches a widening regression').toBe(54);

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
