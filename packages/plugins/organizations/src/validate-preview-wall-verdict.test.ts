// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25062] The write PREVIEW (`engine.validate()`, the import dry run) answers
 * a walled row's `organization_id` as the write does — on the real stack.
 *
 * ## The defect, as measured on `origin/main` f7d740376
 *
 * `validate()` runs no middleware, so the Layer 0 tenant write wall never
 * judged a preview row. Two cells disagreed with the write:
 *
 *   (a) an organization the wall ADMITS (a `group` member's sister
 *       organization, or an `isolated` member's own named explicitly): the
 *       write stores it as sent (`judgesOrganization`, #24822) and reports no
 *       drop, while the preview reported `organization_id` dropped;
 *   (b) an organization the wall REFUSES (an `isolated` member naming a
 *       foreign one): the write answers 403 `PERMISSION_DENIED`, while the
 *       preview answered valid.
 *
 * Ruling 6336640643 (letter A): `@objectstack/plugin-security` hands the
 * engine the wall's own verdict per row (`registerWriteWallVerdict`), from the
 * method its step 3.7 calls, and `validate()` reads that value and nothing
 * else.
 *
 * ## What is pinned
 *
 * Every case runs BOTH halves against one live stack (real `ObjectQL`, real
 * SQLite driver, the real `OrganizationsPlugin` and `SecurityPlugin`) and
 * asserts they agree: the preview's per-row answer against the write's
 * outcome, its drops and its stored row. The two cells; the caller-state
 * refusals (ADR-0123 D2, #24784) and the crossing operator's (#24821), which
 * the preview reaches by asking the wall again about the row its strip
 * changed; and three controls that must not move: the `single` posture, an
 * object the wall does not cover, and a composition with no wall registered.
 * The HTTP import door is pinned in `@objectstack/rest`'s
 * `import-dryrun-tenant-wall-parity.test.ts`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SecurityPlugin } from '@objectstack/plugin-security';
import type { PermissionSet } from '@objectstack/spec/security';
import { OrganizationsPlugin } from './organizations-plugin.js';

const OWN_ORG = 'org_alpha';
const FOREIGN_ORG = 'org_north';
const SISTER_ORG = 'org_south';
const LEDGER = 'qa_ledger';
const VAULT = 'qa_vault';
const NOTE = 'qa_note';

const FIELDS = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
};
const OBJECTS = [
  { name: LEDGER, label: 'Ledger', fields: FIELDS },
  // A private object: where a true platform operator crosses the wall (ADR-0095 D3).
  { name: VAULT, label: 'Vault', access: { default: 'private' }, fields: FIELDS },
  // An object the wall does not cover: no tenant column is injected.
  { name: NOTE, label: 'Note', tenancy: { enabled: false }, fields: FIELDS },
];

const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;
const PLATFORM_ADMIN: PermissionSet = {
  name: 'admin_full_access',
  label: 'Platform Administrator',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
  },
  systemPermissions: ['manage_platform_settings', 'manage_metadata'],
} as unknown as PermissionSet;

const SYS_CTX = { isSystem: true };
const MEMBER_CTX = { userId: 'usr_member', tenantId: OWN_ORG, positions: [], permissions: [], posture: 'MEMBER' };
const GROUP_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
const ORGLESS_CTX = { userId: 'usr_member', positions: [], permissions: [], posture: 'MEMBER' };
const GROUP_NO_ACTIVE_CTX = { ...ORGLESS_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
const ADMIN_NO_ORG_CTX = { userId: 'usr_admin', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' };

type Posture = 'isolated' | 'group' | 'single';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Booted {
  engine: ObjectQL;
  table: (object?: string) => Promise<Array<Record<string, unknown>>>;
}

/** `security: false` boots the organizations runtime alone: no wall, and no verdict registered. */
async function boot(posture: Posture, opts: { security?: boolean } = {}): Promise<Booted> {
  const engine = new ObjectQL();
  engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' } as never) as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.validate-preview-wall-verdict',
    name: 'The preview answers a walled row as the write does',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER, PLATFORM_ADMIN],
    },
    tenancy: { posture },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, service: unknown) => { services[name] = service; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    hook: vi.fn(),
  };
  const organizations = new OrganizationsPlugin({ ensureDefaultOrganization: false });
  await organizations.init(ctx as never);
  await organizations.start(ctx as never);
  if (opts.security !== false) {
    const security = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await security.init(ctx as never);
    await security.start(ctx as never);
  }
  vi.spyOn((engine as unknown as { logger: { warn: (m: unknown) => void } }).logger, 'warn').mockImplementation(() => {});

  await engine.insert(LEDGER, { id: 'r1', name: 'seeded', organization_id: OWN_ORG }, { context: SYS_CTX } as never);

  const table = async (object = LEDGER) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(object);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const columns = object === NOTE ? ['id'] : ['id', 'organization_id'];
    const rows = await knex(object).select(...columns);
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return { engine, table };
}

interface Outcome { ok: boolean; code?: string; status?: number; message?: string }
const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try { await run(); return { ok: true }; } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; message?: string };
    return { ok: false, code: err.code, status: err.statusCode ?? err.status, message: String(err.message ?? e) };
  }
};

