// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — an install-local install connects the datasources the
// package declares and records them as code-defined, the way a boot of the
// package's artifact does (#28039).
//
// ## What was measured before the fix
//
// On `origin/main` `549203d0`, this file's install (a package declaring a
// managed sqlite datasource `qads_store` and an external one `qads_vault`
// whose `credentialsRef` names no secret, each with an object bound to it)
// answered `200` with `hotLoaded: true`, and then:
//
//   - `POST /data/qads_note` and `GET /data/qads_note` answered `404
//     OBJECT_NOT_FOUND` ("Object 'qads_note' is not registered"), and so did
//     `GET /data/qads_secret_row`: the install registered the objects and
//     nothing of their datasources, so no driver served them;
//   - the connection service held no verdict for either datasource, and the
//     host's code-datasource set held neither name.
//
// The boot path (`AppPlugin.start`) registers each declared datasource as
// code, records its name in the set and connects it through the connection
// service's `connectDeclared`; the install door did none of the three.
// Triage's ruling: the install connects and records through the same one
// helper, and where the credential cannot be resolved the datasource answers
// a named non-`ok` status, never a silent driver gap. ⛔ Where a code
// datasource's credential comes from is #27687's, and not decided here.
//
// ## What this file pins
//
//   1. the install answers each declared datasource's verdict: `qads_store`
//      connected, `qads_vault` a named failure whose reason names the
//      credential; both are registered in the metadata registry as code,
//      stamped with the package, and recorded in the code-datasource set;
//   2. a write and a read of the object bound to `qads_store` reach its
//      driver;
//   3. a read of the object bound to `qads_vault` answers `503
//      ERR_DATASOURCE_UNAVAILABLE` naming the datasource — not a 404;
//   4. the uninstall withdraws all of it, through its
//      `runtime.package-datasources` cleanup: no verdict, no metadata
//      registration, no name in the set;
//   5. a package declaring a datasource name another holder owns (the
//      boot's `showcase_external`, the host's `default`) is refused `409
//      RESOURCE_CONFLICT` before any write;
//   6. on a restart, the rehydrate connects the ledger's package again, as
//      code, and its bound object reads (`200`). The store is `:memory:`, so
//      the pin is that the read reaches a driver, not that a row survives.
//
// Boots fixture stacks of its own (the install-local plugin mounted), so it
// stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { bootShowcase } from './showcase-boot.js';

const ROUTE = '/marketplace/install-local';
const PACKAGE_ID = 'com.example.qads';
const STORE = 'qads_store';
const VAULT = 'qads_vault';
const NOTE = 'qads_note';
const SECRET_ROW = 'qads_secret_row';
const UNSET_REF = 'sys_secret:00000000-0000-0000-0000-000000000000';

/** A package declaring two datasources, each with an object bound to it. */
const INSTALL_BODY = {
  manifest: {
    id: PACKAGE_ID,
    namespace: 'qads',
    name: 'QA declared datasources',
    version: '1.0.0',
    type: 'app',
    datasources: [
      { name: STORE, label: 'QA store', driver: 'sqlite', config: { filename: ':memory:' } },
      {
        name: VAULT,
        label: 'QA vault',
        driver: 'postgres',
        schemaMode: 'external',
        config: { host: '127.0.0.1', port: 1, database: 'nowhere', user: 'nobody' },
        external: { credentialsRef: UNSET_REF, validation: { onMismatch: 'warn', checkOnBoot: false } },
      },
    ],
    objects: [
      { name: NOTE, label: 'QA note', datasource: STORE, fields: { title: { type: 'text', label: 'Title' } } },
      { name: SECRET_ROW, label: 'QA secret row', datasource: VAULT, external: {}, fields: { title: { type: 'text', label: 'Title' } } },
    ],
  },
};

