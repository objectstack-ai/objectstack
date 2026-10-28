// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0066 D2] Which object entry a permission set applies to an object,
 * measured through a real `ObjectQL` over a real SQL driver, with the real
 * `SecurityPlugin` middleware in front of it — the object's `access.default`
 * read from the registered object, as the middleware reads it.
 *
 * `resolveObjectPermission` (permission-evaluator.ts) returns ONE entry per
 * (set, object) and never merges two:
 *
 *  - the object's own entry, when the set has one (an empty entry included);
 *  - else the set's `'*'` entry, for an object that is not `private`;
 *  - for a `private` object, the `'*'` entry only when it carries
 *    `viewAllRecords` / `modifyAllRecords`;
 *  - else nothing.
 *
 * This is the runtime half of a pair. Studio's permission matrix draws an
 * object row from the same table (`objectRuleCell` in `@object-ui/app-shell`'s
 * metadata-admin `permission-slice.ts`, pinned by its
 * `permission-slice.objectGrant-27010.test.ts`, whose `RUNTIME` table is this
 * file's `VERDICT`): change the two together.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const PUBLIC_OBJECT = 'qa_og_public';
const PRIVATE_OBJECT = 'qa_og_private';
type Posture = 'public' | 'private';
const OBJECT_FOR: Record<Posture, string> = { public: PUBLIC_OBJECT, private: PRIVATE_OBJECT };

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const SUPER = { ...CRUD, viewAllRecords: true, modifyAllRecords: true };

/** The sets of the table, named as the Studio pin names them. */
const SETS: Record<string, Record<string, Record<string, boolean>>> = {
  wildcard: { '*': CRUD },
  superWildcard: { '*': SUPER },
  wildcardAndReadOnlyEntry: { '*': CRUD, [PUBLIC_OBJECT]: { allowRead: true }, [PRIVATE_OBJECT]: { allowRead: true } },
  wildcardAndEmptyEntry: { '*': CRUD, [PUBLIC_OBJECT]: {}, [PRIVATE_OBJECT]: {} },
  noWildcard: { qa_og_other: CRUD },
};

/**
 * May a holder of this set ALONE read / edit a record of the object? Studio's
 * matrix draws exactly this (`RUNTIME` in `permission-slice.objectGrant-27010.test.ts`).
 */
const VERDICT: Record<string, Record<Posture, { read: boolean; edit: boolean }>> = {
  wildcard: { public: { read: true, edit: true }, private: { read: false, edit: false } },
  superWildcard: { public: { read: true, edit: true }, private: { read: true, edit: true } },
  wildcardAndReadOnlyEntry: { public: { read: true, edit: false }, private: { read: true, edit: false } },
  wildcardAndEmptyEntry: { public: { read: false, edit: false }, private: { read: false, edit: false } },
  noWildcard: { public: { read: false, edit: false }, private: { read: false, edit: false } },
};

const setName = (shape: string) => `qa_og_${shape.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
const callerHolding = (shape: string) => ({
  userId: 'usr_og_member',
  positions: [],
  permissions: [setName(shape)],
  posture: 'MEMBER',
});

interface Refusal { code?: string; status?: number }
type Outcome = { kind: 'landed'; value?: unknown } | ({ kind: 'refused' } & Refusal);

function outcome(p: Promise<unknown>): Promise<Outcome> {
  return p.then(
    (value) => ({ kind: 'landed' as const, value }),
    (e: any) => ({ kind: 'refused' as const, code: e?.code, status: e?.statusCode ?? e?.status }),
  );
}

const objectFields = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
};

let engine: ObjectQL;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.object-grant-wildcard',
    name: "Object grant: a set's own entry, else its '*' entry where it applies",
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      { name: PUBLIC_OBJECT, label: 'Public object', sharingModel: 'public_read_write', fields: objectFields },
      {
        name: PRIVATE_OBJECT,
        label: 'Private object',
        sharingModel: 'public_read_write',
        access: { default: 'private' },
        fields: objectFields,
      },
    ],
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const object of [PUBLIC_OBJECT, PRIVATE_OBJECT]) {
    await engine.insert(object, [{ id: 'r1', name: 'row' }], SYS);
  }

  const sets = Object.entries(SETS).map(([shape, objects]) =>
    PermissionSetSchema.parse({ name: setName(shape), objects }),
  );
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, ...sets],
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
});

afterAll(async () => {
  try { await engine.destroy(); } catch { /* noop */ }
});

const stored = async (object: string) =>
  ((await engine.findOne(object, { where: { id: 'r1' }, context: { isSystem: true } } as never)) ?? null) as
    | Record<string, unknown>
    | null;

describe("a set applies its own object entry, else its '*' entry where it applies (ADR-0066 D2)", () => {
  for (const [shape, byPosture] of Object.entries(VERDICT)) {
    for (const posture of ['public', 'private'] as const) {
      const object = OBJECT_FOR[posture];
      const want = byPosture[posture];

      it(`${shape} × ${posture} object: a read is ${want.read ? 'served' : 'refused'}`, async () => {
        const got = await outcome(
          engine.findOne(object, { where: { id: 'r1' }, context: callerHolding(shape) } as never),
        );
        if (want.read) {
          expect(got).toMatchObject({ kind: 'landed', value: { id: 'r1' } });
          return;
        }
        expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      });

      it(`${shape} × ${posture} object: an update is ${want.edit ? 'written' : 'refused'}`, async () => {
        const value = `${shape}-${posture}`;
        const got = await outcome(
          engine.update(object, { name: value }, { where: { id: 'r1' }, context: callerHolding(shape) } as never),
        );
        if (want.edit) {
          expect(got).toMatchObject({ kind: 'landed' });
          expect((await stored(object))?.name).toBe(value);
          return;
        }
        expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
        // Refused means untouched.
        expect((await stored(object))?.name).not.toBe(value);
      });
    }
  }
});
