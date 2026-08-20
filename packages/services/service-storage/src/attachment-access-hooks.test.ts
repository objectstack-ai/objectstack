// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { installAttachmentAccessHooks, type AttachmentSharingLike } from './attachment-access-hooks.js';
import type { AttachmentLifecycleEngine } from './attachment-lifecycle.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

/** Capture the two registered hooks so tests can drive them directly. */
function install(opts: {
  attachments?: Array<Record<string, unknown>>;
  sharing?: AttachmentSharingLike | null;
}) {
  const hooks = new Map<string, (ctx: any) => Promise<void>>();
  const engine: AttachmentLifecycleEngine = {
    registerHook: (event, handler) => {
      hooks.set(event, handler as any);
    },
    find: async (_object, options: any) => {
      const rows = (opts.attachments ?? []).filter((r) =>
        Object.entries(options?.where ?? {}).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }),
      );
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    findOne: async (_object, options: any) =>
      (opts.attachments ?? []).find((r) =>
        Object.entries(options?.where ?? {}).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }),
      ) ?? null,
    update: async () => ({}),
  };
  installAttachmentAccessHooks(engine, () => opts.sharing, silentLogger());
  return {
    beforeInsert: hooks.get('beforeInsert')!,
    beforeDelete: hooks.get('beforeDelete')!,
  };
}

/** Caller-scoped api fake: `visibleParents` is the set of records the
 * caller can read, keyed `object/id`. */
function apiFor(visibleParents: string[]) {
  return {
    object: (name: string) => ({
      findOne: async ({ where }: any) =>
        visibleParents.includes(`${name}/${where.id}`) ? { id: where.id } : null,
    }),
  };
}

const insertCtx = (data: any, opts: { userId?: string; isSystem?: boolean; visible?: string[] } = {}) => ({
  object: 'sys_attachment',
  event: 'beforeInsert',
  input: { data, options: { context: { userId: opts.userId, permissions: [] } } },
  session: opts.isSystem ? { isSystem: true, userId: opts.userId } : opts.userId ? { userId: opts.userId } : undefined,
  api: apiFor(opts.visible ?? []),
});

const deleteCtx = (input: any, opts: { userId?: string; isSystem?: boolean; visible?: string[] } = {}) => ({
  object: 'sys_attachment',
  event: 'beforeDelete',
  input: { ...input, options: { ...(input.options ?? {}), context: { userId: opts.userId, permissions: [] } } },
  session: opts.isSystem ? { isSystem: true, userId: opts.userId } : opts.userId ? { userId: opts.userId } : undefined,
  api: apiFor(opts.visible ?? []),
});

