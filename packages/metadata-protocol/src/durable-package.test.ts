// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// #2532 — durable package registration. `protocol.installPackage` writes BOTH
// package stores (in-memory registry + sys_packages via the `package` service),
// but its persistence guard used to be `pkgSvc?.publish && manifest.version` —
// silently SKIPPING every versionless runtime-created base ({id, name} from the
// builder / Setup), which is exactly why those packages vanished on restart.
// These tests pin the fixed contract: version is defaulted (never skipped) and
// uninstall drops the durable row so packages don't resurrect at boot.
//
// #17676 ruling A' item 3 (decision batch #125 item 2, maintainer 「同意」
// 2026-09-13) — `makeImpl()` gains the service-ABSENT composition, so the pin
// can express the bug THAT card found: a writable package created through
// `POST /api/v1/packages` on a host with no `package` service is registered
// in-memory only, and after a restart the state splits three ways (Studio's
// writable list is empty, the data route 404s, the published metadata is still
// there). Before this, `makeImpl()` could only build the service-PRESENT host,
// so no pin here could fail the way the card failed.
//
// ⭐ The service-ABSENT branch is NOT a bug to delete — ruling item 2 keeps it
// as the documented degraded path for reduced hosts (`--preset minimal`, a host
// that mounts no `package-registry` provider). What the ruling changes is which
// hosts take it, and that half lives outside this package; these pins state
// what the primitive does on each composition, either side of it.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './index.js';

/**
 * Compose a protocol implementation over a fake host.
 *
 * The fake `registry` mirrors the real `SchemaRegistry` package API by NAME
 * (`installPackage` / `getPackage` / `getAllPackages` / `updatePackageManifest`,
 * `packages/objectql/src/registry.ts`) so a pin written against it is a pin
 * about the primitive's real collaborator, not about an invented one.
 */
function makeImpl(overrides?: {
  publish?: (d: { manifest: unknown; metadata: unknown }) => Promise<unknown>;
  del?: (id: string) => Promise<unknown>;
  find?: (obj: string, q: unknown) => Promise<unknown[]>;
  /**
   * #17676 ruling A' item 3 — the service-ABSENT composition.
   *
   * `false` builds a services registry with NO `package` entry at all, which
   * is what a host that mounts no `PackageServicePlugin` hands the protocol.
   * `installPackage` / `updatePackage` then take their in-memory-only branch:
   * the registry write lands, nothing reaches `sys_packages`, and the process
   * is the only place the package exists.
   */
  packageService?: false;
  /**
   * Manifests to replay into the fresh registry before the test runs — a
   * stand-in for the boot hydration `PackageServicePlugin.start()` performs
   * (`for (const rec of await packageService.list()) registry.installPackage(rec.manifest)`,
   * `packages/services/service-package/src/index.ts`). A host composed with
   * the rows a previous host persisted IS that process after a restart; a host
   * composed with none is a restart that found `sys_packages` empty.
   */
  hydrate?: readonly { id: string; [key: string]: unknown }[];
}) {
  const registryCalls: Array<{ manifest: any; settings: any }> = [];
  const installed = new Map<string, any>();
  const registry = {
    installPackage: (manifest: any, settings?: any) => {
      registryCalls.push({ manifest, settings });
      const pkg = { manifest, status: 'installed', enabled: true };
      installed.set(manifest.id, pkg);
      return pkg;
    },
    getPackage: (id: string) => installed.get(id),
    getAllPackages: () => [...installed.values()],
    updatePackageManifest: (id: string, patch: Record<string, unknown>) => {
      const pkg = installed.get(id);
      if (!pkg) return undefined;
      Object.assign(pkg.manifest, patch);
      return pkg;
    },
  };
  const engine = { registry, find: overrides?.find ?? (async () => []) };
  // Seeded through the registry's own verb, exactly as the boot hydration does.
  for (const manifest of overrides?.hydrate ?? []) registry.installPackage(manifest);
  registryCalls.length = 0; // hydration is the fixture, not an observation

  const publish = vi.fn(overrides?.publish ?? (async () => ({ success: true })));
  const del = vi.fn(overrides?.del ?? (async () => ({ success: true })));
  const services = new Map<string, any>();
  if (overrides?.packageService !== false) {
    services.set('package', { publish, delete: del });
  }
  const impl = new ObjectStackProtocolImplementation(engine as any, () => services);
  return { impl, registryCalls, publish, del, registry, engine, services };
}

