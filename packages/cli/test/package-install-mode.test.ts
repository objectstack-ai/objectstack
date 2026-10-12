// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] `os package install --install-mode managed|unmanaged` — the
 * install-local body's `installMode`, and what the command says about each
 * answer.
 *
 * Pinned:
 *  - the flag reaches the body as `installMode`, spelled by the manifest key's
 *    enum; an ABSENT flag sends no `installMode` (the runtime reads `managed`,
 *    and a runtime that predates the key receives the body it always did);
 *  - a value outside the enum is refused by the command before any request;
 *  - an unmanaged answer prints what was copied, where and from what — and
 *    none of the managed install's lines (hot-load, the cached manifest that
 *    "re-registers on every boot"), which are not true of a copy;
 *  - each protection lock the copy dropped prints as one line,
 *    `TYPE.NAME: LOCK — REASON` (the reason verbatim, the dash and reason
 *    absent when the package gave none); an answer with no lock, or from a
 *    runtime that states none, prints no lock line;
 *  - asking for `unmanaged` and getting an answer without it (a runtime that
 *    predates the mode installed the package MANAGED) exits 1, saying so;
 *  - a refusal prints its code beside its status, as every refusal does.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import PackageInstall from '../src/commands/package/install.js';

type Answer = { ok: boolean; status: number; body: unknown };

/** Stub the runtime's install POST; record every body the command sends. */
function stubRuntime(answer: Answer): { sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) sent.push(JSON.parse(init.body));
    return {
      ok: answer.ok,
      status: answer.status,
      statusText: answer.ok ? 'OK' : 'Refused',
      headers: { get: () => null },
      json: async () => answer.body,
    } as any;
  }));
  return { sent };
}

async function runInstall(args: string[]): Promise<{ out: string; exit: number | undefined }> {
  const lines: string[] = [];
  const capture = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as any);
  let exit: number | undefined;
  try {
    await PackageInstall.run(['com.acme.crm', '--runtime', 'http://runtime.test', ...args]);
  } catch (err: any) {
    exit = err?.oclif?.exit ?? err?.code ?? 1;
  }
  return { out: lines.join('\n'), exit };
}

const MANAGED_ANSWER = {
  manifestId: 'com.acme.crm', version: '1.0.0', versionId: 'ver_1', installedAt: '2026-10-11T00:00:00.000Z',
  hotLoaded: true, storageDir: '/srv/runtime/.objectstack/installed-packages',
};

const UNMANAGED_ANSWER = {
  manifestId: 'com.acme.crm',
  version: '1.0.0',
  versionId: 'ver_1',
  installMode: 'unmanaged',
  installedAt: '2026-10-11T00:00:00.000Z',
  installedFrom: { packageId: 'com.acme.crm', version: '1.0.0' },
  targetPackageId: 'com.acme.crm-copy',
  namespace: 'crm',
  copiedCount: 12,
  copied: [],
  seeded: { mode: 'skipped', reason: "an unmanaged install copies metadata, not data: the package's sample data was not loaded" },
};

