// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os package publish` renders a failed publish as the SERVER's own sentence,
 * never as the literal `[object Object]` (#10763).
 *
 * ## The defect
 *
 * Both request helpers built their failure text with
 * `String(parsed?.error ?? response.statusText ?? ...)`. In the declared
 * envelope `error` is an OBJECT — `{ code, message }` — so `String(...)`
 * stringified the object, and `??` never reached `statusText` because an object
 * is not nullish. Every failed publish printed the same seven characters
 * regardless of what the control plane had refused and why.
 *
 * ## Why the reader is tolerant, and why that is a measurement rather than a guess
 *
 * The `/api/v1/cloud/**` routes are served by the sibling `cloud` repo, so no
 * in-repo suite can drive the real producer. The measurement that picked the
 * read shape is objectui's `readApiError`
 * (`packages/app-shell/src/console/marketplace/marketplaceApi.ts`): the same
 * `service-cloud` family answers failures in BOTH the declared envelope and a
 * flat `error: '<sentence>'` written by its `fail()` helper, mid-conversion
 * under cloud#944. Both arms are therefore driven below. A strict envelope-only
 * read would have turned today's live flat dialect into a different unreadable
 * failure, which is why #10675's reader is not reused here — see the docblock
 * on `readErrorMessage`.
 *
 * ## Why the command is driven rather than the helper alone
 *
 * The helper has its own unit coverage. These cases exist because the defect
 * was at the CALL SITE — the value handed to `printError` — and all three sites
 * (`postJson` twice, `postBinary` once) have to be shown reaching the operator
 * with the server's text, including the icon upload, which is the only
 * `postBinary` caller in the command.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendError } from '@objectstack/types';
import { serverBody } from '../src/utils/__tests__/server-body.js';
import PackagePublish from '../src/commands/package/publish.js';

/** A failure body written by the server's OWN writer — the declared envelope. */
const declared = (status: number, code: any, message: string) =>
  serverBody((r) => sendError(r, status, code, message));

/**
 * The control plane's still-live flat dialect (cloud#944). Written as a literal
 * because its writer lives in the closed `cloud` repo; this transcription is
 * what to re-check if that dialect ever changes.
 */
const flat = (message: string) => ({ success: false, error: message });

/** Smallest valid PNG, so `--icon-file` reaches the binary upload step. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

type Call = { url: string };

describe('os package publish — a failed publish shows the server’s reason', () => {
  let dir = '';
  const prevEnv = { url: process.env.OS_CLOUD_URL, key: process.env.OS_CLOUD_API_KEY };
  const prevCwd = process.cwd();
  let output: string[] = [];

  beforeEach(() => {
    output = [];
    for (const channel of ['error', 'log', 'warn'] as const) {
      vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
        output.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.OS_CLOUD_URL = prevEnv.url;
    process.env.OS_CLOUD_API_KEY = prevEnv.key;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  async function artifact(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'package-publish-err-'));
    const path = join(dir, 'objectstack.json');
    await writeFile(
      path,
      JSON.stringify({
        manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.2.0' },
        objects: [],
      }),
    );
    process.env.OS_CLOUD_URL = 'http://cloud.test';
    process.env.OS_CLOUD_API_KEY = 'tok_123';
    return path;
  }

  /**
   * Stub the cloud so exactly one step fails with `body`, and every earlier
   * step succeeds — so each case isolates one call site.
   */
  function stubCloud(failOn: 'packages' | 'icon' | 'versions', status: number, body: unknown): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      const step = url.endsWith('/icon') ? 'icon' : url.endsWith('/versions') ? 'versions' : 'packages';
      if (step === failOn) {
        // `statusText` is '' exactly as an HTTP/2 response reports it, so no
        // case can pass on a reason phrase the real transport would not supply.
        return { ok: false, status, statusText: '', json: async () => body } as any;
      }
      const data = step === 'versions'
        ? { id: 'ver_1', version: '1.2.0', listing_status: 'draft' }
        : step === 'icon'
          ? { icon_url: '/icons/com.acme.crm.png' }
          : { id: 'pkg_1', created: true, visibility: 'org' };
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data }) } as any;
    }));
    return calls;
  }

  async function runExpectingExit1(args: string[]): Promise<void> {
    let exitCode: number | undefined;
    try {
      await PackagePublish.run(args);
    } catch (err: any) {
      exitCode = err?.oclif?.exit ?? err?.exitCode;
    }
    expect(exitCode).toBe(1);
  }

  it('prints `error.message` from the declared envelope when registering the package fails', async () => {
    const path = await artifact();
    const calls = stubCloud(
      'packages',
      422,
      declared(422, 'PACKAGE_PUBLISH_FAILED', 'Namespace "crm" is reserved by another publisher.'),
    );

    await runExpectingExit1([path]);

    const printed = output.join('\n');
    expect(calls[0].url).toBe('http://cloud.test/api/v1/cloud/packages');
    expect(printed).toContain('Namespace "crm" is reserved by another publisher.');
    expect(printed).not.toContain('[object');
    // The status still reaches the operator alongside the reason.
    expect(printed).toContain('422');
  });

  it('prints the flat `fail()` sentence the control plane still emits (cloud#944)', async () => {
    const path = await artifact();
    stubCloud('packages', 403, flat('Publisher is not verified.'));

    await runExpectingExit1([path]);

    const printed = output.join('\n');
    expect(printed).toContain('Publisher is not verified.');
    expect(printed).not.toContain('[object');
  });

  it('prints the server’s reason when the VERSION publish fails — the second `postJson` site', async () => {
    const path = await artifact();
    const calls = stubCloud(
      'versions',
      422,
      declared(422, 'PACKAGE_PUBLISH_FAILED', 'Version 1.2.0 already exists for com.acme.crm.'),
    );

    await runExpectingExit1([path]);

    const printed = output.join('\n');
    expect(calls.map((c) => c.url)).toEqual([
      'http://cloud.test/api/v1/cloud/packages',
      'http://cloud.test/api/v1/cloud/packages/pkg_1/versions',
    ]);
    expect(printed).toContain('Version 1.2.0 already exists for com.acme.crm.');
    expect(printed).not.toContain('[object');
  });

  it('prints the server’s reason when the ICON upload fails — the `postBinary` site', async () => {
    const path = await artifact();
    const iconPath = join(dir, 'icon.png');
    await writeFile(iconPath, PNG_1X1);
    const calls = stubCloud('icon', 413, declared(413, 'VALIDATION_ERROR', 'Icon exceeds the 512 KB limit.'));

    await runExpectingExit1([path, '--icon-file', iconPath]);

    const printed = output.join('\n');
    expect(calls.some((c) => c.url.endsWith('/icon'))).toBe(true);
    expect(printed).toContain('Icon exceeds the 512 KB limit.');
    expect(printed).not.toContain('[object');
  });

  /**
   * Reverse verification. With no readable text anywhere in the body AND no
   * reason phrase (HTTP/2), the operator must still get the status line rather
   * than an empty tail — the half of the old chain that `??` also broke, since
   * an empty `statusText` is not nullish either.
   */
  it('falls back to the status line when the body carries no readable text', async () => {
    const path = await artifact();
    stubCloud('packages', 500, { success: false });

    await runExpectingExit1([path]);

    const printed = output.join('\n');
    expect(printed).toContain('HTTP 500');
    expect(printed).not.toContain('[object');
    expect(printed).not.toContain('undefined');
  });
});
