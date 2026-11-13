// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — a connector an install-local package declares is live
// again after the runtime restarts on the same install ledger.
//
// ## What was measured before the fix
//
// Two showcase boots over one install-ledger directory. The first boot
// installed an inline manifest declaring a provider-bound `openapi` connector
// whose `providerConfig.spec` is an INLINE document, plus one flow. The
// connector was listed `ready` on `GET /automation/connectors`. After the
// second boot, `GET /marketplace/install-local` listed the package and the
// engine served its flow (`GET /automation/NAME` 200), but the connector was
// absent from `GET /automation/connectors`.
//
// Flows survive because the engine binds them in its own `kernel:ready`
// handler, from the protocol's flow view, and the install-local rehydrate
// registers the ledger's packages in an earlier `kernel:ready` handler.
// Declared connectors are reconciled only in `start()`, before
// `kernel:ready`, and again on `metadata:reloaded` — and the rehydrate
// announced no reload, so nothing read the rehydrated connector entries.
//
// ## What this file pins
//
//   1. before the restart (precondition): the install answers 200 and the
//      connector is listed `ready` with the document's one operation;
//   2. after the restart: the package is listed by the install-local GET;
//   3. after the restart: the connector is listed `ready` with the same
//      operation;
//   4. after the restart: the package's flow is served by the engine;
//   5. after the restart: a connector the HOST declares (the showcase's
//      `showcase_status_openapi`) is still listed (control).
//
// Boots fixture stacks of its own (the install-local plugin mounted), so it
// stays out of `SHARED_SHOWCASE`.
//
// ## Second describe: the flows, with the plugin order `objectstack dev` boots
//
// Measured on a real `objectstack dev` restart of the showcase over a file DB
// before the fix: the package was listed and its objects served, but its flow
// answered 404 on the trigger door and `registration.state: unregistered`.
// The engine's `kernel:ready` bind sees a rehydrated package only when the
// install-local plugin starts before the automation plugin, and the showcase
// lists `MarketplaceInstallLocalPlugin` in its own `plugins` AFTER the
// connector plugins, each of which declares a dependency on the automation
// plugin, so the kernel starts the automation plugin first and the rehydrate
// runs after the bind. The first describe mounts install-local through
// `extraPlugins`, which `bootStack` mounts before the app's plugins, so it
// never met that order. The second describe mounts it where the showcase
// lists it, and pins:
//
//   1. (precondition) the boot's composition lists install-local after a
//      plugin that depends on the automation plugin;
//   2. (precondition) the install answers 200, hot-loaded, and the flow
//      triggers by name before the restart;
//   3. after the restart: the package is listed;
//   4. after the restart: the flow triggers by name (200);
//   5. after the restart: the flow's metadata reads `registration.state:
//      registered`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import showcaseStack from '@objectstack/example-showcase';
import { bootShowcase } from './showcase-boot.js';

const ROUTE = '/marketplace/install-local';
const PACKAGE_ID = 'com.dogfood.restartconn';
const CONNECTOR = 'rstconn_fixture';
const FLOW = 'rstconn_manual_probe';
const HOST_CONNECTOR = 'showcase_status_openapi';
/** A one-operation OpenAPI 3 document; nothing is dispatched, so its server answers nothing. */
const DOCUMENT = {
  openapi: '3.0.3',
  info: { title: 'Restart connector fixture', version: '1.0.0' },
  servers: [{ url: 'http://127.0.0.1:9/' }],
  paths: { '/v1/things': { get: { operationId: 'GetThings', responses: { '200': { description: 'ok' } } } } },
};