describe('attachment access — beforeInsert (parent visibility + provenance)', () => {
  it('rejects attaching to a parent the caller cannot read (403 ATTACHMENT_PARENT_ACCESS)', async () => {
    const { beforeInsert } = install({});
    const ctx = insertCtx(
      { parent_object: 'att_secret', parent_id: 'r1', file_id: 'f1' },
      { userId: 'u1', visible: [] },
    );
    await expect(beforeInsert(ctx)).rejects.toMatchObject({
      code: 'ATTACHMENT_PARENT_ACCESS',
      status: 403,
      object: 'att_secret',
    });
  });

  it('allows attaching to a readable parent', async () => {
    const { beforeInsert } = install({});
    const ctx = insertCtx(
      { parent_object: 'att_case', parent_id: 'r1', file_id: 'f1' },
      { userId: 'u1', visible: ['att_case/r1'] },
    );
    await expect(beforeInsert(ctx)).resolves.toBeUndefined();
  });

  it('server-stamps uploaded_by from the session, overwriting a spoofed value', async () => {
    const { beforeInsert } = install({});
    const data = { parent_object: 'att_case', parent_id: 'r1', file_id: 'f1', uploaded_by: 'someone-else' };
    await beforeInsert(insertCtx(data, { userId: 'u1', visible: ['att_case/r1'] }));
    expect(data.uploaded_by).toBe('u1');
  });

  it('bypasses for system context and context-less calls', async () => {
    const { beforeInsert } = install({});
    await expect(
      beforeInsert(insertCtx({ parent_object: 'x', parent_id: 'r' }, { isSystem: true, userId: 'u1' })),
    ).resolves.toBeUndefined();
    await expect(beforeInsert(insertCtx({ parent_object: 'x', parent_id: 'r' }, {}))).resolves.toBeUndefined();
  });

  // #3712 — a schedule-triggered flow run has provenance but no caller. This
  // gate reads `!ctx.session` as "no identity envelope was supplied", so write
  // provenance is deliberately kept OUT of the session: had such a run
  // presented an empty session instead, this bypass would have silently become
  // a 403 and narrowed the #1888 fail-open for attachments alone.
  it('still bypasses a flow run that carries provenance but no session', async () => {
    const { beforeInsert } = install({ sharing: { canEdit: async () => false } });
    await expect(
      beforeInsert({
        ...insertCtx({ parent_object: 'x', parent_id: 'r' }, {}),
        provenance: { flowRunId: 'run_1' },
      }),
    ).resolves.toBeUndefined();
  });

  // #2970 item 3 — with a sharing service present, attach requires EDIT
  // (canEdit), not merely read visibility.
  it('with sharing: rejects attaching when the caller cannot EDIT the parent (even if readable)', async () => {
    const canEdit = vi.fn(async () => false);
    const { beforeInsert } = install({ sharing: { canEdit } });
    const ctx = insertCtx(
      { parent_object: 'att_readonly', parent_id: 'r1', file_id: 'f1' },
      { userId: 'u1', visible: ['att_readonly/r1'] }, // readable, but canEdit=false
    );
    await expect(beforeInsert(ctx)).rejects.toMatchObject({
      code: 'ATTACHMENT_PARENT_ACCESS',
      status: 403,
    });
    expect(canEdit).toHaveBeenCalledWith('att_readonly', 'r1', expect.objectContaining({ userId: 'u1' }));
  });

  it('with sharing: allows attaching when the caller CAN edit the parent', async () => {
    const { beforeInsert } = install({ sharing: { canEdit: async () => true } });
    const ctx = insertCtx(
      { parent_object: 'att_case', parent_id: 'r1', file_id: 'f1' },
      { userId: 'u1', visible: [] }, // not readable via api, but canEdit=true governs
    );
    await expect(beforeInsert(ctx)).resolves.toBeUndefined();
  });
});

describe('attachment access — beforeDelete (uploader or parent editor)', () => {
  const row = { id: 'a1', file_id: 'f1', parent_object: 'att_secret', parent_id: 'r1', uploaded_by: 'uploader' };

  it('the uploader may always delete their attachment', async () => {
    const canEdit = vi.fn(async () => false);
    const { beforeDelete } = install({ attachments: [row], sharing: { canEdit } });
    await expect(beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'uploader' }))).resolves.toBeUndefined();
    expect(canEdit).not.toHaveBeenCalled();
  });

  it('a non-uploader without parent edit is rejected (403 ATTACHMENT_DELETE_DENIED)', async () => {
    const { beforeDelete } = install({ attachments: [row], sharing: { canEdit: async () => false } });
    await expect(beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'stranger' }))).rejects.toMatchObject({
      code: 'ATTACHMENT_DELETE_DENIED',
      status: 403,
    });
  });

  it('a parent editor may delete another user\'s attachment', async () => {
    const canEdit = vi.fn(async (object: string, recordId: string, ctx: any) => {
      expect(object).toBe('att_secret');
      expect(recordId).toBe('r1');
      expect(ctx.userId).toBe('editor');
      return true;
    });
    const { beforeDelete } = install({ attachments: [row], sharing: { canEdit } });
    await expect(beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'editor' }))).resolves.toBeUndefined();
  });

  it('multi-delete requires EVERY matched row to pass', async () => {
    const rows = [
      { ...row, id: 'a1', uploaded_by: 'me' },
      { ...row, id: 'a2', uploaded_by: 'someone-else', parent_object: 'att_secret', parent_id: 'r2' },
    ];
    const { beforeDelete } = install({ attachments: rows, sharing: { canEdit: async () => false } });
    await expect(
      beforeDelete(deleteCtx({ options: { where: { parent_object: 'att_secret' }, multi: true } }, { userId: 'me' })),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED' });
  });

  it('degrades to parent READ visibility when the sharing service is absent', async () => {
    const { beforeDelete } = install({ attachments: [row], sharing: null });
    // caller can read the parent → allowed
    await expect(
      beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'reader', visible: ['att_secret/r1'] })),
    ).resolves.toBeUndefined();
    // caller cannot read the parent → denied
    await expect(
      beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'reader', visible: [] })),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED' });
  });

  it('bypasses for system context; a no-match delete is not blocked', async () => {
    const { beforeDelete } = install({ attachments: [row], sharing: { canEdit: async () => false } });
    await expect(beforeDelete(deleteCtx({ id: 'a1' }, { isSystem: true, userId: 'x' }))).resolves.toBeUndefined();
    await expect(beforeDelete(deleteCtx({ id: 'missing' }, { userId: 'x' }))).resolves.toBeUndefined();
  });

  // The #4757 unscoped-multi-delete block that used to sit here called the
  // handler DIRECTLY with a whole-operation context of this file's own
  // construction — a shape the engine's per-row dispatch (#5038/#5574) never
  // produced, so the block stayed green for a behaviour the wired engine did
  // the opposite of (#9719's measurement: an uploader-owned table was wiped by
  // `{ multi: true }` while these cases passed). It is re-pointed at the REAL
  // engine below — see "#4757 through the wired engine".
});

