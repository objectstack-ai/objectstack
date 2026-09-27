// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `security/explain` for a WRITE must be computed from the by-id write path's
// own inputs, so its `record.visible` equals what the by-id PATCH / DELETE does.
//
// The measured divergence: on a private-OWD object, explain answered
// `record.visible: false` (`decidedBy: 'rls'`) for `update` on rows the by-id
// PATCH then ADMITTED for the same caller, through the same stack. Every
// consumer that gates Edit on `record.visible` hid it from permitted users.
// Two independent mechanisms, one per explain dependency:
//
//   M1 — the platform ownership floor. The pre-image gate (step 2.7) drops
//        `owner_only_writes` / `owner_only_deletes` (`created_by ==
//        current_user.id`, bound to `org_member`) when the sharing write
//        verdict is `allow`. Explain composed Layer 1 with no options, so the
//        floor stayed and excluded every row the caller did not CREATE.
//   M2 — the write depth. The middleware (step 2.6) stamps `__writeScope`
//        before plugin-sharing's `canEdit` / `canDelete` read it. Explain asked
//        the same gate with the bare context, so an `org` writer was judged
//        owner-only.
//
// This file wires the REAL SecurityPlugin (middleware + explain entry point),
// the REAL SharingService and sharing middleware, and the REAL platform
// `member_default` seed (the floor's source) over one in-memory engine, and
// asserts one property per cell: explain's `record.visible` equals the write's
// outcome. A cell that asserts only one side would pin nothing about the
// agreement this file exists for.
//
// ⚠️ The double's nested reads are not scoped by plugin-sharing's READ filter
// (see `row-write-widener-composition.test.ts`, "WHAT THIS FILE CANNOT SEE").
// Every cell below whose write is admitted is one whose row the caller can
// also READ on the real stack — `org` read depth, an edit share (which grants
// read), or ownership — so no verdict here rests on the double's looseness.
import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SharingService, buildSharingMiddleware } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── metadata ───────────────────────────────────────────────────────────────

const OBJECT = 'kpi_entry_line';

const fieldsOf = (...names: string[]) =>
  Object.fromEntries(names.map((n) => [n, { name: n }]));

/**
 * The reported object: `sharingModel` UNSET, which ADR-0090 D1 resolves to
 * `private` (fail-closed default), and an ordinary access posture, so the
 * Layer-1 superuser short-circuit is withheld and the floor is in play.
 */
const PRIVATE_SCHEMA = {
  name: OBJECT,
  fields: fieldsOf('id', 'name', 'value', 'owner_id', 'created_by', 'organization_id'),
};

/** The OWD control: the object's own write model opens row writes. */
const PUBLIC_RW_SCHEMA = { ...PRIVATE_SCHEMA, sharingModel: 'public_read_write' };

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const ADMIN_FULL_ACCESS = defaultPermissionSets.find((p) => p.name === 'admin_full_access')!;

/** Read/write depth `org` — an HR reviewer who may correct any line. */
const HR_REVIEWER: PermissionSet = PermissionSetSchema.parse({
  name: 'hr_reviewer',
  objects: {
    [OBJECT]: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      readScope: 'org', writeScope: 'org',
    },
  },
});

/**
 * Depth `own` — widened only by ownership or an `edit` share. The DELETE bit
 * is granted so a refused delete below is the ROW gate refusing, never CRUD.
 */
const DEPT_REPORTER: PermissionSet = PermissionSetSchema.parse({
  name: 'dept_reporter',
  objects: {
    [OBJECT]: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      readScope: 'own', writeScope: 'own',
    },
  },
});

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, ADMIN_FULL_ACCESS, HR_REVIEWER, DEPT_REPORTER];

// ── principals and rows ────────────────────────────────────────────────────

const U_ADMIN = 'u_admin';
const U_HR = 'u_hr';
const U_REPORTER = 'u_reporter';

/**
 * `org_member` is the applicability domain of the platform floor. Every
 * member holds it, which is why the floor used to override their grants.
 */
const ctxFor = (userId: string, permission: string, positions: string[] = ['org_member']) => ({
  userId, tenantId: 'org1', positions, permissions: [permission],
});