/** A package whose one datasource takes a name `held` by someone else. */
function collidingBody(id: string, held: string) {
  return {
    manifest: {
      id,
      namespace: id.split('.').pop(),
      name: `QA collision ${held}`,
      version: '1.0.0',
      type: 'app',
      datasources: [{ name: held, label: 'Collides', driver: 'sqlite', config: { filename: ':memory:' } }],
    },
  };
}

type Answer = { status: number; body: any };
async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

interface ConnectionView {
  getConnectionState(name: string): { status: string; reason?: string } | undefined;
}

const codeNamesOf = (stack: VerifyStack): string[] =>
  (stack.kernel.getService('code-datasource-names') as { list(): string[] }).list();

describe('dogfood: an install-local install connects and records the package\'s declared datasources', () => {
  let stack: VerifyStack;
  let storageDir: string;
  let connection: ConnectionView;
  let metadata: { get(type: string, name: string): Promise<any> };

  let install: Answer;
  const states: Record<string, { status: string; reason?: string } | undefined> = {};
  const registered: Record<string, any> = {};
  let codeNames: string[];
  let write: Answer;
  let read: Answer;
  let readVault: Answer;
  let uninstall: Answer;
  const statesAfter: Record<string, unknown> = {};
  const registeredAfter: Record<string, unknown> = {};
  let codeNamesAfter: string[];
  const collisions: Record<string, Answer> = {};

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-ds-'));
    stack = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    connection = stack.kernel.getService('datasource-connection') as ConnectionView;
    metadata = stack.kernel.getService('metadata') as typeof metadata;
    const token = await stack.signIn();

    // ── collisions, before anything of this package's is installed ─────────
    collisions.showcase_external = await json(await stack.apiAs(token, 'POST', ROUTE, collidingBody('com.example.qadsc', 'showcase_external')));
    collisions.default = await json(await stack.apiAs(token, 'POST', ROUTE, collidingBody('com.example.qadsd', 'default')));

    // ── install ────────────────────────────────────────────────────────────
    install = await json(await stack.apiAs(token, 'POST', ROUTE, INSTALL_BODY));
    for (const name of [STORE, VAULT]) {
      states[name] = connection.getConnectionState(name);
      registered[name] = await metadata.get('datasource', name);
    }
    codeNames = codeNamesOf(stack);
    write = await json(await stack.apiAs(token, 'POST', `/data/${NOTE}`, { title: 'hello' }));
    read = await json(await stack.apiAs(token, 'GET', `/data/${NOTE}`));
    readVault = await json(await stack.apiAs(token, 'GET', `/data/${SECRET_ROW}`));

    // ── uninstall ──────────────────────────────────────────────────────────
    uninstall = await json(await stack.apiAs(token, 'DELETE', `${ROUTE}/${PACKAGE_ID}`));
    for (const name of [STORE, VAULT]) {
      statesAfter[name] = connection.getConnectionState(name);
      registeredAfter[name] = await metadata.get('datasource', name);
    }
    codeNamesAfter = codeNamesOf(stack);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('the install answers each declared datasource\'s verdict', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.hotLoaded).toBe(true);
    const verdicts = Object.fromEntries(
      (install.body?.data?.datasources ?? []).map((v: { name: string; status: string }) => [v.name, v.status]),
    );
    expect(verdicts[STORE]).toBe('connected');
    // The connection service's own name for a datasource it could not connect.
    expect(['failed-credentials', 'failed-degraded']).toContain(verdicts[VAULT]);
  });

  it('both are registered as code, stamped with the package, and recorded in the code-datasource set', () => {
    for (const name of [STORE, VAULT]) {
      expect(registered[name]?.origin, name).toBe('code');
      expect(registered[name]?._packageId, name).toBe(PACKAGE_ID);
      expect(registered[name]?._packageVersion, name).toBe('1.0.0');
    }
    expect(codeNames).toEqual(expect.arrayContaining([STORE, VAULT]));
  });

  it('a write and a read of the object bound to the connected datasource reach its driver', () => {
    expect(write.status, JSON.stringify(write.body)).toBe(201);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect((read.body?.records ?? []).map((r: { title?: string }) => r.title)).toEqual(['hello']);
  });

  it('the unresolved credential is a named non-ok verdict, and a bound read answers 503 naming the datasource', () => {
    expect(states[STORE]?.status).toBe('connected');
    expect(['failed-credentials', 'failed-degraded']).toContain(states[VAULT]?.status);
    expect(states[VAULT]?.reason).toContain(UNSET_REF);
    expect(readVault.status, JSON.stringify(readVault.body)).toBe(503);
    expect(readVault.body?.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
    expect(readVault.body?.datasource).toBe(VAULT);
  });

  it('the uninstall withdraws the verdicts, the registrations and the names, as its own cleanup', () => {
    expect(uninstall.status, JSON.stringify(uninstall.body)).toBe(200);
    const cleanups: Array<{ name: string; success: boolean; removed: number }> = uninstall.body?.data?.cleanups ?? [];
    expect(cleanups.filter((o) => o.success !== true)).toEqual([]);
    expect(cleanups.find((o) => o.name === 'runtime.package-datasources')).toEqual({
      name: 'runtime.package-datasources',
      success: true,
      removed: 2,
    });
    expect(statesAfter).toEqual({ [STORE]: undefined, [VAULT]: undefined });
    expect(registeredAfter).toEqual({ [STORE]: undefined, [VAULT]: undefined });
    expect(codeNamesAfter).not.toContain(STORE);
    expect(codeNamesAfter).not.toContain(VAULT);
    // CONTROL: the boot's own datasource is untouched.
    expect(codeNamesAfter).toContain('showcase_external');
  });

  it('a package declaring a datasource name another holder owns is refused 409 before any write', () => {
    for (const held of ['showcase_external', 'default']) {
      const answer = collisions[held];
      expect(answer.status, `${held}: ${JSON.stringify(answer.body)}`).toBe(409);
      expect(answer.body?.error?.code).toBe('RESOURCE_CONFLICT');
      expect(answer.body?.error?.details).toEqual({ datasource: held });
    }
    // Nothing of the refused packages reached the set or the connection service.
    expect(codeNames.filter((n) => n !== STORE && n !== VAULT).sort()).toEqual(['default', 'showcase_external']);
  });
});