const INSTALL_BODY = {
  manifest: {
    id: PACKAGE_ID,
    namespace: 'rstconn',
    name: 'Restart connector probe',
    version: '0.1.0',
    type: 'app',
    connectors: [
      { name: CONNECTOR, label: 'Fixture', type: 'api', provider: 'openapi', providerConfig: { spec: DOCUMENT } },
    ],
    flows: [
      {
        name: FLOW,
        label: 'Restart probe (run by name)',
        type: 'autolaunched',
        status: 'active',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    ],
  },
};

type Answer = { status: number; body: any };

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

const listed = (answer: Answer, name: string): any =>
  (answer.body?.data?.connectors ?? []).find((c: any) => c?.name === name);

const names = (answer: Answer): unknown => answer.body?.data?.connectors?.map((c: any) => c?.name);

/** Read the connector listing until `name` is in it, or the window closes. */
async function readConnectors(stack: VerifyStack, token: string, name: string): Promise<Answer> {
  let answer: Answer;
  const deadline = Date.now() + 10_000;
  do {
    answer = await json(await stack.apiAs(token, 'GET', '/automation/connectors'));
    if (listed(answer, name)) break;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < deadline);
  return answer;
}

describe('dogfood: an install-local package\'s connector is live again after a restart on the same ledger', () => {
  let storageDir: string;
  let install: Answer;
  let before: Answer;
  let packages: Answer;
  let after: Answer;
  let flowAfter: Answer;
  let bootError: unknown;

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-restart-conn-'));
    const first = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    try {
      const token = await first.signIn();
      install = await json(await first.apiAs(token, 'POST', ROUTE, INSTALL_BODY));
      before = await readConnectors(first, token, CONNECTOR);
    } finally {
      await first.stop();
    }

    let second: VerifyStack | undefined;
    try {
      second = await bootShowcase({
        extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
      });
    } catch (err) {
      bootError = err;
      return;
    }
    try {
      const token = await second.signIn();
      packages = await json(await second.apiAs(token, 'GET', ROUTE));
      after = await readConnectors(second, token, CONNECTOR);
      flowAfter = await json(await second.apiAs(token, 'GET', `/automation/${FLOW}`));
    } finally {
      await second.stop();
    }
  }, 300_000);

  afterAll(() => {
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('before the restart, the install lists the connector ready (precondition)', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.hotLoaded).toBe(true);
    const entry = listed(before, CONNECTOR);
    expect(entry, JSON.stringify(names(before))).toBeDefined();
    expect(entry.state).toBe('ready');
    expect(entry.actions.map((a: any) => a.key)).toEqual(['GetThings']);
  });

  it('the second boot over the same ledger succeeds and lists the package', () => {
    expect(bootError).toBeUndefined();
    expect(packages.status, JSON.stringify(packages.body)).toBe(200);
    const item = (packages.body?.data?.items ?? []).find((i: any) => i?.manifestId === PACKAGE_ID);
    expect(item, JSON.stringify(packages.body)).toBeDefined();
    expect(item.notLoaded).toBeUndefined();
  });

  it('after the restart, the package\'s connector is listed ready with the document\'s operation', () => {
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    const entry = listed(after, CONNECTOR);
    expect(entry, JSON.stringify(names(after))).toBeDefined();
    expect(entry.state).toBe('ready');
    expect(entry.actions.map((a: any) => a.key)).toEqual(['GetThings']);
  });

  it('after the restart, the engine serves the package\'s flow', () => {
    expect(flowAfter.status, JSON.stringify(flowAfter.body)).toBe(200);
  });

  it('after the restart, a connector the host declares is still listed (control)', () => {
    expect(listed(after, HOST_CONNECTOR), JSON.stringify(names(after))).toBeDefined();
  });
});

const FLOW_PACKAGE_ID = 'com.dogfood.restartflow';
const ORDER_FLOW = 'rstflow_manual_probe';
const AUTOMATION_PLUGIN = 'com.objectstack.service-automation';

