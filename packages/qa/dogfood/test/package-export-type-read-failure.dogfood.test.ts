// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29760] A package export is the package's whole content or no answer: when
// the read of one metadata type the runtime serves fails, `GET
// /packages/:id/export` refuses, naming the package and the type, instead of
// answering 200 without that type's collection, and the whole-deployment
// bundle (`GET /packages/export`), which composes that export, refuses with it.
//
// ## What was measured before the fix
//
// `assemblePackageManifest` caught every per-type read failure as an
// "unknown/unsupported type" and skipped it. The read below fails the way a
// storage fault does on the real protocol: the overlay rows of `dashboard`
// cannot be read, which the protocol rethrows as its declared `503
// SERVICE_UNAVAILABLE` (only an unprovisioned `sys_metadata` licenses it to
// answer without them). The showcase's export then answered 200 with its
// objects and no `dashboards` key at all, so a reinstall from it would land
// without a dashboard and tell nobody.
//
// ## What this file pins, on one showcase boot with one installed package
//
//   1. CONTROL: the showcase's export and the bundle answer 200 and carry their
//      dashboards (the bundle holds the installed package, never the
//      showcase's own `code` package);
//   2. the dashboard overlay read failing: both doors answer the read's own
//      `503 SERVICE_UNAVAILABLE`, naming the package and `dashboard`, and serve
//      no body;
//   3. CONTROL: the read restored, both answer 200 with the dashboards again
//      (the failure was the read's, not the boot's);
//   4. a type this runtime does not serve is still skipped: `connector` is an
//      exportable collection, and while the live type vocabulary
//      (`getMetaTypes`) does not list it its read failing leaves both doors
//      200 with every other collection. The showcase serves every exportable
//      type, so the vocabulary's omission is injected beside the read's
//      failure. (`rag_pipeline` was the natural specimen, exportable and
//      unlisted, until its `PLURAL_TO_SINGULAR` row was retired: no stack
//      could declare it, and it is no longer exportable at all.)
//
// The fault is injected on the protocol's own overlay read
// (`readActiveOverlayRows`, which the moved list body reaches through the
// host's call-time closure), never on either door, so the whole real read path
// runs. It boots a stack of its own (the install-local plugin mounted), so it
// stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { bootShowcase } from './showcase-boot.js';

const SHOWCASE = 'com.example.showcase';
const INSTALLED = 'com.dogfood.exportread';
const FAILING = 'dashboard';
/**
 * An exportable type the showcase serves (asserted below, not assumed), made
 * unserved for one leg by dropping it from the live vocabulary, under either
 * spelling.
 */
const UNSERVED = 'connector';
const UNSERVED_COLLECTION = 'connectors';
const ROUTE = '/marketplace/install-local';

/** The install body `os package install` sends for an inline manifest. */
const INSTALL = {
  manifest: {
    id: INSTALLED,
    namespace: 'exportread',
    name: 'Export read failure',
    version: '1.0.0',
    type: 'app',
    objects: [{ name: 'exportread_entry', label: 'Entry', fields: { title: { type: 'text', label: 'Title' } } }],
    dashboards: [{ name: 'exportread_pulse', label: 'Pulse', columns: 12, widgets: [] }],
  },
};

type Answer = { status: number; body: any };
type Reading = { one: Answer; bundle: Answer };