/** The preview, then the write, of one row: what each answers, what the write drops, and what it stored. */
const previewThenWrite = async (b: Booted, row: Record<string, unknown>, context: object, object = LEDGER) => {
  const preview = await b.engine.validate(object, { ...row }, { mode: 'insert', context: context as never });
  const dropped: unknown[] = [];
  const write = await attempt(() => b.engine.insert(object, { ...row } as never, {
    context, onFieldsDropped: (e: unknown) => dropped.push(e),
  } as never));
  return { preview, row0: preview.results[0]!, write, dropped, stored: await b.table(object) };
};

const ORG_DROP = { object: LEDGER, fields: ['organization_id'], reason: 'readonly' };

describe('[#25062] cell (a): an organization the wall admits is stored as sent, and the preview reports no drop', () => {
  it('`group`: a sister organization', async () => {
    const b = await boot('group');
    const r = await previewThenWrite(b, { id: 'r2', name: 'n', organization_id: SISTER_ORG }, GROUP_CTX);

    expect(r.write).toEqual({ ok: true });
    expect(r.dropped).toEqual([]);
    expect(r.stored).toContainEqual({ id: 'r2', organization_id: SISTER_ORG });
    expect(r.row0).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('`isolated`: the active organization, named explicitly', async () => {
    const b = await boot('isolated');
    const r = await previewThenWrite(b, { id: 'r2', name: 'n', organization_id: OWN_ORG }, MEMBER_CTX);

    expect(r.write).toEqual({ ok: true });
    expect(r.dropped).toEqual([]);
    expect(r.row0).toEqual({ valid: true, errors: [], warnings: [] });
  });
});

describe('[#25062] cell (b): an organization the wall refuses is refused by the write, and the preview answers that refusal', () => {
  it('`isolated`: a foreign organization — the write\'s 403, its code and its message, under `organization_id`', async () => {
    const b = await boot('isolated');
    const r = await previewThenWrite(b, { id: 'r2', name: 'n', organization_id: FOREIGN_ORG }, MEMBER_CTX);

    expect(r.write).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(r.stored).toEqual([{ id: 'r1', organization_id: OWN_ORG }]);
    expect(r.preview.valid).toBe(false);
    expect(r.row0).toEqual({
      valid: false,
      errors: [{ field: 'organization_id', code: 'PERMISSION_DENIED', message: r.write.message }],
      warnings: [],
    });
  });

  it('`group`: an organization outside the membership set', async () => {
    const b = await boot('group');
    const r = await previewThenWrite(b, { id: 'r2', name: 'n', organization_id: FOREIGN_ORG }, GROUP_CTX);

    expect(r.write).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(r.row0.errors).toEqual([{ field: 'organization_id', code: 'PERMISSION_DENIED', message: r.write.message }]);
  });
});

describe('[#25062] a caller-state refusal is the write\'s too, under `_record`', () => {
  it('[ADR-0123 D2] `isolated`, a session with no active organization', async () => {
    const b = await boot('isolated');
    const r = await previewThenWrite(b, { id: 'r2', name: 'n' }, ORGLESS_CTX);

    expect(r.write).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(r.write.message).toContain('has no active organization');
    expect(r.row0.errors).toEqual([{ field: '_record', code: 'PERMISSION_DENIED', message: r.write.message }]);
  });

  it('[#24784] `group`, a member with a membership set and no active organization, a row naming none', async () => {
    const b = await boot('group');
    const r = await previewThenWrite(b, { id: 'r2', name: 'n' }, GROUP_NO_ACTIVE_CTX);

    expect(r.write).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(r.row0.errors).toEqual([{ field: '_record', code: 'PERMISSION_DENIED', message: r.write.message }]);
  });

  it('[#24821] a crossing operator with no active organization names one: the strip takes it, the stored row has nowhere to land, and both refuse', async () => {
    const b = await boot('isolated');
    const r = await previewThenWrite(b, { id: 'v1', name: 'n', organization_id: SISTER_ORG }, ADMIN_NO_ORG_CTX, VAULT);

    expect(r.write).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(r.write.message).toContain('has no active organization');
    expect(r.row0).toEqual({
      valid: false,
      errors: [{ field: '_record', code: 'PERMISSION_DENIED', message: r.write.message }],
      warnings: [],
    });
  });
});

describe('[#25062] controls: where the wall does not judge the row, nothing moves', () => {
  it('`single`: no wall — the strip takes the organization on the write and in the preview alike', async () => {
    const b = await boot('single');
    const r = await previewThenWrite(b, { id: 'r2', name: 'n', organization_id: FOREIGN_ORG }, MEMBER_CTX);

    expect(r.write).toEqual({ ok: true });
    expect(r.dropped).toEqual([ORG_DROP]);
    expect(r.row0).toEqual({ valid: true, errors: [], warnings: [], droppedFields: [ORG_DROP] });
  });

  it('an object the wall does not cover: a session with no active organization is admitted by both', async () => {
    const b = await boot('isolated');
    const r = await previewThenWrite(b, { id: 'n1', name: 'n' }, ORGLESS_CTX, NOTE);

    expect(r.write).toEqual({ ok: true });
    expect(r.stored).toEqual([{ id: 'n1' }]);
    expect(r.row0).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('no wall registered (the organizations runtime alone): the preview runs the strip the write runs', async () => {
    const b = await boot('isolated', { security: false });
    const r = await previewThenWrite(b, { id: 'r2', name: 'n', organization_id: FOREIGN_ORG }, MEMBER_CTX);

    expect(r.write).toEqual({ ok: true });
    expect(r.dropped).toEqual([ORG_DROP]);
    expect(r.row0).toEqual({ valid: true, errors: [], warnings: [], droppedFields: [ORG_DROP] });
  });
});