const FLOW_INSTALL_BODY = {
  manifest: {
    id: FLOW_PACKAGE_ID,
    namespace: 'rstflow',
    name: 'Restart flow probe',
    version: '0.1.0',
    type: 'app',
    flows: [
      {
        name: ORDER_FLOW,
        label: 'Restart flow probe (run by name)',
        type: 'autolaunched',
        status: 'active',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    ],
  },
};

const dependsOnAutomation = (plugin: unknown): boolean =>
  Array.isArray((plugin as { dependencies?: unknown })?.dependencies)
  && ((plugin as { dependencies: unknown[] }).dependencies).includes(AUTOMATION_PLUGIN);

/**
 * The showcase with `MarketplaceInstallLocalPlugin` in its own `plugins`, after
 * the plugins that depend on the automation plugin, where the showcase's
 * configuration lists it whenever a control plane is configured (this suite
 * runs with `OS_CLOUD_URL=off`, which leaves it out).
 */
function showcaseWithInstallLocal(storageDir: string): { plugins: unknown[] } {
  const own = ((showcaseStack as { plugins?: unknown[] }).plugins ?? []);
  let at = 0;
  own.forEach((plugin, index) => {
    if (dependsOnAutomation(plugin)) at = index + 1;
  });
  return {
    ...(showcaseStack as object),
    plugins: [...own.slice(0, at), new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir }), ...own.slice(at)],
  };
}

describe('dogfood: an install-local package\'s flow is registered again after a restart, in the plugin order the showcase boots', () => {
  let storageDir: string;
  let composition: { plugins: unknown[] };
  let install: Answer;
  let triggerBefore: Answer;
  let packages: Answer;
  let triggerAfter: Answer;
  let metaAfter: Answer;
  let bootError: unknown;

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-restart-flow-'));
    composition = showcaseWithInstallLocal(storageDir);
    const first = await bootShowcase({}, composition);
    try {
      const token = await first.signIn();
      install = await json(await first.apiAs(token, 'POST', ROUTE, FLOW_INSTALL_BODY));
      triggerBefore = await json(await first.apiAs(token, 'POST', `/automation/${ORDER_FLOW}/trigger`, {}));
    } finally {
      await first.stop();
    }

    let second: VerifyStack | undefined;
    try {
      second = await bootShowcase({}, showcaseWithInstallLocal(storageDir));
    } catch (err) {
      bootError = err;
      return;
    }
    try {
      const token = await second.signIn();
      packages = await json(await second.apiAs(token, 'GET', ROUTE));
      triggerAfter = await json(await second.apiAs(token, 'POST', `/automation/${ORDER_FLOW}/trigger`, {}));
      metaAfter = await json(await second.apiAs(token, 'GET', `/meta/flow/${ORDER_FLOW}`));
    } finally {
      await second.stop();
    }
  }, 300_000);

  afterAll(() => {
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('the composition lists install-local after a plugin that depends on the automation plugin (precondition)', () => {
    const installLocalAt = composition.plugins.findIndex((p) => p instanceof MarketplaceInstallLocalPlugin);
    const lastDependentAt = composition.plugins.reduce<number>((last, p, i) => (dependsOnAutomation(p) ? i : last), -1);
    expect(lastDependentAt).toBeGreaterThanOrEqual(0);
    expect(installLocalAt).toBeGreaterThan(lastDependentAt);
  });

  it('before the restart, the install is hot-loaded and the flow triggers by name (precondition)', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.hotLoaded).toBe(true);
    expect(triggerBefore.status, JSON.stringify(triggerBefore.body)).toBe(200);
  });

  it('the second boot over the same ledger succeeds and lists the package', () => {
    expect(bootError).toBeUndefined();
    expect(packages.status, JSON.stringify(packages.body)).toBe(200);
    const item = (packages.body?.data?.items ?? []).find((i: any) => i?.manifestId === FLOW_PACKAGE_ID);
    expect(item, JSON.stringify(packages.body)).toBeDefined();
    expect(item.notLoaded).toBeUndefined();
  });

  it('after the restart, the package\'s flow triggers by name', () => {
    expect(triggerAfter.status, JSON.stringify(triggerAfter.body)).toBe(200);
  });

  it('after the restart, the package\'s flow reads registered', () => {
    expect(metaAfter.status, JSON.stringify(metaAfter.body)).toBe(200);
    const doc = metaAfter.body?.data ?? metaAfter.body;
    expect(doc?.registration?.state, JSON.stringify(metaAfter.body)).toBe('registered');
  });
});
