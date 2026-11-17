// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An action body's insert is owner-stamped the way a direct create is.
 *
 * ## The defect this pins
 *
 * An action body's `ctx.api` runs the invoker's envelope elevated —
 * `{ ...envelope, isSystem: true }` with the `'action'` app-automation
 * elevation mark (`buildActionExecutionContext`, `@objectstack/runtime`) — and
 * the authorization middleware's `isSystem` bypass returned before step 3.5,
 * the empty-owner stamp. So a row the body inserted landed with `owner_id`
 * null, and on a private object its invoker could neither read it nor update
 * it: the read door answered not-found for the id the action had just
 * returned. A direct create by the same user was stamped.
 *
 * ## What is pinned
 *
 *  1. The repro: a non-admin invoker's body inserts into a private object; the
 *     row is owned by the invoker, who reads it by id and updates it. A direct
 *     create under the same envelope is the control.
 *  2. An `owner_id` the body sets itself is kept — another user's included: the
 *     body is trusted, elevated code, and no forge guard runs on it.
 *  3. The guest invoker: nothing is stamped (ADR-0138 D1).
 *  4. Delegation (ADR-0090 D10): the stamp names the principal a direct create
 *     under the same envelope is stamped with.
 *  5. Forge: nothing in the payload or in a client-spelt context steers the
 *     stamp. A context that SPELLS the mark as a string is not marked, and the
 *     elevations the stamp does not key on — a flow run, a hook's
 *     `runAs: 'system'`, a bare `isSystem` — land owner null exactly as before.
 *  6. A batch insert from a body: every row with an empty owner.
 *  7. A queue the body names parks the row as step 3.5 parks a trusted
 *     writer's (ADR-0142 D3): `owner_id` supplied empty beside the queue stays
 *     unset; an absent owner is stamped and the queue is the row's home queue.
 *
 * ## The rig
 *
 * The real `SecurityPlugin` over a real `ObjectQL` and SQL driver
 * (better-sqlite3, in memory), the real `SharingService` as the kernel's
 * `sharing` service with its middleware after this plugin's, and the
 * platform's `member_default` set — the `controlled-by-parent-owner-may-edit`
 * rig. The private object declares no owner column: the registry injects
 * `owner_id` (and the ownership-queue column) as it does for every user-owned
 * object. The body's `ctx.api` is `engine.createContext(context)`, the call
 * `buildActionApi` makes, over the context `buildActionExecutionContext`
 * builds: the envelope spread, `isSystem: true`, and the `'action'` mark.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { markAppAutomationElevation } from '@objectstack/core';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const NOTE = 'abo_note';
const ORG = 'org_abo';
/** The invoker: a non-admin member who creates, reads and edits the rows it owns. */
const ME = 'usr_abo_invoker';
/** Someone else: owns nothing the invoker can see. */
const OTHER = 'usr_abo_other';
/** The agent principal acting for {@link DELEGATOR} (ADR-0090 D10). */
const AGENT = 'usr_abo_agent';
const DELEGATOR = 'usr_abo_delegator';