describe('dogfood: the install-local rehydrate connects a ledgered package\'s declared datasources', () => {
  let storageDir: string;
  let installAnswer: Answer;
  let rehydrated: { state?: { status: string }; registered?: any; codeNames: string[]; read: Answer };

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-ds-rehydrate-'));
    const first = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    try {
      installAnswer = await json(await first.apiAs(await first.signIn(), 'POST', ROUTE, INSTALL_BODY));
    } finally {
      await first.stop();
    }

    const second = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    try {
      const connection = second.kernel.getService('datasource-connection') as ConnectionView;
      const metadata = second.kernel.getService('metadata') as { get(type: string, name: string): Promise<any> };
      rehydrated = {
        state: connection.getConnectionState(STORE),
        registered: await metadata.get('datasource', STORE),
        codeNames: codeNamesOf(second),
        read: await json(await second.apiAs(await second.signIn(), 'GET', `/data/${NOTE}`)),
      };
    } finally {
      await second.stop();
    }
  }, 300_000);

  afterAll(() => {
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('after a restart the package\'s datasource is connected, registered as code and recorded, and its object reads', () => {
    expect(installAnswer.status, JSON.stringify(installAnswer.body)).toBe(200);
    expect(rehydrated.state?.status).toBe('connected');
    expect(rehydrated.registered?.origin).toBe('code');
    expect(rehydrated.registered?._packageId).toBe(PACKAGE_ID);
    expect(rehydrated.codeNames).toEqual(expect.arrayContaining([STORE, VAULT]));
    expect(rehydrated.read.status, JSON.stringify(rehydrated.read.body)).toBe(200);
  });
});
