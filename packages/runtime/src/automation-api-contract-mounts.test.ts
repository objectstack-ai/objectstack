// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20034 — `AutomationApiContracts` names the wire paths the dispatcher mounts.
 *
 * ## The drift this pins
 *
 * The published contract (`@objectstack/spec/api`) declared its nine flow
 * endpoints under `/api/automation`, while the dispatcher mounts the automation
 * door at `config.prefix || '/api/v1'` plus `/automation`, and
 * `objectstack serve` passes no prefix. Every declared path answered
 * `404 ENDPOINT_NOT_FOUND` on the composed runtime, and nothing noticed: the
 * spec's own test pinned the nine strings to themselves, so it stayed green
 * through exactly that drift. Only a test that reads BOTH sides can see it, and
 * only this package can import both: the spec has no dependency on the runtime.
 *
 * ## The two legs
 *
 * 1. MOUNT — boot `createDispatcherPlugin` with NO `prefix`, the composition
 *    `objectstack serve` uses, and require every contract `METHOD path` to be a
 *    route it registered. The prefix is the plugin's own default, never a
 *    constant written here, so moving either side alone turns this red.
 * 2. LEDGER — require every contract route to be a `route-ledger.ts` row under
 *    the `/api/v1` prefix the ledger header documents. That row is what the
 *    live-mount parity gate (#7526, `route-ledger-live-mount-parity`) probes
 *    through the real router, so registration here is carried on to
 *    reachability there.
 *
 * ⚠️ What this does not cover: the environment-scoped mount
 * (`${prefix}/environments/:environmentId/automation`, the only one registered
 * under `projectResolution: 'required'`). The contract declares the unscoped
 * paths only, as every other `*ApiContracts` map does.
 */

import { describe, it, expect } from 'vitest';
import { AutomationApiContracts } from '@objectstack/spec/api';

import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { ROUTE_LEDGER } from './route-ledger.js';

/** The wire prefix `route-ledger.ts` documents for its non-`absolute` rows. */
const LEDGER_WIRE_PREFIX = '/api/v1';

/** Records `VERB /path` for every registration, in order; mounts nothing. */
function recordingServer() {
  const routes: string[] = [];
  const rec = (verb: string) => (path: string, _handler: unknown) => {
    routes.push(`${verb} ${path}`);
  };
  return {
    routes,
    server: {
      get: rec('GET'),
      post: rec('POST'),
      put: rec('PUT'),
      delete: rec('DELETE'),
      patch: rec('PATCH'),
    },
  };
}

function pluginCtx(server: unknown) {
  const kernel = {
    getService: () => undefined,
    getServiceAsync: async () => undefined,
  };
  return {
    getKernel: () => kernel,
    getService: (name: string) => (name === 'http.server' ? server : undefined),
    environmentId: undefined,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    hook: () => {},
    on: () => {},
  } as any;
}

const CONTRACT_ROUTES = Object.entries(AutomationApiContracts).map(
  ([key, contract]) => ({ key, route: `${contract.method} ${contract.path}` }),
);

describe('#20034 — AutomationApiContracts ↔ what the dispatcher serves', () => {
  it('declares routes at all (a vacuous map would pass both legs)', () => {
    expect(CONTRACT_ROUTES.length).toBeGreaterThan(0);
  });

  it('every contract route is mounted by the dispatcher at its DEFAULT prefix', async () => {
    const { server, routes } = recordingServer();
    // No `prefix`: this is the composition `objectstack serve` builds.
    const plugin = createDispatcherPlugin({ securityHeaders: false });
    await plugin.start?.(pluginCtx(server));

    const unmounted = CONTRACT_ROUTES.filter(({ route }) => !routes.includes(route));
    expect(
      unmounted,
      'AutomationApiContracts names routes the dispatcher does not mount at its default prefix; '
        + `mounted automation routes: ${routes.filter((r) => r.includes('/automation')).join(', ')}`,
    ).toEqual([]);
  });

  it('every contract route is a route-ledger row under the documented `/api/v1` wire prefix', () => {
    const ledgerWire = new Set(
      ROUTE_LEDGER.map((row) => {
        if (row.absolute) return row.route;
        const sp = row.route.indexOf(' ');
        return `${row.route.slice(0, sp)} ${LEDGER_WIRE_PREFIX}${row.route.slice(sp + 1)}`;
      }),
    );
    const unledgered = CONTRACT_ROUTES.filter(({ route }) => !ledgerWire.has(route));
    expect(
      unledgered,
      'AutomationApiContracts names routes with no route-ledger.ts row under the `/api/v1` wire prefix',
    ).toEqual([]);
  });
});
