// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21489 — `os package install` prints a runtime refusal with its CODE beside
 * the status, and the message (which carries the remedy) verbatim.
 *
 * The refusal that motivated it: install-local refuses a package whose enabled
 * job has no `body` with `422 VALIDATION_ERROR` and a message naming the job and
 * both remedies. Before this, the generic branch printed `Install failed (422):
 * <message>` — the machine-readable half an installer (human or AI) branches on
 * was dropped. The rendering is GENERIC on purpose: no case per code, so a
 * refusal this command has never heard of renders the same way, and an envelope
 * with no code renders the status alone, never an invented one.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import PackageInstall from '../src/commands/package/install.js';

/** Stub the runtime's install POST with a refusal envelope. */
function stubRefusal(status: number, error: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false,
    status,
    statusText: 'Refused',
    headers: { get: () => null },
    json: async () => ({ success: false, error }),
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
    await PackageInstall.run(['com.example.handlerjobs', '--runtime', 'http://runtime.test']);
  } catch (err: any) {
    exit = err?.oclif?.exit ?? err?.code;
  }
  return { out: lines.join('\n'), exit };
}

const REMEDY =
  "Package com.example.handlerjobs was not installed: its enabled job 'tick_job' (handler 'tick') has no `body`, "
  + 'so this install door cannot run it. Give the job a `body`, or boot the artifact with `os start --artifact`.';

describe('os package install — a refusal is printed with its code', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prints status, code and the remedy-carrying message, and exits 1', async () => {
    stubRefusal(422, { code: 'VALIDATION_ERROR', message: REMEDY });

    const { out, exit } = await runInstall();

    expect(out).toContain(`Install failed (422 VALIDATION_ERROR): ${REMEDY}`);
    expect(exit).toBe(1);
  });

  it('renders any code the same way — no case per code', async () => {
    stubRefusal(409, { code: 'MANIFEST_CONFLICT', message: 'already defined by local code' });

    const { out, exit } = await runInstall();

    expect(out).toContain('Install failed (409 MANIFEST_CONFLICT): already defined by local code');
    expect(exit).toBe(1);
  });

  it('an envelope with no code prints the status alone — never an invented code', async () => {
    stubRefusal(500, { message: 'boom' });

    const { out } = await runInstall();

    expect(out).toContain('Install failed (500): boom');
  });
});