const WRITER_SET = PermissionSetSchema.parse({
  name: 'abo_writer',
  objects: { [NOTE]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
});
const SETS = [MEMBER_DEFAULT, WRITER_SET];

/** The envelope `resolveAuthzContext` hands the middleware for an organization member holding the writer set. */
const memberOf = (userId: string) => ({
  userId,
  tenantId: ORG,
  positions: ['org_member'],
  permissions: [WRITER_SET.name, 'member_default'],
  posture: 'MEMBER',
});
const INVOKER = memberOf(ME);
const GUEST = { principalKind: 'guest', tenantId: ORG, positions: [], permissions: ['member_default'] };
const DELEGATED = { ...memberOf(AGENT), onBehalfOf: { userId: DELEGATOR } };

/** What `buildActionExecutionContext` (runtime) builds from an envelope. */
const actionBody = (envelope: object) => markAppAutomationElevation({ ...envelope, isSystem: true }, 'action');

type Row = Record<string, unknown>;

let engine: ObjectQL;
let seq = 0;
const nextId = (tag: string) => `abo_${tag}_${++seq}`;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.action-body-insert-owner-stamp',
    name: 'An action body insert is owner-stamped like a direct create',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysRecordShare,
      SysUser,
      SysOrganization,
      SysMember,
      SysUserPosition,
      SysUserPermissionSet,
      {
        name: NOTE,
        label: 'Note',
        sharingModel: 'private',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await engine.insert('sys_user', [ME, OTHER, AGENT, DELEGATOR].map((id) => ({ id, name: id, email: `${id}@abo.test` })), SYS);
  await engine.insert('sys_organization', [{ id: ORG, name: 'ABO', slug: 'abo' }], SYS);

  let securityService: unknown;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? SETS.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => SETS,
    },
    get sharing() { return sharing; },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { if (name === 'security') securityService = svc; },
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  wireEngineSecuritySource(engine, () => plugin);
  sharing = new SharingService({ engine: engine as never, securityService: () => securityService as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

/** The body's `ctx.api` insert under `context`, as `buildActionApi` builds it. */
const bodyInsert = (context: object, data: Row | Row[]) =>
  (engine as any).createContext(context).object(NOTE).insert(data);
/** The stored row, read past every gate. */
const stored = async (id: string): Promise<Row | null> =>
  ((await engine.findOne(NOTE, { where: { id }, context: { isSystem: true } } as never)) ?? null) as Row | null;
/** The caller's own by-id read, as the data door issues it. */
const readAs = async (context: object, id: string): Promise<Row | null> =>
  ((await engine.findOne(NOTE, { where: { id }, context } as never)) ?? null) as Row | null;

describe('the schema the suite runs on', () => {
  it('the private object carries the injected owner and queue columns', () => {
    const fields = Object.keys((engine.getSchema(NOTE) as { fields: Record<string, unknown> }).fields);
    expect(fields).toContain('owner_id');
    expect(fields).toContain('queue');
  });
});

describe('an action body insert on a private object (the repro)', () => {
  it('is owned by the invoker, who reads it by id and updates it', async () => {
    const id = nextId('repro');
    await bodyInsert(actionBody(INVOKER), { id, name: 'filed by the action' });

    expect((await stored(id))?.owner_id).toBe(ME);
    expect((await readAs(INVOKER, id))?.id).toBe(id);
    await engine.update(NOTE, { name: 'edited by the invoker' }, { where: { id }, context: { ...INVOKER } } as never);
    expect((await stored(id))?.name).toBe('edited by the invoker');
  });

  it('is owned exactly as the same envelope’s direct create is (the control)', async () => {
    const direct = nextId('direct');
    const body = nextId('body');
    await engine.insert(NOTE, { id: direct, name: 'direct' }, { context: { ...INVOKER } } as never);
    await bodyInsert(actionBody(INVOKER), { id: body, name: 'body' });

    expect((await stored(direct))?.owner_id).toBe(ME);
    expect((await stored(body))?.owner_id).toBe((await stored(direct))?.owner_id);
  });

  it('stamps an owner the body supplies EMPTY (null and the empty string)', async () => {
    const asNull = nextId('null');
    const asEmpty = nextId('empty');
    await bodyInsert(actionBody(INVOKER), { id: asNull, name: 'n', owner_id: null });
    await bodyInsert(actionBody(INVOKER), { id: asEmpty, name: 'e', owner_id: '' });

    expect((await stored(asNull))?.owner_id).toBe(ME);
    expect((await stored(asEmpty))?.owner_id).toBe(ME);
  });
});

describe('an owner the body sets itself is kept', () => {
  it('another user’s id lands as written, with no forge refusal', async () => {
    const id = nextId('theirs');
    await bodyInsert(actionBody(INVOKER), { id, name: 'for someone else', owner_id: OTHER });

    expect((await stored(id))?.owner_id).toBe(OTHER);
    // The invoker does not own it, so the private object hides it from them.
    expect(await readAs(INVOKER, id)).toBeNull();
  });

  it('the invoker’s own id lands as written', async () => {
    const id = nextId('mine');
    await bodyInsert(actionBody(INVOKER), { id, name: 'for me', owner_id: ME });

    expect((await stored(id))?.owner_id).toBe(ME);
  });
});

describe('the guest invoker (ADR-0138 D1)', () => {
  it('is stamped with nothing: an absent or empty owner stays unset', async () => {
    const absent = nextId('guest_absent');
    const empty = nextId('guest_empty');
    await bodyInsert(actionBody(GUEST), { id: absent, name: 'a' });
    await bodyInsert(actionBody(GUEST), { id: empty, name: 'e', owner_id: '' });

    expect((await stored(absent))?.owner_id ?? null).toBeNull();
    expect((await stored(empty))?.owner_id ?? null).toBeNull();
  });
});

describe('delegation (ADR-0090 D10)', () => {
  it('stamps the principal a direct create under the same envelope is stamped with', async () => {
    const id = nextId('delegated');
    await bodyInsert(actionBody(DELEGATED), { id, name: 'by the agent' });

    // Step 3.5's own reading for the same envelope, through the middleware
    // that stamps a direct create: the envelope's `userId`, the agent.
    const direct = { name: 'direct, delegated' } as Row;
    await stampedByDirectCreate(DELEGATED, direct);

    expect(direct.owner_id).toBe(AGENT);
    expect((await stored(id))?.owner_id).toBe(direct.owner_id);
  });
});

describe('forge: nothing a client sends steers the stamp', () => {
  it('a client-spelt context is not the body’s elevation: no stamp, and no other user', async () => {
    // Everything a request body can carry, the mark's own name included as a
    // string key: JSON has no symbols, so this context is not marked.
    const spelt = JSON.parse(JSON.stringify({
      ...INVOKER,
      userId: OTHER,
      isSystem: true,
      'objectstack.core.appAutomationElevation': 'action',
      appAutomationElevation: 'action',
    }));
    const id = nextId('spelt');
    await bodyInsert(spelt, { id, name: 'spelt' });

    expect((await stored(id))?.owner_id ?? null).toBeNull();
  });

  it('a payload naming another creator does not change who is stamped', async () => {
    const id = nextId('payload');
    await bodyInsert(actionBody(INVOKER), { id, name: 'payload', created_by: OTHER });

    expect((await stored(id))?.owner_id).toBe(ME);
  });

  it.each([
    ['a flow run (isSystem with a flowRunId)', { ...INVOKER, isSystem: true, flowRunId: 'run_abo_1' }],
    ['a flow run reaching an action (the flow wins over the mark)', { ...actionBody(INVOKER), flowRunId: 'run_abo_2' }],
    ["a hook's runAs: 'system'", markAppAutomationElevation({ ...INVOKER, isSystem: true }, 'hook')],
    ['a bare isSystem carrying a user', { ...INVOKER, isSystem: true }],
    ['a bare isSystem', { isSystem: true }],
  ])('%s still lands owner null (unchanged)', async (_name, context) => {
    const id = nextId('control');
    await bodyInsert(context, { id, name: 'control' });

    expect((await stored(id))?.owner_id ?? null).toBeNull();
  });
});

describe('a batch insert from a body', () => {
  it('stamps every row whose owner is empty and keeps the one the body set', async () => {
    const ids = [nextId('b1'), nextId('b2'), nextId('b3'), nextId('b4')];
    await bodyInsert(actionBody(INVOKER), [
      { id: ids[0], name: 'one' },
      { id: ids[1], name: 'two', owner_id: OTHER },
      { id: ids[2], name: 'three', owner_id: null },
      { id: ids[3], name: 'four' },
    ]);

    const owners = await Promise.all(ids.map(async (id) => (await stored(id))?.owner_id));
    expect(owners).toEqual([ME, OTHER, ME, ME]);
  });
});

describe('a queue the body names (ADR-0142 D3)', () => {
  it('parks the row when the body supplies the owner empty beside the queue', async () => {
    const id = nextId('parked');
    await bodyInsert(actionBody(INVOKER), { id, name: 'parked', queue: 'abo_intake', owner_id: null });

    const row = await stored(id);
    expect(row?.queue).toBe('abo_intake');
    expect(row?.owner_id ?? null).toBeNull();
  });

  it('stamps the invoker when the owner is absent: the queue is the home queue', async () => {
    const id = nextId('homed');
    await bodyInsert(actionBody(INVOKER), { id, name: 'homed', queue: 'abo_intake' });

    const row = await stored(id);
    expect(row?.queue).toBe('abo_intake');
    expect(row?.owner_id).toBe(ME);
  });
});

/**
 * The owner a DIRECT create under `envelope` is stamped with, read off the
 * row the middleware chain hands the driver: the engine's own insert under
 * the envelope, its stored row's owner copied back onto `row`. Under
 * delegation the direct create is refused further down the chain on this
 * rig (the delegator holds no membership), so the stamp is read where step
 * 3.5 writes it — on the payload — through a middleware registered after
 * the security plugin's.
 */
async function stampedByDirectCreate(envelope: object, row: Row): Promise<void> {
  const tag = `abo_probe_${++seq}`;
  let seen: unknown;
  let armed = true;
  engine.registerMiddleware((async (opCtx: any, next: () => Promise<void>) => {
    if (armed && opCtx.operation === 'insert' && opCtx.object === NOTE && opCtx.data?.name === tag) {
      seen = opCtx.data.owner_id;
      armed = false;
      throw new Error('probe: stop before the write');
    }
    return next();
  }) as never, { object: NOTE });
  await engine.insert(NOTE, { name: tag }, { context: { ...envelope } } as never).catch(() => undefined);
  armed = false;
  row.owner_id = seen;
}