describe('os package install --install-mode (ADR-0131 D6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends `installMode: \'unmanaged\'` when asked', async () => {
    const { sent } = stubRuntime({ ok: true, status: 200, body: { success: true, data: UNMANAGED_ANSWER } });
    await runInstall(['--install-mode', 'unmanaged']);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ packageId: 'com.acme.crm', installMode: 'unmanaged' });
  });

  it('sends `installMode: \'managed\'` when asked', async () => {
    const { sent } = stubRuntime({ ok: true, status: 200, body: { success: true, data: MANAGED_ANSWER } });
    await runInstall(['--install-mode', 'managed']);
    expect(sent[0]).toMatchObject({ installMode: 'managed' });
  });

  it('sends NO `installMode` without the flag — the runtime reads managed, an older runtime the body it always got', async () => {
    const { sent } = stubRuntime({ ok: true, status: 200, body: { success: true, data: MANAGED_ANSWER } });
    await runInstall([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('installMode');
  });

  it('refuses a mode outside the enum before sending anything', async () => {
    const { sent } = stubRuntime({ ok: true, status: 200, body: { success: true, data: MANAGED_ANSWER } });
    const { exit } = await runInstall(['--install-mode', 'template']);
    expect(exit).not.toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it('prints an unmanaged answer as a copy — base, items, source — and none of the managed lines', async () => {
    stubRuntime({ ok: true, status: 200, body: { success: true, data: UNMANAGED_ANSWER } });
    const { out, exit } = await runInstall(['--install-mode', 'unmanaged']);
    expect(exit).toBeUndefined();
    expect(out).toMatch(/Package copied into the environment \(unmanaged\)/);
    expect(out).toContain('com.acme.crm-copy');
    expect(out).toMatch(/Items copied:\s+12/);
    expect(out).toContain('com.acme.crm@1.0.0');
    expect(out).toContain('sample data was not loaded');
    expect(out).not.toContain('Package installed into the running kernel');
    expect(out).not.toContain('re-registers on every');
  });

  it('prints each lock the copy dropped as `TYPE.NAME: LOCK — REASON`, the reason verbatim', async () => {
    stubRuntime({
      ok: true,
      status: 200,
      body: {
        success: true,
        data: {
          ...UNMANAGED_ANSWER,
          strippedLocks: [
            { type: 'dashboard', name: 'pipeline_dashboard', lock: 'full', reason: 'Board-pack figures — edit the source package.' },
            { type: 'app', name: 'crm_app', lock: 'no-delete' },
          ],
        },
      },
    });
    const { out, exit } = await runInstall(['--install-mode', 'unmanaged']);
    expect(exit).toBeUndefined();
    expect(out).toMatch(/Locks removed:\s+2/);
    const lines = out.split('\n').map((line) => line.trim());
    expect(lines).toContain('dashboard.pipeline_dashboard: full — Board-pack figures — edit the source package.');
    expect(lines).toContain('app.crm_app: no-delete');
  });

  it('prints no lock line when the copy dropped none, nor for a runtime that states no list', async () => {
    for (const data of [{ ...UNMANAGED_ANSWER, strippedLocks: [] }, UNMANAGED_ANSWER]) {
      stubRuntime({ ok: true, status: 200, body: { success: true, data } });
      const { out, exit } = await runInstall(['--install-mode', 'unmanaged']);
      expect(exit).toBeUndefined();
      expect(out).toMatch(/Package copied into the environment \(unmanaged\)/);
      expect(out).not.toContain('Locks removed');
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('CONTROL: a managed answer prints as it always did', async () => {
    stubRuntime({ ok: true, status: 200, body: { success: true, data: MANAGED_ANSWER } });
    const { out, exit } = await runInstall(['--install-mode', 'managed']);
    expect(exit).toBeUndefined();
    expect(out).toContain('Package installed into the running kernel');
    expect(out).toContain('re-registers on every');
    expect(out).not.toContain('unmanaged');
  });

  it('asked for unmanaged, answered without it: says the runtime installed it MANAGED, and exits 1', async () => {
    stubRuntime({ ok: true, status: 200, body: { success: true, data: MANAGED_ANSWER } });
    const { out, exit } = await runInstall(['--install-mode', 'unmanaged']);
    expect(exit).toBe(1);
    expect(out).toMatch(/does not support unmanaged installs/);
    expect(out).toContain('MANAGED');
    expect(out).not.toContain('Package installed into the running kernel');
  });

  it('prints a refusal with its code beside its status', async () => {
    stubRuntime({
      ok: false,
      status: 409,
      body: {
        success: false,
        error: {
          code: 'UNMANAGED_INSTALL_WALLED_POSTURE',
          message: "Package 'com.acme.crm' cannot be installed unmanaged on this deployment: it runs the 'isolated' tenancy posture.",
        },
      },
    });
    const { out, exit } = await runInstall(['--install-mode', 'unmanaged']);
    expect(exit).toBe(1);
    expect(out).toContain('Install failed (409 UNMANAGED_INSTALL_WALLED_POSTURE)');
    expect(out).toContain("'isolated' tenancy posture");
  });
});