async function call(stack: VerifyStack, token: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const res = await stack.apiAs(token, method, path, body);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const collections = (manifest: Record<string, any> | undefined): string[] =>
  Object.keys(manifest ?? {}).filter((k) => Array.isArray(manifest?.[k])).sort();
const dashboardNames = (manifest: Record<string, any> | undefined): string[] =>
  (manifest?.dashboards ?? []).map((d: any) => d.name);
const entryOf = (bundle: Answer) => (bundle.body?.data?.packages ?? []).find((p: any) => p.id === INSTALLED);

describe('dogfood: a package export refuses when the read of a type the runtime serves fails', () => {
  let storageDir: string;
  let installed: Answer;
  let before: Reading;
  let failed: Reading;
  let after: Reading;
  let unserved: Reading;
  let liveTypes: string[] = [];
  let overlayReadsRefused = 0;
  let unservedReadsRefused = 0;

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-export-type-read-'));
    const stack = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    try {
      const token = await stack.signIn();
      installed = await call(stack, token, 'POST', ROUTE, INSTALL);
      const read = async (): Promise<Reading> => ({
        one: await call(stack, token, 'GET', `/packages/${SHOWCASE}/export`),
        bundle: await call(stack, token, 'GET', '/packages/export'),
      });
      before = await read();

      const protocol = stack.kernel.getService('protocol') as {
        readActiveOverlayRows(request: { type: string }): Promise<unknown>;
        getMetaTypes(): Promise<{ types: string[] }>;
      };
      liveTypes = (await protocol.getMetaTypes()).types;
      const original = protocol.readActiveOverlayRows;
      const failing = (type: string, onRefuse: () => void) =>
        async function (this: unknown, request: { type: string }) {
          if (request.type === type) {
            onRefuse();
            throw new Error(`dogfood: the ${type} overlay rows could not be read`);
          }
          return original.call(protocol, request);
        };

      protocol.readActiveOverlayRows = failing(FAILING, () => { overlayReadsRefused += 1; });
      try {
        failed = await read();
      } finally {
        protocol.readActiveOverlayRows = original;
      }

      after = await read();

      // A runtime that does not serve the type: its vocabulary does not list
      // it, and its read throws.
      const originalTypes = protocol.getMetaTypes;
      protocol.getMetaTypes = async function (this: unknown) {
        const listing = await originalTypes.call(protocol);
        return { ...listing, types: listing.types.filter((t) => t !== UNSERVED && t !== UNSERVED_COLLECTION) };
      };
      protocol.readActiveOverlayRows = failing(UNSERVED, () => { unservedReadsRefused += 1; });
      try {
        unserved = await read();
      } finally {
        protocol.readActiveOverlayRows = original;
        protocol.getMetaTypes = originalTypes;
      }
    } finally {
      await stack.stop();
    }
  }, 600_000);

  afterAll(() => {
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('CONTROL: the package installs, and both doors answer 200 carrying the dashboards', () => {
    expect(installed.status, JSON.stringify(installed.body)).toBe(200);
    expect(before.one.status, JSON.stringify(before.one.body)).toBe(200);
    expect(dashboardNames(before.one.body?.data).length).toBeGreaterThan(0);
    expect(before.bundle.status, JSON.stringify(before.bundle.body)).toBe(200);
    expect((before.bundle.body?.data?.packages ?? []).map((p: any) => p.id)).not.toContain(SHOWCASE);
    expect(dashboardNames(entryOf(before.bundle))).toEqual(['exportread_pulse']);
  });

  it('a failed dashboard read refuses the package export, naming the package and the type, and serves no manifest', () => {
    // The injected fault was reached: the export read the type through it.
    expect(overlayReadsRefused).toBeGreaterThan(0);
    // The read's declared refusal rides on: the protocol answers a failed
    // overlay read as a 503, and so does the export it failed.
    expect(failed.one.status, JSON.stringify(failed.one.body)).toBe(503);
    expect(failed.one.body?.success).toBe(false);
    expect(failed.one.body?.data).toBeUndefined();
    expect(failed.one.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    const message = String(failed.one.body?.error?.message ?? '');
    expect(message).toContain(`'${SHOWCASE}'`);
    expect(message).toContain(`'${FAILING}'`);
  });

  it('the same failure refuses the whole-deployment bundle, naming the package and the type, and serves no bundle', () => {
    expect(failed.bundle.status, JSON.stringify(failed.bundle.body)).toBe(503);
    expect(failed.bundle.body?.success).toBe(false);
    expect(failed.bundle.body?.data).toBeUndefined();
    expect(failed.bundle.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    const message = String(failed.bundle.body?.error?.message ?? '');
    expect(message).toContain(`'${INSTALLED}'`);
    expect(message).toContain(`'${FAILING}'`);
  });

  it('CONTROL: the read restored, both doors answer 200 with the dashboards again', () => {
    expect(after.one.status, JSON.stringify(after.one.body)).toBe(200);
    expect(dashboardNames(after.one.body?.data)).toEqual(dashboardNames(before.one.body?.data));
    expect(after.bundle.status, JSON.stringify(after.bundle.body)).toBe(200);
    expect(dashboardNames(entryOf(after.bundle))).toEqual(['exportread_pulse']);
  });

  it('a type this runtime does not serve is still skipped: its failed read leaves both doors 200, every other collection', () => {
    // The precondition, measured on this boot: the type is served (the real
    // vocabulary lists it) and the showcase exports its collection, so the
    // omission during this leg is the injected one and nothing else; the
    // export read it (the fault was reached). Listed, the same failed read
    // refuses (the cases above).
    expect(liveTypes).toContain(FAILING);
    expect(liveTypes).toContain(UNSERVED);
    expect(collections(before.one.body?.data)).toContain(UNSERVED_COLLECTION);
    expect(unservedReadsRefused).toBeGreaterThan(0);
    expect(unserved.one.status, JSON.stringify(unserved.one.body)).toBe(200);
    // The showcase's export is answered without the skipped collection, and
    // with every other one it carried.
    expect(collections(unserved.one.body?.data)).toEqual(
      collections(before.one.body?.data).filter((k) => k !== UNSERVED_COLLECTION),
    );
    // The installed package declares no connector, so its bundle entry is
    // answered with exactly the collections it carried before.
    expect(unserved.bundle.status, JSON.stringify(unserved.bundle.body)).toBe(200);
    expect(collections(entryOf(unserved.bundle))).toEqual(collections(entryOf(before.bundle)));
  });
});
