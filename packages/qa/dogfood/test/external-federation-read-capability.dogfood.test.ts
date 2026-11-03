// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Seeing a datasource's remote structure needs the read capability on every
// route, writes included — over HTTP on the stock showcase.
//
// The federation family (`/api/v1/datasources/:name/external/*`) answers remote
// structure on all five routes: the two read twins and validate as reads, and
// the two writes as what they return — `POST …/refresh-catalog` the catalog
// snapshot, `POST …/tables/:remote/import` the definition it generated from the
// remote table. Maintainer ruling, 2026-11-03 (verbatim: 「两个写接口同时要求读权限
// (Recommended)」): both writes require the read capability
// (`FEDERATION_READ_CAPABILITY`, `manage_platform_settings`) AND the write one
// (`FEDERATION_WRITE_CAPABILITY`, `manage_metadata`), and a caller lacking the
// read capability gets the read routes' own refusal there. The rule is
// `federationCapabilityRefusal` in `packages/rest/src/external-datasource-routes.ts`;
// the unit pins beside it drive the registrar over fakes. This file is the
// HTTP door on the composed stack, with grants an administrator authors at
// runtime and a real federated SQLite datasource behind it:
//
//   - a member holding `manage_metadata` alone is refused both writes with the
//     status and code `GET …/external/tables` answers it, and the refused
//     import leaves no object behind;
//   - a member holding both capabilities is served both writes — the refresh
//     returns the catalog, the import returns `201` and the object is saved —
//     so the refusals above are the capability's, not a broken route.
//
// The verify harness does not mount the federation service, so this file mounts
// `ExternalDatasourceServicePlugin` itself, as `objectstack dev` and `serve` do.
// The showcase's external datasource names a cwd-relative SQLite file, and every
// dogfood file runs in its own temporary working directory (`per-file-cwd.setup.ts`),
// so the remote tables `onEnable` provisions here are this file's own.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { onEnable } from '@objectstack/example-showcase';
import { ExternalDatasourceServicePlugin } from '@objectstack/service-datasource';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;

/** The showcase's external datasource and one of its remote tables (`external-fixture.ts`). */
const DATASOURCE = 'showcase_external';
const REMOTE = 'customers';

const TABLES = `/datasources/${DATASOURCE}/external/tables`;
const REFRESH = `/datasources/${DATASOURCE}/external/refresh-catalog`;
const importPath = (remote: string) => `/datasources/${DATASOURCE}/external/tables/${remote}/import`;

/** Two runtime-authored sets: the write capability alone, and both. No stock showcase set grants the first. */
const WRITE_ONLY_SET = 'federation_write_only_member';
const BOTH_SET = 'federation_read_write_member';
const WRITE_ONLY = 'federation-write-only@verify.test';
const BOTH = 'federation-read-write@verify.test';

/**
 * Object names the two imports ask for — prefixed with the showcase namespace,
 * which an import over `showcase_external` is held to.
 */
const REFUSED_IMPORT = 'showcase_fed_refused_cust';
const SERVED_IMPORT = 'showcase_fed_served_cust';

const errorOf = (json: any) => {
  const e = json?.error;
  return { code: e && typeof e === 'object' ? e.code : json?.code };
};

describe('seeing a datasource\'s remote structure needs the read capability on every route, writes included (showcase)', () => {
  let stack: VerifyStack;
  let admin: string;
  const tok: Record<string, string> = {};

  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  beforeAll(async () => {
    // Provision the remote tables, exactly as `os dev` does at boot (the
    // harness imports only the stack's default export, so `onEnable` never
    // runs on its own).
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootShowcase({ extraPlugins: [new ExternalDatasourceServicePlugin()] });
    admin = await stack.signIn();
    const ql: any = await stack.kernel.getServiceAsync('objectql');

    // Authored at runtime, the way an administrator authors a set.
    for (const [name, systemPermissions] of [
      [WRITE_ONLY_SET, ['manage_metadata']],
      [BOTH_SET, ['manage_metadata', 'manage_platform_settings']],
    ] as const) {
      const saved = await stack.apiAs(admin, 'PUT', `/meta/permission/${name}`, {
        name, label: name, objects: {}, systemPermissions: [...systemPermissions],
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
    }

    for (const [email, set] of [[WRITE_ONLY, WRITE_ONLY_SET], [BOTH, BOTH_SET]] as const) {
      tok[email] = await stack.signUp(email);
      const userId = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
      expect(userId, `${email} is provisioned`).toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: userId, permission_set: set }, { context: SYS });
    }
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the write capability alone is refused the refresh with the read routes\' status and code', async () => {
    const read = await call(tok[WRITE_ONLY], 'GET', TABLES);
    expect(read.status, JSON.stringify(read.json)).toBe(403);
    expect(errorOf(read.json).code).toBe('PERMISSION_DENIED');

    const refresh = await call(tok[WRITE_ONLY], 'POST', REFRESH);
    expect(refresh.status, JSON.stringify(refresh.json)).toBe(read.status);
    expect(errorOf(refresh.json).code).toBe(errorOf(read.json).code);
    expect(refresh.json?.data, 'a refused refresh answers no catalog').toBeUndefined();
  });

  it('the write capability alone is refused the import with the read routes\' status and code, and no object is saved', async () => {
    const read = await call(tok[WRITE_ONLY], 'GET', TABLES);
    expect(read.status, JSON.stringify(read.json)).toBe(403);

    const imported = await call(tok[WRITE_ONLY], 'POST', importPath(REMOTE), { name: REFUSED_IMPORT });
    expect(imported.status, JSON.stringify(imported.json)).toBe(read.status);
    expect(errorOf(imported.json).code).toBe(errorOf(read.json).code);
    expect(imported.json?.data, 'a refused import answers no definition').toBeUndefined();

    // Nothing persisted: the metadata door has no such object, read as the
    // admin. The control below reads its own import through the same door, so
    // this 404 is an absence the probe can see, not a probe that sees nothing.
    const stored = await call(admin, 'GET', `/meta/object/${REFUSED_IMPORT}`);
    expect(stored.status, JSON.stringify(stored.json)).toBe(404);
  });

  it('control: both capabilities are served the refresh, with the catalog, and the import, which is saved', async () => {
    const refresh = await call(tok[BOTH], 'POST', REFRESH);
    expect(refresh.status, JSON.stringify(refresh.json)).toBe(200);
    expect(refresh.json?.data?.catalog?.tables?.length, 'the refreshed catalog lists the remote tables').toBeGreaterThan(0);

    const imported = await call(tok[BOTH], 'POST', importPath(REMOTE), { name: SERVED_IMPORT });
    expect(imported.status, JSON.stringify(imported.json)).toBe(201);
    expect(imported.json?.data?.object?.name).toBe(SERVED_IMPORT);

    const stored = await call(admin, 'GET', `/meta/object/${SERVED_IMPORT}`);
    expect(stored.status, JSON.stringify(stored.json)).toBe(200);
  });
});
