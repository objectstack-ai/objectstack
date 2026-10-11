// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22729 — `os package install` reads the install-local answer's `hotLoaded`
 * and `hotLoadError`, and says what the runtime actually did.
 *
 * `POST /api/v1/marketplace/install-local` answers `200` on its LENIENT path
 * too: a cloud-fetched manifest whose `manifest.register` throws is written to
 * the runtime's ledger and loads at the runtime's next restart, while the
 * running kernel does not hold it. Since #22695 that answer says so —
 * `hotLoaded: false`, with the register error's message as `hotLoadError` —
 * and before this change the command printed "Package installed into the
 * running kernel" over it, for any `200` alike.
 *
 * Four cases, because the read is additive and each half needs its own pin:
 *   - the lenient answer is NOT reported as a hot install, and names the reason;
 *   - CONTROL: a hot-loaded answer prints as it always did;
 *   - an answer WITHOUT the keys (a host that predates #22695) prints as it
 *     always did — absence is not read as `false`;
 *   - a `hotLoaded: false` with no usable reason prints no invented one.
 *
 * Catalog mode only: the air-gapped file path sends an INLINE manifest, and
 * install-local refuses an inline manifest whose register throws with
 * `422 PLUGIN_REGISTER_FAILED` before anything is written, so that path never
 * reaches a `hotLoaded: false` answer. The reader is the same code either way.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import PackageInstall from '../src/commands/package/install.js';

/** The register error the runtime passes through, verbatim. */
const REGISTER_ERROR = "object 'crm_account' declares field 'owner' with unknown type 'lookupx'";

/** Stub the runtime's install POST with the given `data` block. */
function stubRuntime(data: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => ({ success: true, data }),
  }) as any));
}

/** Run the command in catalog mode; return everything it printed and how it exited. */
async function runInstall(): Promise<{ out: string; exit: number | undefined }> {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  let exit: number | undefined;
  try {
    await PackageInstall.run(['com.acme.crm', '--runtime', 'http://runtime.test']);
  } catch (err: any) {
    exit = err?.oclif?.exit ?? err?.code;
  }
  return { out: lines.join('\n'), exit };
}

/** The answer's keys every install carries, whatever the hot-register did. */
const INSTALLED = {
  manifestId: 'com.acme.crm',
  version: '1.0.0',
  versionId: 'ver_1',
  installedAt: '2026-10-10T00:00:00.000Z',
};

const HOT_INSTALL_LINE = 'Package installed into the running kernel';

describe('os package install — reads hotLoaded / hotLoadError', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('on hotLoaded: false, says installed, loads at the next restart, and names hotLoadError', async () => {
    stubRuntime({ ...INSTALLED, hotLoaded: false, hotLoadError: REGISTER_ERROR });

    const { out, exit } = await runInstall();

    // The defect: a hot install claimed over a kernel that does not hold it.
    expect(out).not.toContain(HOT_INSTALL_LINE);
    // What happened instead, and when the package does load.
    expect(out).toMatch(/Package installed, but the running kernel could not load it/);
    expect(out).toMatch(/loads at the runtime's next restart/);
    // The reason, as the runtime answered it.
    expect(out).toContain(REGISTER_ERROR);
    // The install itself succeeded (ledger written, `200`): same exit as a hot one.
    expect(exit).toBeUndefined();
    expect(out).toContain('com.acme.crm');
  });

  it('CONTROL: on hotLoaded: true, prints as before', async () => {
    stubRuntime({ ...INSTALLED, hotLoaded: true });

    const { out, exit } = await runInstall();

    expect(out).toContain(HOT_INSTALL_LINE);
    expect(out).not.toContain('next restart');
    expect(out).not.toContain('could not load');
    expect(exit).toBeUndefined();
  });

  it('an answer without hotLoaded (a host that predates the key) prints as before', async () => {
    stubRuntime({ ...INSTALLED });

    const { out, exit } = await runInstall();

    expect(out).toContain(HOT_INSTALL_LINE);
    expect(out).not.toContain('next restart');
    expect(out).not.toContain('could not load');
    expect(exit).toBeUndefined();
  });

  it.each([
    ['absent', undefined],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['not a string', 42],
  ])('on hotLoaded: false with hotLoadError %s, invents no reason', async (_label, value) => {
    stubRuntime({ ...INSTALLED, hotLoaded: false, ...(value === undefined ? {} : { hotLoadError: value }) });

    const { out } = await runInstall();

    expect(out).not.toContain(HOT_INSTALL_LINE);
    expect(out).toMatch(/loads at the runtime's next restart/);
    expect(out).not.toContain('Hot-load error');
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('42');
  });
});
