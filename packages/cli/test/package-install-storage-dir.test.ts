// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6721 — `os package install`'s post-install directory hint quotes the
 * RESPONSE, and prints nothing when the response has no directory to quote.
 *
 * The directory lives on the runtime host, which is a different machine: this
 * command speaks only HTTP and never touches the target's disk. #6643 measured
 * that no consumer-side answer exists — a locally-resolved constant describes
 * the wrong machine and is in any case only the host's *default*, wrong for
 * every host that configures `storageDir` — and left the literal in place with
 * a comment saying the honest fix was upstream. It landed (POST now carries
 * `storageDir`), so the literal is gone.
 *
 * The absent case is the one that keeps it gone. A `?? '.objectstack/…'` bolted
 * onto the new reference would read as a harmless kindness to older hosts and
 * would reinstate precisely the defect Prime Directive #12 forbids and #5996
 * deleted: a consumer stating a value the producer declined to state. Only a
 * case that FAILS when the sentence appears anyway can hold that door shut —
 * a test covering just the happy path leaves it open.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import PackageInstall from '../src/commands/package/install.js';

/** The host configured its ledger somewhere no default would ever guess. */
const REMOTE_DIR = '/srv/objectstack/state/ledger-packages';

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

/** Run the command in catalog mode and return everything it printed. */
async function runInstall(): Promise<string> {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  await PackageInstall.run(['com.acme.crm', '--runtime', 'http://runtime.test']);
  return lines.join('\n');
}

const INSTALLED = {
  manifestId: 'com.acme.crm',
  version: '1.0.0',
  versionId: 'ver_1',
  installedAt: '2026-08-10T00:00:00.000Z',
  hotLoaded: true,
};

describe('os package install — post-install directory hint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('quotes the storageDir the runtime reported, verbatim', async () => {
    stubRuntime({ ...INSTALLED, storageDir: REMOTE_DIR });

    const out = await runInstall();

    expect(out).toContain('Package installed into the running kernel');
    expect(out).toContain(REMOTE_DIR);
    expect(out).toContain('re-registers on every');
    // The old literal is not printed alongside the real value — the point is
    // that the sentence has ONE source, and it is the response.
    expect(out).not.toContain('.objectstack/installed-packages');
  });

  // The delivery criterion of this card: no fallback. An older host that
  // predates the producer half says nothing about its ledger, so neither do we.
  it('prints NO directory sentence when the response omits storageDir', async () => {
    stubRuntime({ ...INSTALLED });

    const out = await runInstall();

    // The install itself is still reported — only the directory claim is gone.
    expect(out).toContain('Package installed into the running kernel');
    expect(out).toContain('com.acme.crm');
    expect(out).not.toContain('cached');
    expect(out).not.toContain('survives restarts');
    expect(out).not.toContain('.objectstack/installed-packages');
    expect(out).not.toContain('undefined');
  });

  // A host that answers with an empty/blank value has told us nothing either;
  // that is the same case, not a licence to print a blank path.
  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['null', null],
  ])('prints no directory sentence when storageDir is %s', async (_label, value) => {
    stubRuntime({ ...INSTALLED, storageDir: value });

    const out = await runInstall();

    expect(out).toContain('Package installed into the running kernel');
    expect(out).not.toContain('cached');
    expect(out).not.toContain('survives restarts');
  });
});