// ─────────────────────────────────────────────────────────────────────────
// #4757 through the WIRED engine (#9719)
//
// A real `ObjectQL` + in-memory driver + this module's installer — the exact
// path `ql.delete('sys_attachment', …)` takes in production. The unscoped
// refusal reaches the handler through the `dispatchUnscopedMultiWrite`
// whole-operation dispatch its registration declares; the per-row gate keeps
// firing per matched row; the scoped paths keep resolving. Every refusal here
// asserts the rows SURVIVED, because the defect this replaces was precisely a
// green suite over a wiped table.
//
// NOTE `@objectstack/objectql` is deliberately un-aliased in this package's
// vitest config (see `KNOWN_UNALIASED_TEST_IMPORTS`): these pins run against
// objectql's BUILT dist, so a stale build tests yesterday's engine — rebuild
// `@objectstack/objectql` before trusting a verdict from this block.
// ─────────────────────────────────────────────────────────────────────────

const ATT_FIELDS = {
  id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
  file_id: { name: 'file_id', label: 'File', type: 'text' as const },
  parent_object: { name: 'parent_object', label: 'Parent Object', type: 'text' as const },
  parent_id: { name: 'parent_id', label: 'Parent Id', type: 'text' as const },
  uploaded_by: { name: 'uploaded_by', label: 'Uploaded By', type: 'text' as const },
};
const sysAttachmentObject = { name: 'sys_attachment', label: 'Attachment', fields: ATT_FIELDS };
const attSecretObject = {
  name: 'att_secret',
  label: 'Secret',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

/** In-memory driver whose WHERE matcher REFUSES combinators/operator values by
 * throwing — the conforming shape `check-where-matcher-conformance.mjs` asks
 * of a double (silently wrong answers are the defect class, not incompleteness). */
function makeWiredDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) throw new Error(`wired stub driver: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object') throw new Error(`wired stub driver: unsupported operator value on ${k}`);
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {}, stores,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      const id = String(data.id);
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update() { return null; },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async count(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length;
    },
    async deleteMany(o: string, ast: any) {
      const doomed = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of doomed) storeFor(o).delete(String(r.id));
      return doomed.length;
    },
    async updateMany() { return 0; },
  };
  return d;
}

async function bootWired(opts: {
  attachments?: Array<Record<string, unknown>>;
  sharing?: AttachmentSharingLike | null;
} = {}) {
  const ql = new ObjectQL();
  const driver = makeWiredDriver();
  ql.registerDriver(driver, true);
  await ql.init();
  ql.registry.registerObject(sysAttachmentObject as any, 'app:test');
  ql.registry.registerObject(attSecretObject as any, 'app:test');
  // `engine as any` mirrors the production wiring in storage-service-plugin.ts.
  installAttachmentAccessHooks(ql as any, () => opts.sharing ?? null, silentLogger());
  if (!driver.stores.get('sys_attachment')) driver.stores.set('sys_attachment', new Map());
  for (const row of opts.attachments ?? []) {
    driver.stores.get('sys_attachment')!.set(String(row.id), { ...row });
  }
  const remaining = () => driver.stores.get('sys_attachment')?.size ?? 0;
  return { ql, driver, remaining };
}

const wiredRow = (id: string, uploadedBy: string, parentId = 'r1') => ({
  id, file_id: `f_${id}`, parent_object: 'att_secret', parent_id: parentId, uploaded_by: uploadedBy,
});

const UNSCOPED_REFUSAL = expect.objectContaining({
  code: 'ATTACHMENT_DELETE_DENIED',
  status: 403,
  // The first sentence IS the declared contract (#4757's quoted refusal).
  message: expect.stringContaining('Refusing an unscoped multi-delete of attachments'),
});

describe('unscoped multi-delete (no id, no where) — #4757 through the wired engine (#9719)', () => {
  it('refuses `{ multi: true }` even when the caller is the uploader of EVERY matched row — and the rows survive', async () => {
    // #9719's measured gap verbatim: before the fix this call RESOLVED and
    // wiped both rows; the per-row uploader shortcut licensed each row and no
    // dispatch ever carried the unscoped shape.
    const { ql, remaining } = await bootWired({
      attachments: [wiredRow('a1', 'uploader'), wiredRow('a2', 'uploader', 'r2')],
    });
    await expect(
      ql.delete('sys_attachment', { multi: true, context: { userId: 'uploader' } } as any),
    ).rejects.toEqual(UNSCOPED_REFUSAL);
    expect(remaining()).toBe(2);
  });

  it('refuses an explicitly null `where` the same way', async () => {
    const { ql, remaining } = await bootWired({ attachments: [wiredRow('a1', 'uploader')] });
    await expect(
      ql.delete('sys_attachment', { multi: true, where: null, context: { userId: 'uploader' } } as any),
    ).rejects.toEqual(UNSCOPED_REFUSAL);
    expect(remaining()).toBe(1);
  });

  it('refuses on an EMPTY table — "nothing was ever queried" is not "nothing to authorize"', async () => {
    // The zero-match limb (#9719): the per-row dispatch is gated on matched
    // rows, so a handler-only fix can never fire here — a caller probing
    // against an empty table would see success and ship the unscoped delete.
    const { ql } = await bootWired({ attachments: [] });
    await expect(
      ql.delete('sys_attachment', { multi: true, context: { userId: 'uploader' } } as any),
    ).rejects.toEqual(UNSCOPED_REFUSAL);
  });

  it('positive control: an empty table is not refused per se — a scoped `where: {}` delete of it resolves', async () => {
    // Proves the empty-table refusal above measures the SHAPE, not the
    // emptiness: the same table, queried for real, deletes zero rows quietly.
    const { ql } = await bootWired({ attachments: [] });
    await expect(
      ql.delete('sys_attachment', { multi: true, where: {}, context: { userId: 'uploader' } } as any),
    ).resolves.toBeDefined();
  });

  it('the per-row gate is a DIFFERENT refusal and still fires through the wire', async () => {
    // #9719's other measured row: a scoped delete matching a row the caller is
    // not entitled to still answers with the PER-ROW message, not #4757's.
    const { ql, remaining } = await bootWired({
      attachments: [wiredRow('a1', 'member'), wiredRow('a2', 'someone-else', 'r2')],
      sharing: { canEdit: async () => false },
    });
    await expect(
      ql.delete('sys_attachment', {
        multi: true,
        where: { parent_object: 'att_secret' },
        context: { userId: 'member' },
      } as any),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'ATTACHMENT_DELETE_DENIED',
        status: 403,
        message: expect.stringContaining('Cannot delete attachment'),
      }),
    );
    expect(remaining()).toBe(2);
  });

  it('scoped controls still pass: by id, by a real `where`, and by the match-all `where: {}`', async () => {
    // Over-firing here would break every legitimate attachment delete.
    const byId = await bootWired({ attachments: [wiredRow('a1', 'uploader')] });
    await expect(
      byId.ql.delete('sys_attachment', { where: { id: 'a1' }, context: { userId: 'uploader' } } as any),
    ).resolves.toBeDefined();
    expect(byId.remaining()).toBe(0);

    const byWhere = await bootWired({
      attachments: [wiredRow('a1', 'uploader'), wiredRow('a2', 'uploader', 'r2')],
    });
    await expect(
      byWhere.ql.delete('sys_attachment', {
        multi: true,
        where: { uploaded_by: 'uploader' },
        context: { userId: 'uploader' },
      } as any),
    ).resolves.toBeDefined();
    expect(byWhere.remaining()).toBe(0);

    // `where: {}` is a REAL match-all query (the declared semantics): every
    // matched row is authorized per row, and an entitled caller may empty the
    // table with it — the refusal is about an ABSENT predicate only.
    const matchAll = await bootWired({ attachments: [wiredRow('a1', 'uploader')] });
    await expect(
      matchAll.ql.delete('sys_attachment', { multi: true, where: {}, context: { userId: 'uploader' } } as any),
    ).resolves.toBeDefined();
    expect(matchAll.remaining()).toBe(0);
  });

  it('still bypasses for system context and for context-less programmatic calls', async () => {
    const system = await bootWired({ attachments: [wiredRow('a1', 'someone')] });
    await expect(
      system.ql.delete('sys_attachment', { multi: true, context: { isSystem: true } } as any),
    ).resolves.toBeDefined();
    expect(system.remaining()).toBe(0);

    const bare = await bootWired({ attachments: [wiredRow('a1', 'someone')] });
    await expect(
      bare.ql.delete('sys_attachment', { multi: true } as any),
    ).resolves.toBeDefined();
    expect(bare.remaining()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// #7145 — what the gate FORWARDS to the sharing service
//
// The mirror of #7141 / PR #7143 for the attachment kit: `callerContext()`
// rebuilt a five-field projection of the caller's execution envelope before
// handing it to `ISharingService.canEdit`, whose contract declares the FULL
// envelope and whose doc block tells callers they "MUST NOT rebuild a subset
// of it" (#6523 / the #6206 ruling).
// ─────────────────────────────────────────────────────────────────────────

/**
 * The caller's execution envelope as a real transport builds it — an OAuth MCP
 * agent principal acting on behalf of a human (`resolve-execution-context.ts`
 * is the live producer of `principalKind: 'agent'` + `onBehalfOf`) — with the
 * middleware-private keys plugin-security stamps for the object of the
 * operation in flight (`sys_attachment`) riding along, because that is exactly
 * what `sc.__readScope = …` leaves on the context these hooks receive.
 */
const DELEGATED_ENVELOPE = {
  userId: 'human_1',
  tenantId: 'org_1',
  email: 'human@example.com',
  positions: [],
  permissions: ['mcp_agent_data_write'],
  systemPermissions: [],
  principalKind: 'agent',
  onBehalfOf: { userId: 'human_1', principalKind: 'human' },
  audience: 'internal',
  posture: 'authenticated',
  accessible_org_ids: ['org_1'],
  rlsMembership: { team: ['t1'] },
  isSystem: false,
  // Middleware-private, resolved for `sys_attachment` — NOT for the parent.
  __readScope: 'org',
  __writeScope: 'org',
  __delegatorReadScope: 'org',
  __delegatorWriteScope: 'org',
  __expandRead: true,
} as const;

/** The principal half of {@link DELEGATED_ENVELOPE} — everything that must
 * survive the forward, and nothing that must not. */
const DELEGATED_PRINCIPAL_FIELDS = {
  userId: 'human_1',
  tenantId: 'org_1',
  email: 'human@example.com',
  positions: [],
  permissions: ['mcp_agent_data_write'],
  systemPermissions: [],
  principalKind: 'agent',
  onBehalfOf: { userId: 'human_1', principalKind: 'human' },
  audience: 'internal',
  posture: 'authenticated',
  accessible_org_ids: ['org_1'],
  rlsMembership: { team: ['t1'] },
  isSystem: false,
};

const OPERATION_PRIVATE_KEYS = [
  '__readScope',
  '__writeScope',
  '__delegatorReadScope',
  '__delegatorWriteScope',
  '__expandRead',
];

/** An insert ctx carrying an explicit execution envelope. */
const envelopeInsertCtx = (data: any, exec: Record<string, unknown>) => ({
  object: 'sys_attachment',
  event: 'beforeInsert',
  input: { data, options: { context: exec } },
  session: { userId: exec.userId as string },
  api: apiFor([]),
});

/** A delete ctx carrying an explicit execution envelope. */
const envelopeDeleteCtx = (input: any, exec: Record<string, unknown>) => ({
  object: 'sys_attachment',
  event: 'beforeDelete',
  input: { ...input, options: { ...(input.options ?? {}), context: exec } },
  session: { userId: exec.userId as string },
  api: apiFor([]),
});

/** The deployment's `fallbackPermissionSet` (ADR-0056 D7: an app's `isDefault`
 * profile, else the built-in `member_default`). */
const DEPLOYMENT_BASELINE_SET = 'app_default_profile';

/**
 * `ISecurityService.hasWriteBypass` as plugin-security implements it
 * (`security-plugin.ts`) — the three guard lines, then the `modifyAllRecords`
 * set probe. A DOUBLE, not a copy of production logic: service-storage does not
 * depend on plugin-security (it consults a duck-typed `AttachmentSharingLike`),
 * so the only way to pin the OUTCOME on this side of the seam is to model the
 * contract the gate is documented to be talking to. `setsWithBypass` names
 * which permission sets carry the bit in the modelled deployment.
 */
function hasWriteBypassDouble(context: any, setsWithBypass: string[]): boolean {
  if (context?.isSystem) return true;
  if (!context?.userId) return false;
  if (context?.onBehalfOf?.userId) return false; // documented fail-CLOSED on delegation
  // `resolvePermissionSetsForContext`: positions + explicit sets, plus the
  // ADDITIVE human baseline — which an ADR-0090 D10 agent principal must NOT
  // receive (its grants are exactly its scope-derived ceiling).
  const requested = [...(context?.positions ?? []), ...(context?.permissions ?? [])];
  const resolved =
    context?.principalKind === 'agent' ? requested : [...requested, DEPLOYMENT_BASELINE_SET];
  return resolved.some((name: string) => setsWithBypass.includes(name));
}

/**
 * `SharingService.checkEdit`'s positive bases, in order: ownership widened by
 * the middleware-stamped write DEPTH (`matchesOwnerScope` — `__writeScope ===
 * 'org'` short-circuits to true), then the `modifyAllRecords` bypass. The share
 * branch is omitted (no grants in these fixtures).
 */
function sharingCanEditDouble(opts: { ownerId: string; setsWithBypass?: string[] }) {
  return vi.fn(async (_object: string, _recordId: string, callerCtx: any) => {
    if (callerCtx?.isSystem) return true;
    if (!callerCtx?.userId) return false;
    if ((callerCtx as any).__writeScope === 'org') return true; // depth fast-exit
    if (String(callerCtx.userId) === opts.ownerId) return true;
    return hasWriteBypassDouble(callerCtx, opts.setsWithBypass ?? []);
  });
}

describe('#7145 — caller envelope forwarded to the sharing gate', () => {
  const attRow = {
    id: 'a1',
    file_id: 'f1',
    parent_object: 'att_secret',
    parent_id: 'r1',
    uploaded_by: 'someone_else',
  };

  // ── The forward itself, on BOTH call sites ────────────────────────────
  it('beforeInsert forwards the whole envelope MINUS the operation-private keys', async () => {
    const canEdit = vi.fn(async (_o: string, _r: string, _c: any) => true);
    const { beforeInsert } = install({ sharing: { canEdit } });
    await beforeInsert(
      envelopeInsertCtx({ parent_object: 'att_case', parent_id: 'r1', file_id: 'f1' }, {
        ...DELEGATED_ENVELOPE,
      }),
    );

    const forwarded = canEdit.mock.calls[0]![2] as unknown as Record<string, unknown>;
    // Every principal field survives — the #6523 contract's unit is the
    // envelope, and #6206 forbids rebuilding a subset of it. `uploaded_by`
    // stamping does not touch the context.
    expect(forwarded).toEqual(DELEGATED_PRINCIPAL_FIELDS);
    // …and every middleware-private key resolved for `sys_attachment` is gone.
    for (const key of OPERATION_PRIVATE_KEYS) expect(forwarded).not.toHaveProperty(key);
  });

  it('beforeDelete forwards the whole envelope MINUS the operation-private keys', async () => {
    const canEdit = vi.fn(async (_o: string, _r: string, _c: any) => true);
    const { beforeDelete } = install({ attachments: [attRow], sharing: { canEdit } });
    await beforeDelete(envelopeDeleteCtx({ id: 'a1' }, { ...DELEGATED_ENVELOPE }));

    const forwarded = canEdit.mock.calls[0]![2] as unknown as Record<string, unknown>;
    expect(forwarded).toEqual(DELEGATED_PRINCIPAL_FIELDS);
    for (const key of OPERATION_PRIVATE_KEYS) expect(forwarded).not.toHaveProperty(key);
  });

  it('hands the service a COPY, so a callee stamping its own depth cannot write back', async () => {
    const exec: Record<string, unknown> = { ...DELEGATED_ENVELOPE };
    const canEdit = vi.fn(async (_o: string, _r: string, callerCtx: any) => {
      // What plugin-security does right before it calls the sharing service.
      callerCtx.__writeScope = 'unit';
      return true;
    });
    const { beforeDelete } = install({ attachments: [attRow], sharing: { canEdit } });
    await beforeDelete(envelopeDeleteCtx({ id: 'a1' }, exec));

    expect(canEdit.mock.calls[0]![2]).not.toBe(exec);
    expect(exec.__writeScope).toBe('org'); // untouched: still sys_attachment's own
  });

  // ── What the restored fields BUY: the two verdict-deciding ones ───────
  it('REFUSES a delegated principal whose sets carry modifyAllRecords (fail-closed, #7145)', async () => {
    // The exploit shape the card names: an OAuth agent on the `/mcp` surface
    // presenting sets that carry the super-user write bypass. `hasWriteBypass`
    // is documented to fail CLOSED on `onBehalfOf` — it can only do that if the
    // field reaches it.
    const canEdit = sharingCanEditDouble({
      ownerId: 'other_owner',
      setsWithBypass: ['admin_full_access'],
    });
    const { beforeDelete } = install({ attachments: [attRow], sharing: { canEdit } });
    await expect(
      beforeDelete(
        envelopeDeleteCtx({ id: 'a1' }, {
          ...DELEGATED_ENVELOPE,
          permissions: ['admin_full_access'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED', status: 403 });
    expect(canEdit).toHaveBeenCalledTimes(1);
  });

  it('REFUSES the same delegated principal on the beforeInsert parent gate too', async () => {
    // Both `canEdit` call sites read the same `callerContext()`, so the guard
    // has to arrive on the attach path as well as the detach one.
    const canEdit = sharingCanEditDouble({
      ownerId: 'other_owner',
      setsWithBypass: ['admin_full_access'],
    });
    const { beforeInsert } = install({ sharing: { canEdit } });
    await expect(
      beforeInsert(
        envelopeInsertCtx({ parent_object: 'att_secret', parent_id: 'r1', file_id: 'f1' }, {
          ...DELEGATED_ENVELOPE,
          permissions: ['admin_full_access'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_PARENT_ACCESS', status: 403 });
    expect(canEdit).toHaveBeenCalledTimes(1);
  });

  it('keeps an AGENT principal capped at its ceiling — no additive human baseline (ADR-0090 D10)', async () => {
    // `resolvePermissionSetsForContext` keys that rule on `principalKind`, which
    // the old projection dropped: the agent was resolved as a human and the
    // deployment's default profile was appended to its consented ceiling.
    const canEdit = sharingCanEditDouble({
      ownerId: 'other_owner',
      setsWithBypass: [DEPLOYMENT_BASELINE_SET],
    });
    const { beforeDelete } = install({ attachments: [attRow], sharing: { canEdit } });
    await expect(
      beforeDelete(
        envelopeDeleteCtx({ id: 'a1' }, {
          ...DELEGATED_ENVELOPE,
          onBehalfOf: undefined, // isolate the ceiling rule from the delegation guard
        }),
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED', status: 403 });
  });

  // ── The half of the old projection that was CORRECT ───────────────────
  it("does NOT carry sys_attachment's access DEPTH into the parent's owner-match", async () => {
    // The context carries `__writeScope: 'org'` resolved for `sys_attachment`,
    // and the gate asks about `att_secret`. Forwarding it whole would widen one
    // object's question with another object's answer — a plain member would
    // detach any file on any record in the org.
    const canEdit = sharingCanEditDouble({ ownerId: 'other_owner' });
    const { beforeDelete } = install({ attachments: [attRow], sharing: { canEdit } });
    await expect(
      beforeDelete(
        envelopeDeleteCtx({ id: 'a1' }, {
          ...DELEGATED_ENVELOPE,
          principalKind: 'human',
          onBehalfOf: undefined,
          userId: 'plain_member',
          permissions: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED', status: 403 });
    expect((canEdit.mock.calls[0]![2] as any).__writeScope).toBeUndefined();
  });

  it('does not carry the depth into the beforeInsert parent gate either', async () => {
    const canEdit = sharingCanEditDouble({ ownerId: 'other_owner' });
    const { beforeInsert } = install({ sharing: { canEdit } });
    await expect(
      beforeInsert(
        envelopeInsertCtx({ parent_object: 'att_secret', parent_id: 'r1', file_id: 'f1' }, {
          ...DELEGATED_ENVELOPE,
          principalKind: 'human',
          onBehalfOf: undefined,
          userId: 'plain_member',
          permissions: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_PARENT_ACCESS', status: 403 });
    expect((canEdit.mock.calls[0]![2] as any).__writeScope).toBeUndefined();
  });

  // ── The session fallback, and the org name it reads (#9691) ───────────
  //
  // ⚠️ This case used to hand the hook a session spelling `tenantId: 'org_1'`
  // and assert the same key came back out. That is a session the engine cannot
  // produce: `HookContextSchema` STRIPS a `tenantId` key (#3290, pinned in
  // `packages/spec/src/data/hook.test.ts`) and `buildSession` only ever emits
  // `organizationId`. So the fixture pinned the removed-alias arm itself — it
  // passed for exactly as long as `callerContext` read the dead name, and could
  // only have started failing if the code became right, which is what happened.
  // Replaced rather than respelled: the fixture below is the envelope a real
  // transport builds.
  it('falls back to the session snapshot and reads the caller org under the BLESSED name (#9691)', async () => {
    const canEdit = vi.fn(async (_o: string, _r: string, _c: any) => true);
    const { beforeDelete } = install({ attachments: [attRow], sharing: { canEdit } });
    await beforeDelete({
      object: 'sys_attachment',
      event: 'beforeDelete',
      input: { id: 'a1' },
      // Exactly what `ObjectQLEngine.buildSession` emits.
      session: { userId: 'u1', organizationId: 'org_1', positions: ['p1'] },
      api: apiFor([]),
    });
    // `tenantId` on the way OUT is `ExecutionContext`'s driver-layer name for
    // the same value — the separate axis #3290 deliberately left alone.
    expect(canEdit.mock.calls[0]![2]).toEqual({ userId: 'u1', tenantId: 'org_1', positions: ['p1'] });
  });

  it('does not resurrect the removed `session.tenantId` alias if one ever reaches a hook (#9691)', async () => {
    const canEdit = vi.fn(async (_o: string, _r: string, _c: any) => true);
    const { beforeDelete } = install({ attachments: [attRow], sharing: { canEdit } });
    await beforeDelete({
      object: 'sys_attachment',
      event: 'beforeDelete',
      input: { id: 'a1' },
      // A key the schema strips. Reaching for it is how this seam handed the
      // sharing service an envelope with no org at all for several majors.
      session: { userId: 'u1', tenantId: 'stale_org', positions: ['p1'] } as any,
      api: apiFor([]),
    });
    expect((canEdit.mock.calls[0]![2] as any).tenantId).toBeUndefined();
  });
});
