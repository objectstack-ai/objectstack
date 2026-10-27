// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26597] A field a permission set has NO entry for is constrained only by the
 * set's object grant — measured through a real `ObjectQL` over a real SQL
 * driver, with the real `SecurityPlugin` middleware in front of it.
 *
 * `FieldPermissionSchema`'s defaults (`readable: true`, `editable: false`) are
 * the defaults of an entry that EXISTS. A field the set does not name passes
 * the field write gate and the read mask (`FieldMasker.detectForbiddenWrites` /
 * `maskResults`: "Fields without a permission entry pass through"; ADR-0066 ⑧),
 * so the object grant decides.
 *
 * This is the runtime half of a pair. Studio's field-permission editor draws a
 * field row from the same table (`fieldRuleCell` in `@object-ui/app-shell`'s
 * metadata-admin `permission-slice.ts`, pinned by its
 * `permission-slice.fieldRule-26597.test.ts`): change the two together.
 *
 * The table: three field rules (no entry / read-only entry / editable entry) on
 * two objects (one whose object grant includes Edit, one without), each written
 * by a caller holding ONLY this set.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const EDIT_ON = 'qa_fr_edit_on';
const EDIT_OFF = 'qa_fr_edit_off';
const SET = 'qa_fr_editor';
const CALLER = { userId: 'usr_fr_member', positions: [], permissions: [SET], posture: 'MEMBER' };

/** The field each rule is declared on, per object. */
const FIELD_FOR = { absent: 'notes', readOnly: 'locked', editable: 'open' } as const;
type Rule = keyof typeof FIELD_FOR;

/**
 * May a holder of this set ALONE edit the field? Studio's editor draws exactly
 * this (`RUNTIME_EDIT_VERDICT` in `permission-slice.fieldRule-26597.test.ts`).
 */
const EDIT_VERDICT: Record<string, Record<Rule, boolean>> = {
  [EDIT_ON]: { absent: true, readOnly: false, editable: true },
  [EDIT_OFF]: { absent: false, readOnly: false, editable: false },
};

interface Refusal { code?: string; status?: number; details?: { forbiddenFields?: string[] } }
type Outcome = { kind: 'landed' } | ({ kind: 'refused' } & Refusal);

interface Rig {
  engine: ObjectQL;
  update: (object: string, data: Record<string, unknown>) => Promise<Outcome>;
  stored: (object: string) => Promise<Record<string, unknown> | null>;
  teardown: () => Promise<void>;
}
const rigs: Rig[] = [];
afterEach(async () => {
  for (const rig of rigs.splice(0)) await rig.teardown();
});

function outcome(p: Promise<unknown>): Promise<Outcome> {
  return p.then(
    () => ({ kind: 'landed' as const }),
    (e: any) => ({ kind: 'refused' as const, code: e?.code, status: e?.statusCode ?? e?.status, details: e?.details }),
  );
}

const objectFields = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
  notes: { name: 'notes', type: 'text' },
  locked: { name: 'locked', type: 'text' },
  open: { name: 'open', type: 'text' },
};

async function boot(): Promise<Rig> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.field-rule-object-grant',
    name: 'Field rule: a field without an entry follows the object grant',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      { name: EDIT_ON, label: 'Edit granted', sharingModel: 'public_read_write', fields: objectFields },
      { name: EDIT_OFF, label: 'Edit not granted', sharingModel: 'public_read_write', fields: objectFields },
    ],
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  const row = { id: 'r1', name: 'row', notes: 'n0', locked: 'l0', open: 'o0' };
  await engine.insert(EDIT_ON, [row], SYS);
  await engine.insert(EDIT_OFF, [row], SYS);

  const set = PermissionSetSchema.parse({
    name: SET,
    objects: {
      [EDIT_ON]: { allowRead: true, allowCreate: true, allowEdit: true },
      [EDIT_OFF]: { allowRead: true, allowCreate: true },
    },
    // No entry for `notes` on either object.
    fields: {
      [`${EDIT_ON}.locked`]: { readable: true, editable: false },
      [`${EDIT_ON}.open`]: { readable: true, editable: true },
      [`${EDIT_OFF}.locked`]: { readable: true, editable: false },
      [`${EDIT_OFF}.open`]: { readable: true, editable: true },
    },
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);

  const rig: Rig = {
    engine,
    update: (object, data) => outcome(engine.update(object, data, { where: { id: 'r1' }, context: { ...CALLER } } as never)),
    stored: async (object) =>
      ((await engine.findOne(object, { where: { id: 'r1' }, context: { isSystem: true } } as never)) ?? null) as Record<string, unknown> | null,
    teardown: async () => { try { await engine.destroy(); } catch { /* noop */ } },
  };
  rigs.push(rig);
  return rig;
}

describe('a field without an entry follows the object grant (#26597)', () => {
  for (const object of [EDIT_ON, EDIT_OFF]) {
    for (const rule of ['absent', 'readOnly', 'editable'] as const) {
      const field = FIELD_FOR[rule];
      const allowed = EDIT_VERDICT[object][rule];
      it(`${object} × ${rule}: an update naming the field is ${allowed ? 'written' : 'refused'}`, async () => {
        const r = await boot();
        const got = await r.update(object, { [field]: 'changed' });
        if (allowed) {
          expect(got).toEqual({ kind: 'landed' });
          expect((await r.stored(object))?.[field]).toBe('changed');
          return;
        }
        expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
        // On the Edit-granting object the refusal is the FIELD gate's, naming the field.
        if (object === EDIT_ON) expect(got).toMatchObject({ details: { forbiddenFields: [field] } });
        // Refused means untouched.
        expect((await r.stored(object))?.[field]).not.toBe('changed');
      });
    }
  }

  it('a field without an entry is served on read wherever the object grants Read', async () => {
    const r = await boot();
    for (const object of [EDIT_ON, EDIT_OFF]) {
      const seen = (await r.engine.findOne(object, { where: { id: 'r1' }, context: { ...CALLER } } as never)) as Record<string, unknown> | null;
      expect(seen?.notes).toBe('n0');
    }
  });
});