describe('installPackage — durable persistence (#2532)', () => {
  it('persists a VERSIONLESS manifest by defaulting version (the vanish-on-restart bug)', async () => {
    const { impl, registryCalls, publish } = makeImpl();
    const res: any = await (impl as any).installPackage({
      manifest: { id: 'com.example.orders', name: '订单中心' },
    });

    // In-memory half.
    expect(registryCalls).toHaveLength(1);
    expect(registryCalls[0].manifest.version).toBe('0.1.0');
    // Durable half — the old guard skipped publish entirely for this shape.
    expect(publish).toHaveBeenCalledTimes(1);
    const persisted = publish.mock.calls[0][0] as any;
    expect(persisted.manifest.id).toBe('com.example.orders');
    expect(persisted.manifest.version).toBe('0.1.0');
    expect(res.package.status).toBe('installed');
  });

  it('keeps an explicit version untouched', async () => {
    const { impl, publish } = makeImpl();
    await (impl as any).installPackage({ manifest: { id: 'com.example.v', version: '2.3.4' } });
    expect((publish.mock.calls[0][0] as any).manifest.version).toBe('2.3.4');
  });

  it('stays non-fatal when the durable write fails (registry install already succeeded)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { impl } = makeImpl({ publish: async () => ({ success: false, error: 'boom' }) });
      const res: any = await (impl as any).installPackage({ manifest: { id: 'com.example.fail' } });
      expect(res.package.status).toBe('installed');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('persist FAILED'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('deletePackage — durable un-registration (#2532 counterpart)', () => {
  it('drops the sys_packages record so the package cannot resurrect at boot', async () => {
    const { impl, del } = makeImpl();
    await (impl as any).deletePackage({ packageId: 'com.example.orders', allTenants: true });
    expect(del).toHaveBeenCalledWith('com.example.orders');
  });
});

describe('deletePackage — uninstall cleanups (#2747)', () => {
  it('invokes registered cleanups with the package id and reports outcomes', async () => {
    const { impl } = makeImpl();
    const cleanup = vi.fn(async () => ({ success: true, removed: 3 }));
    (impl as any).registerUninstallCleanup('security.package-permissions', cleanup);

    const res: any = await (impl as any).deletePackage({ packageId: 'com.example.orders', allTenants: true, actor: 'usr_1' });

    expect(cleanup).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'com.example.orders', actor: 'usr_1' }));
    expect(res.cleanups).toEqual([
      { name: 'security.package-permissions', success: true, removed: 3 },
    ]);
  });

  it('reports a throwing cleanup as failed instead of aborting the uninstall', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { impl } = makeImpl();
      // [#8136] `db down` is a BARE error — it declares no ADR-0112 envelope,
      // so the producer no longer quotes it onto the response. `cleanups[]`
      // rides onto a `PACKAGE_DELETE_PARTIAL` 400 inside `details`, where no
      // HTTP boundary's 5xx message withhold can reach it, so a cleanup that
      // failed on a driver fault used to ship the driver's words to the client.
      //
      // This case's SUBJECT is unchanged and still asserted: a throwing cleanup
      // is reported as `success: false` rather than aborting the uninstall.
      // Only the text moved, and the counterpart — a cleanup that DECLARES a
      // 4xx refusal keeps its sentence verbatim — is pinned in
      // `protocol.driver-text-disclosure.test.ts`, so "reported as failed" and
      // "reported in the driver's words" cannot collapse into one another.
      (impl as any).registerUninstallCleanup('boom', async () => { throw new Error('db down'); });
      const res: any = await (impl as any).deletePackage({ packageId: 'com.example.orders', allTenants: true });
      expect(res.cleanups).toEqual([
        { name: 'boom', success: false, removed: 0, error: 'cleanup failed' },
      ]);
      expect(JSON.stringify(res)).not.toContain('db down');
    } finally {
      warn.mockRestore();
    }
  });

  it('re-registration under the same name replaces (idempotent re-init)', async () => {
    const { impl } = makeImpl();
    const first = vi.fn(async () => ({ success: true, removed: 1 }));
    const second = vi.fn(async () => ({ success: true, removed: 2 }));
    (impl as any).registerUninstallCleanup('x', first);
    (impl as any).registerUninstallCleanup('x', second);
    const res: any = await (impl as any).deletePackage({ packageId: 'p', allTenants: true });
    expect(first).not.toHaveBeenCalled();
    expect(res.cleanups[0].removed).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #17676 ruling A' item 3 — the service-ABSENT composition, and the restart
// split it exists to express.
//
// ⚠️ SCOPE, stated so a green run here is not over-read. Ruling item 5's
// acceptance is that THREE probes agree after a restart — Studio's writable
// list, `GET /api/v1/data/<ns>_<obj>` and
// `GET /api/v1/meta/object/<ns>_<obj>/published`. Those are HTTP surfaces over
// a booted composition; this is a unit tier over the protocol primitive, and a
// unit tier cannot restart a server. What it CAN do is pin the one fact the
// three probes disagree about — whether the package crosses the boundary at
// all — at the seam that decides it. The registry reads below stand for the
// first two probes (both are registry-backed: the dispatcher's
// `/api/v1/packages` list and `getMetaItems({type:'package'})` feed Studio's
// selector; the data route needs the object registered), and the `find` read
// stands for the third (published `sys_metadata` rows, which no package state
// gates). ⛔ Item 5 is NOT met by these pins.
// ─────────────────────────────────────────────────────────────────────────────

describe("service-ABSENT host — the degraded path (#17676 ruling A' items 2/3)", () => {
  it('installPackage registers in memory, writes NOTHING durable, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { impl, registryCalls, publish, registry } = makeImpl({ packageService: false });

      const res: any = await (impl as any).installPackage({
        manifest: { id: 'com.example.leave', name: '请假' },
      });

      // The door still answers 201 — which is exactly why the card calls the
      // failure invisible until a restart.
      expect(res.package.status).toBe('installed');
      expect(registryCalls).toHaveLength(1);
      expect(registry.getPackage('com.example.leave')).toBeTruthy();
      // Durable half never ran: there was no service to run it.
      expect(publish).not.toHaveBeenCalled();
      // ⭐ Absence must be loud (AGENTS.md, Route & surface ownership §3): the
      // branch is allowed to degrade, never to degrade SILENTLY.
      const said = warn.mock.calls.map((c) => String(c[0]));
      expect(said.some((m) => m.includes("no 'package' service"))).toBe(true);
      expect(said.some((m) => m.includes('will not survive a restart'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('updatePackage degrades the same way — the ruling names BOTH primitives', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { impl, publish, registry } = makeImpl({
        packageService: false,
        hydrate: [{ id: 'com.example.leave', name: '请假', version: '0.1.0' }],
      });

      const res: any = await (impl as any).updatePackage({
        packageId: 'com.example.leave',
        patch: { name: '请假 v2' },
      });

      expect(res.package.manifest.name).toBe('请假 v2');
      expect(registry.getPackage('com.example.leave').manifest.name).toBe('请假 v2');
      expect(publish).not.toHaveBeenCalled();
      const said = warn.mock.calls.map((c) => String(c[0]));
      expect(said.some((m) => m.includes("no 'package' service"))).toBe(true);
      expect(said.some((m) => m.includes('will not survive a restart'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the restart split this card reported (#17676 ruling A' items 3/5)", () => {
  /** The durable `sys_packages` table — the only package state a restart keeps. */
  const makeSysPackages = () => {
    const rows = new Map<string, { id: string; [key: string]: unknown }>();
    return {
      rows,
      publish: async (d: any) => {
        rows.set(d.manifest.id, d.manifest);
        return { success: true };
      },
    };
  };

  /**
   * The published object metadata, which lives in `sys_metadata` and is gated
   * by nothing the package registry holds — that asymmetry IS the card's
   * contradiction: "the published metadata outlives both the package and the
   * runtime registration".
   */
  const publishedMetadata = [{ name: 'leave_request', _packageId: 'com.example.leave' }];

  it('service ABSENT ⇒ the package does not cross the boundary, its metadata does', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sysPackages = makeSysPackages();

      // ── process 1 ─────────────────────────────────────────────────────────
      const before = makeImpl({ packageService: false, publish: sysPackages.publish });
      await (before.impl as any).installPackage({
        manifest: { id: 'com.example.leave', name: '请假' },
      });
      expect(before.registry.getPackage('com.example.leave')).toBeTruthy();
      expect([...sysPackages.rows.keys()]).toEqual([]);

      // ── restart ───────────────────────────────────────────────────────────
      const after = makeImpl({
        packageService: false,
        hydrate: [...sysPackages.rows.values()],
        find: async () => publishedMetadata,
      });

      // Probe 1 — Studio: `No writable packages yet`.
      expect(after.registry.getAllPackages()).toEqual([]);
      // Probe 2 — the data route: `Object '<ns>_<obj>' is not registered`.
      expect(after.registry.getPackage('com.example.leave')).toBeUndefined();
      // Probe 3 — published metadata: still 200. The three DISAGREE.
      expect(await after.engine.find('sys_metadata', {})).toEqual(publishedMetadata);
    } finally {
      warn.mockRestore();
    }
  });

  it('CONTROL — service PRESENT ⇒ all three agree after the same restart', async () => {
    const sysPackages = makeSysPackages();

    const before = makeImpl({ publish: sysPackages.publish });
    await (before.impl as any).installPackage({
      manifest: { id: 'com.example.leave', name: '请假' },
    });
    // The durable half ran, so the restart has something to replay.
    expect([...sysPackages.rows.keys()]).toEqual(['com.example.leave']);

    const after = makeImpl({
      publish: sysPackages.publish,
      hydrate: [...sysPackages.rows.values()],
      find: async () => publishedMetadata,
    });

    expect(after.registry.getAllPackages()).toHaveLength(1);
    expect(after.registry.getPackage('com.example.leave')).toBeTruthy();
    expect(await after.engine.find('sys_metadata', {})).toEqual(publishedMetadata);
  });
});
