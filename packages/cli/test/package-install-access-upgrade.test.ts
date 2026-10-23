// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §6 wall 3] `os package install --confirm-access-upgrade <token>` —
 * the install-local body's `confirmAccessUpgrade`, and how the command renders
 * the runtime's `ACCESS_UPGRADE_CONFIRMATION_REQUIRED` refusal.
 *
 * Pinned:
 *  - the flag reaches the body as `confirmAccessUpgrade`, the token verbatim;
 *    without the flag the body carries no such key;
 *  - the refusal prints every finding's `describe` line and the exact retry,
 *    naming the finding set's token, and exits 1.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import PackageInstall from '../src/commands/package/install.js';

type Answer = { ok: boolean; status: number; body: unknown };

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

const TOKEN = 'security.access_upgrade:0123456789abcdef0123456789abcdef';
const INSTALLED = {
  manifestId: 'com.acme.crm', version: '2.0.0', versionId: 'ver_2', installedAt: '2026-10-23T00:00:00.000Z',
  hotLoaded: true, storageDir: '/srv/runtime/.objectstack/installed-packages',
};

describe('os package install --confirm-access-upgrade (ADR-0126 §6 wall 3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends the token verbatim as `confirmAccessUpgrade`', async () => {
    const { sent } = stubRuntime({ ok: true, status: 200, body: { success: true, data: INSTALLED } });
    await runInstall(['--confirm-access-upgrade', TOKEN]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ packageId: 'com.acme.crm', confirmAccessUpgrade: TOKEN });
  });

  it('sends no `confirmAccessUpgrade` without the flag', async () => {
    const { sent } = stubRuntime({ ok: true, status: 200, body: { success: true, data: INSTALLED } });
    await runInstall([]);
    expect(sent[0]).not.toHaveProperty('confirmAccessUpgrade');
  });

  it('renders the refusal: every finding, then the exact retry with the token, and exits 1', async () => {
    stubRuntime({
      ok: false,
      status: 409,
      body: {
        success: false,
        error: {
          code: 'ACCESS_UPGRADE_CONFIRMATION_REQUIRED',
          message: 'Upgrading "com.acme.crm" would change what access choices made in this system cover',
          details: {
            manifestId: 'com.acme.crm',
            findingSet: TOKEN,
            findings: [
              { kind: 're-enablement', describe: "permission 'crm_rep' is switched off in this system and the upgrade no longer ships it" },
              { kind: 'broken-reference', describe: "permission set 'cust_exporter', authored in this system, names capability 'crm.export'" },
            ],
          },
        },
      },
    });
    const { out, exit } = await runInstall([]);
    expect(exit).toBe(1);
    expect(out).toContain("permission 'crm_rep' is switched off in this system");
    expect(out).toContain("names capability 'crm.export'");
    expect(out).toContain(`os package install com.acme.crm --confirm-access-upgrade ${TOKEN}`);
  });
});
