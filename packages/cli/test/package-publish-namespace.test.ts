// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0048 addendum §A.2 Phase A1 — `os package publish` carries the artifact's
 * namespace to the control plane.
 *
 * The publish-time exclusivity gate (Phase A2, enterprise-side) reads the
 * namespace off the publish payload. Before this phase the namespace never left
 * the artifact, so the gate had nothing to check. These cases pin the three
 * behaviours the addendum's algorithm distinguishes: a namespace present (it
 * travels), a namespace absent (`if (namespace is absent) -> allow` — the key
 * is simply not sent), and a namespace that is not a namespace (refused before
 * any network call).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreatePackageRequestSchema } from '@objectstack/spec/cloud';
import PackagePublish, { NAMESPACE_RE } from '../src/commands/package/publish.js';

type Call = { url: string; body: any };

function artifactJson(manifest: Record<string, unknown>): string {
  return JSON.stringify({
    manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.2.0', ...manifest },
    objects: [],
  });
}

/** Stub `fetch` so both publish POSTs succeed, and record what was sent. */
function stubCloud(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const data = url.endsWith('/versions')
      ? { id: 'ver_1', version: '1.2.0', listing_status: 'draft' }
      : { id: 'pkg_1', created: true, visibility: 'org' };
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data }) } as any;
  }));
  return calls;
}

describe('os package publish — namespace on the publish payload', () => {
  let dir = '';
  const prevEnv = { url: process.env.OS_CLOUD_URL, key: process.env.OS_CLOUD_API_KEY };
  const prevCwd = process.cwd();

  afterEach(async () => {
    process.chdir(prevCwd);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.OS_CLOUD_URL = prevEnv.url;
    process.env.OS_CLOUD_API_KEY = prevEnv.key;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function artifactAt(manifest: Record<string, unknown>): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'package-publish-ns-'));
    const path = join(dir, 'objectstack.json');
    await writeFile(path, artifactJson(manifest));
    process.env.OS_CLOUD_URL = 'http://cloud.test';
    process.env.OS_CLOUD_API_KEY = 'tok_123';
    return path;
  }

  it('sends `namespace` read off the compiled artifact manifest', async () => {
    const path = await artifactAt({ namespace: 'crm' });
    const calls = stubCloud();

    await PackagePublish.run([path]);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('http://cloud.test/api/v1/cloud/packages');
    expect(calls[0].body).toMatchObject({ manifest_id: 'com.acme.crm', namespace: 'crm' });
    // The value the CLI puts on the wire is one the acceptance face accepts.
    expect(CreatePackageRequestSchema.shape.namespace.safeParse(calls[0].body.namespace).success).toBe(true);
  });

  // Reverse verification, direction 1: an artifact with NO namespace must not
  // grow one. §A.2 allows an absent namespace, and the key must be absent
  // rather than null/'' so the gate never has to interpret an empty value.
  it('omits the key entirely when the artifact declares no namespace', async () => {
    const path = await artifactAt({});
    const calls = stubCloud();

    await PackagePublish.run([path]);

    expect(calls).toHaveLength(2);
    expect('namespace' in calls[0].body).toBe(false);
    expect(CreatePackageRequestSchema.shape.namespace.safeParse(undefined).success).toBe(true);
  });

  // Reverse verification, direction 2: a malformed namespace is refused, and
  // refused BEFORE the network call — silently dropping it would publish an
  // artifact whose namespace the A2 gate never sees.
  it('refuses a malformed namespace with exit code 1 and never calls the cloud', async () => {
    const path = await artifactAt({ namespace: 'CRM-App' });
    const calls = stubCloud();
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });

    let exitCode: number | undefined;
    try {
      await PackagePublish.run([path]);
    } catch (err: any) {
      exitCode = err?.oclif?.exit ?? err?.exitCode;
    }

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(errors.join('\n')).toContain("Invalid manifest.namespace 'CRM-App'");
    // The message names the rule and the remedy, not just the failure.
    expect(errors.join('\n')).toContain('objectstack.config.ts');
    // …and the payload schema agrees this value is not a namespace.
    const rejected = CreatePackageRequestSchema.shape.namespace.safeParse('CRM-App');
    expect(rejected.success).toBe(false);
    expect(rejected.success === false && rejected.error.issues[0].code).toBe('invalid_format');
  });

  // The namespace has exactly ONE source. `objectstack.manifest.json` may
  // override manifestId/displayName/category; it must not be able to claim a
  // namespace the artifact does not ship, or the reservation would name a
  // different string than the installed object prefix.
  it('ignores a namespace in objectstack.manifest.json — the artifact wins', async () => {
    const path = await artifactAt({ namespace: 'crm' });
    await writeFile(
      join(dir, 'objectstack.manifest.json'),
      JSON.stringify({ name: 'acme-crm', namespace: 'squatted', displayName: 'Acme CRM' }),
    );
    process.chdir(dir);
    const calls = stubCloud();

    await PackagePublish.run([path]);

    expect(calls[0].body.namespace).toBe('crm');
  });
});

describe('the CLI namespace rule is the spec namespace rule', () => {
  it('agrees with CreatePackageRequestSchema on every value', () => {
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      ['crm', true],
      ['todo', true],
      ['a1', true],
      ['my_app_2', true],
      ['abcdefghijklmnopqrst', true],
      ['a', false],
      ['abcdefghijklmnopqrstu', false],
      ['1crm', false],
      ['CRM', false],
      ['crm-app', false],
      ['crm.account', false],
      ['crm account', false],
      ['', false],
    ];
    const disagreements = cases.filter(([value, expected]) => {
      const cli = NAMESPACE_RE.test(value);
      const spec = CreatePackageRequestSchema.shape.namespace.safeParse(value).success;
      return cli !== expected || spec !== expected;
    });
    expect(disagreements).toEqual([]);
  });
});