const ADMIN_CTX = ctxFor(U_ADMIN, 'admin_full_access');
const HR_CTX = ctxFor(U_HR, 'hr_reviewer');
const REPORTER_CTX = ctxFor(U_REPORTER, 'dept_reporter');
/** The floor taken out of play by its own domain — isolates M2. */
const HR_NO_FLOOR_CTX = ctxFor(U_HR, 'hr_reviewer', []);
const REPORTER_NO_FLOOR_CTX = ctxFor(U_REPORTER, 'dept_reporter', []);

type RowKey = 'shared' | 'owned' | 'unshared';

/** Every row is CREATED by the admin, as in the report. */
const ROWS: Record<RowKey, Record<string, unknown>> = {
  /** Owned by the admin; the reporter holds an `edit` share on it. */
  shared: { id: 'kle_shared', name: 'Shared', value: 1, owner_id: U_ADMIN, created_by: U_ADMIN, organization_id: 'org1' },
  /** `owner_id` moved to the reporter; `created_by` is still the admin. */
  owned: { id: 'kle_owned', name: 'Owned', value: 1, owner_id: U_REPORTER, created_by: U_ADMIN, organization_id: 'org1' },
  /** Neither shared with nor owned by the reporter — the negative control. */
  unshared: { id: 'kle_unshared', name: 'Unshared', value: 1, owner_id: U_ADMIN, created_by: U_ADMIN, organization_id: 'org1' },
};

const EDIT_SHARE = {
  id: 'shr_edit', object_name: OBJECT, record_id: ROWS.shared.id,
  recipient_type: 'user', recipient_id: U_REPORTER, access_level: 'edit', source: 'manual',
};

// ── in-memory engine ───────────────────────────────────────────────────────

function makeEngine(schema: Record<string, unknown>, rowOverrides: Partial<Record<RowKey, Record<string, unknown>>>) {
  const tables: Record<string, any[]> = {
    [OBJECT]: (Object.keys(ROWS) as RowKey[]).map((k) => ({ ...ROWS[k], ...(rowOverrides[k] ?? {}) })),
    sys_record_share: [{ ...EDIT_SHARE }],
  };
  // `$or` / `$and` conjoin WITH their sibling keys, the way a real driver ANDs
  // them (#7620).
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    if (Array.isArray(filter.$or) && !filter.$or.some((f: any) => matches(row, f))) return false;
    if (Array.isArray(filter.$and) && !filter.$and.every((f: any) => matches(row, f))) return false;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or' || k === '$and') continue;
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
  const middlewares: any[] = [];
  return {
    _tables: tables,
    _middlewares: middlewares,
    registerMiddleware: (mw: any) => middlewares.push(mw),
    getSchema: (name: string) => (name === OBJECT ? schema : undefined),
    async find(object: string, options: any = {}) {
      const rows = (tables[object] ??= []);
      return rows.filter((r) => matches(r, options.filter ?? options.where)).slice(0, options.limit ?? 1000);
    },
    async findOne(object: string, options: any = {}) {
      assertEngineFindOnePredicate(object, options);
      const rows = await this.find(object, { ...options, limit: 1 });
      return rows[0] ?? null;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    // Both write verbs open with the PRODUCER's dispatch predicate (#6277), so
    // a call shape `ObjectQL` would refuse fails loudly instead of collecting
    // a green from gates that never ran.
    //
    // [#20013] `opCtx` is the operation the middleware chain ran on. The
    // engine hands an installed write-image check the rows it is about to
    // store — the by-id row, or every matched row, merged with the payload —
    // before it writes. The Layer 0 tenant wall installs that seam on every
    // walled update (this stack is walled), and a double that skipped it would
    // be refused, fail-closed, by the security middleware.
    async update(object: string, data: any, options?: any, opCtx?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      const seam = opCtx?.postHookWriteImageCheck;
      if (seam) {
        seam.honoured = true;
        await seam.evaluate(targets.map((r) => ({ ...r, ...data })));
      }
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      tables[object] = rows.filter((r) => !targets.includes(r));
      return dispatch.kind === 'by-id' ? targets.length > 0 : targets.length;
    },
  };
}

// ── the stack ──────────────────────────────────────────────────────────────

interface WriteOutcome {
  ok: boolean;
  /** ADR-0112 envelope of a refusal — asserted, never a bare `toThrow()`. */
  code?: string;
  status?: number;
  message: string;
}

interface Stack {
  explain: (operation: 'update' | 'delete', rowKey: RowKey, context: any) => Promise<any>;
  write: (operation: 'update' | 'delete', rowKey: RowKey, context: any) => Promise<WriteOutcome>;
  row: (rowKey: RowKey) => Record<string, unknown> | undefined;
}

async function makeStack(
  opts: { schema?: Record<string, unknown>; rows?: Partial<Record<RowKey, Record<string, unknown>>> } = {},
): Promise<Stack> {
  const schema = opts.schema ?? PRIVATE_SCHEMA;
  const engine = makeEngine(schema, opts.rows ?? {});
  const metadata = {
    get: async (_type: string, name: string) => (name === OBJECT ? schema : null),
    list: async () => PERMISSION_SETS,
  };
  let security: any;
  let sharing: SharingService;
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    // Org scoping active, so Layer 0 contributes a real tenant predicate.
    'org-scoping': { name: 'org-scoping' },
    get sharing() { return sharing; },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, impl: any) => { if (name === 'security') security = impl; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  if (!security) throw new Error('SecurityPlugin did not register the security service');

  sharing = new SharingService({ engine: engine as any, securityService: () => security });
  const sharingMw = buildSharingMiddleware(sharing, ctx.logger);
  const securityMw = engine._middlewares[0];
  const idOf = (rowKey: RowKey) => String(ROWS[rowKey].id);

  return {
    explain: (operation, rowKey, context) =>
      security.explain({ object: OBJECT, operation, recordId: idOf(rowKey) }, { ...context }),
    row: (rowKey) => engine._tables[OBJECT].find((r) => r.id === idOf(rowKey)),
    async write(operation, rowKey, context) {
      const recordId = idOf(rowKey);
      const opCtx: any = {
        object: OBJECT,
        operation,
        context: { ...context },
        ...(operation === 'update'
          ? { data: { id: recordId, value: 2 } }
          : { options: { where: { id: recordId } } }),
      };
      let reached = false;
      try {
        await securityMw(opCtx, async () => {
          await sharingMw(opCtx, async () => {
            if (operation === 'delete') await engine.delete(opCtx.object, opCtx.options);
            else await engine.update(opCtx.object, opCtx.data, opCtx.options, opCtx);
            reached = true;
          });
        });
      } catch (e: any) {
        // Security's `PermissionDeniedError` carries `statusCode`; plugin-sharing's
        // refusal carries `status`. Both are the one ADR-0112 403.
        return { ok: false, code: e?.code, status: e?.statusCode ?? e?.status, message: String(e?.message ?? e) };
      }
      return reached ? { ok: true, message: 'written' } : { ok: false, message: 'middleware swallowed the write' };
    },
  };
}

/**
 * One cell: explain FIRST (it must not see the write's effect), then the
 * write, then the agreement — and, for an admitted write, the row really
 * changed; for a refused one, the ADR-0112 envelope of the refusal, whose
 * code names the gate that refused: `PERMISSION_DENIED` is the security
 * pre-image gate (step 2.7), `FORBIDDEN` is plugin-sharing's per-record gate.
 */
async function expectCell(
  stack: Stack,
  operation: 'update' | 'delete',
  rowKey: RowKey,
  context: any,
  expected: boolean,
  refusedWith: 'PERMISSION_DENIED' | 'FORBIDDEN' = 'PERMISSION_DENIED',
): Promise<any> {
  const decision = await stack.explain(operation, rowKey, context);
  const write = await stack.write(operation, rowKey, context);
  const cell = `${context.userId} × ${rowKey} × ${operation}`;
  expect(write.ok, `${cell}: the by-id write (${write.message})`).toBe(expected);
  expect(
    decision.record?.visible,
    `${cell}: explain record.visible (decidedBy ${decision.record?.decidedBy}) must equal the write's outcome`,
  ).toBe(write.ok);
  if (expected) {
    if (operation === 'update') expect(stack.row(rowKey)?.value, `${cell}: row really changed`).toBe(2);
    else expect(stack.row(rowKey), `${cell}: row really gone`).toBeUndefined();
  } else {
    expect(write.code, `${cell}: ADR-0112 code`).toBe(refusedWith);
    expect(write.status, `${cell}: ADR-0112 status`).toBe(403);
    expect(stack.row(rowKey)?.value, `${cell}: row untouched`).toBe(1);
  }
  return decision;
}

// ───────────────────────────────────────────────────────────────────────────

describe('explain(update) agrees with the by-id PATCH, cell by cell (private OWD)', () => {
  const cells: Array<[string, RowKey, any, boolean]> = [
    ['builtin admin', 'shared', ADMIN_CTX, true],
    ['hr_reviewer (org depth)', 'shared', HR_CTX, true],
    ['hr_reviewer (org depth)', 'owned', HR_CTX, true],
    ['hr_reviewer (org depth)', 'unshared', HR_CTX, true],
    ['dept_reporter via edit share', 'shared', REPORTER_CTX, true],
    ['dept_reporter as owner (not creator)', 'owned', REPORTER_CTX, true],
    ['dept_reporter, unshared and not owned', 'unshared', REPORTER_CTX, false],
  ];
  it.each(cells)('%s × %s row', async (_label, rowKey, context, expected) => {
    await expectCell(await makeStack(), 'update', rowKey, context, expected);
  });

  it('negative control: the refused cell is refused by BOTH gates explain reports', async () => {
    const decision = await expectCell(await makeStack(), 'update', 'unshared', REPORTER_CTX, false);
    // The floor stays (the sharing verdict is `deny`, so nothing replaces it)
    // and the sharing gate refuses: explain names the first of the two.
    expect(decision.record.decidedBy).toBe('rls');
    expect(decision.layers.find((l: any) => l.layer === 'sharing').record.outcome).toBe('excluded');
  });
});

describe('explain(delete) agrees with the by-id DELETE, cell by cell (private OWD)', () => {
  const cells: Array<[string, RowKey, any, boolean]> = [
    ['hr_reviewer (org depth)', 'unshared', HR_CTX, true],
    ['dept_reporter as owner (not creator)', 'owned', REPORTER_CTX, true],
    // ADR-0111 D3: an `edit` share widens update, never delete.
    ['dept_reporter via edit share', 'shared', REPORTER_CTX, false],
    ['dept_reporter, unshared and not owned', 'unshared', REPORTER_CTX, false],
  ];
  it.each(cells)('%s × %s row', async (_label, rowKey, context, expected) => {
    await expectCell(await makeStack(), 'delete', rowKey, context, expected);
  });
});

describe('M1 — the platform floor: move ONLY created_by, the verdict must not move', () => {
  // Same principal, same row, same share, same owner. Before the fix the
  // not-created-by leg read `false` (`decidedBy: 'rls'`) while PATCH admitted.
  it.each([
    ['created by the admin', U_ADMIN],
    ['created by the reporter', U_REPORTER],
  ])('dept_reporter × shared row, %s', async (_label, createdBy) => {
    const stack = await makeStack({ rows: { shared: { created_by: createdBy } } });
    await expectCell(stack, 'update', 'shared', REPORTER_CTX, true);
  });
});

describe('M2 — the write depth: explain stamps it the way step 2.6 does', () => {
  // Without `org_member` the floor is outside its domain, so only the sharing
  // gate's depth input is under test. Before the fix this cell read `false`
  // (`decidedBy: 'sharing'`) while PATCH admitted.
  it('an org-depth writer is admitted on an unshared, not-owned row', async () => {
    await expectCell(await makeStack(), 'update', 'unshared', HR_NO_FLOOR_CTX, true);
  });

  it('a depth the CALLER brings does not decide — explain computes it, as step 2.6 overwrites it', async () => {
    // One variable: `__writeScope` stamped on the explained context. The
    // write path overwrites any such key before plugin-sharing reads it, so
    // it refuses; explain must not be widened by it either.
    // No floor in play, so the refusal is plugin-sharing's own.
    const forged = { ...REPORTER_NO_FLOOR_CTX, __writeScope: 'org' };
    await expectCell(await makeStack(), 'update', 'unshared', forged, false, 'FORBIDDEN');
  });
});

describe("OWD control: `public_read_write` — the object's own model opens writes", () => {
  const principals: Array<[string, any]> = [
    ['builtin admin', ADMIN_CTX],
    ['hr_reviewer', HR_CTX],
    ['dept_reporter', REPORTER_CTX],
  ];
  const rows: RowKey[] = ['shared', 'owned', 'unshared'];
  const cells = principals.flatMap(([label, context]) => rows.map((r) => [label, r, context] as const));
  it.each(cells)('%s × %s row: both admit', async (_label, rowKey, context) => {
    await expectCell(await makeStack({ schema: PUBLIC_RW_SCHEMA }), 'update', rowKey, context, true);
  });
});
