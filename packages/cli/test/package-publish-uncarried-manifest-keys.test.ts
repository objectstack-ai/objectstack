// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os package publish` names every `objectstack.manifest.json` key it does not
 * send, instead of dropping it silently.
 *
 * `TemplateManifestSchema` inherits `tags`, `publisher`, `isStarter` and
 * `visibility` from `CreatePackageRequestSchema`, so an author (or an AI agent)
 * writes them and the file validates — but publish never carried them, and
 * the catalog simply showed none of it. These cases pin the warning, pin that
 * it does not fail the publish (the blank template ships `isStarter: true`),
 * and classify every schema key so a key added later cannot be dropped
 * silently again.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemplateManifestSchema } from '@objectstack/spec/marketplace';
import PackagePublish, { UNCARRIED_MANIFEST_KEYS, uncarriedManifestKeys } from '../src/commands/package/publish.js';

type Call = { url: string; body: any };

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

/**
 * Every `TemplateManifestSchema` key, by what publish does with it. A key the
 * schema gains lands in none of these and fails the partition test below.
 */
const SENT = [
  'manifestId', 'displayName', 'description', 'category', 'iconUrl',
  'homepageUrl', 'license', 'translations', 'readmePath',
] as const;
/** Scaffold-time extras: read by `create-objectstack` or docs, never a publish key. */
const SCAFFOLD_ONLY = ['name', 'specVersion', 'namespace', 'skills', 'preview', 'scaffold'] as const;

describe('os package publish — manifest keys it does not send', () => {
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

  async function projectWith(manifest: Record<string, unknown>): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'package-publish-uncarried-'));
    const path = join(dir, 'objectstack.json');
    await writeFile(path, JSON.stringify({
      manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.2.0' },
      objects: [],
    }));
    await writeFile(join(dir, 'objectstack.manifest.json'), JSON.stringify(manifest));
    process.chdir(dir);
    process.env.OS_CLOUD_URL = 'http://cloud.test';
    process.env.OS_CLOUD_API_KEY = 'tok_123';
    return path;
  }

  function captureLog(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    return lines;
  }

  it('names each declared key it does not send, and still publishes', async () => {
    const path = await projectWith({
      name: 'acme-crm',
      specVersion: '^18.0.0',
      displayName: 'Acme CRM',
      tags: ['crm', 'sales'],
      publisher: 'community',
      isStarter: true,
    });
    const calls = stubCloud();
    const log = captureLog();

    await PackagePublish.run([path]);

    expect(calls).toHaveLength(2);
    const warning = log.find((line) => line.includes('does not send to the control plane'));
    expect(warning).toBeDefined();
    for (const key of ['tags', 'publisher', 'isStarter']) expect(warning).toContain(`\`${key}\``);
    expect(warning).not.toContain('`visibility`');
    // Not sent under either spelling — the warning describes the wire.
    for (const key of ['tags', 'publisher', 'isStarter', 'is_starter']) {
      expect(key in calls[0].body).toBe(false);
    }
  });

  it('names `visibility` with the flag that does carry it', async () => {
    const path = await projectWith({ name: 'acme-crm', specVersion: '^18.0.0', visibility: 'marketplace' });
    const calls = stubCloud();
    const log = captureLog();

    await PackagePublish.run([path]);

    expect('visibility' in calls[0].body).toBe(false);
    const warning = log.find((line) => line.includes('does not send to the control plane'));
    expect(warning).toContain('`visibility`');
    expect(warning).toContain('--visibility');
  });

  it('stays quiet when the manifest declares none of them', async () => {
    const path = await projectWith({ name: 'acme-crm', specVersion: '^18.0.0', displayName: 'Acme CRM' });
    stubCloud();
    const log = captureLog();

    await PackagePublish.run([path]);

    expect(log.some((line) => line.includes('does not send to the control plane'))).toBe(false);
  });
});

describe('every TemplateManifestSchema key is sent, warned about, or scaffold-only', () => {
  it('partitions the schema keys exactly', () => {
    const schemaKeys = Object.keys(TemplateManifestSchema.shape).sort();
    const classified = [...SENT, ...UNCARRIED_MANIFEST_KEYS, ...SCAFFOLD_ONLY].sort();
    expect(classified).toEqual(schemaKeys);
    // No key sits in two buckets.
    expect(new Set(classified).size).toBe(classified.length);
  });

  it('warns only about keys the schema accepts', () => {
    // A warned key the schema rejects would never reach publish; the list
    // would then be naming a key no valid file can carry.
    const fixture = { name: 'acme-crm', specVersion: '^18.0.0', displayName: 'Acme CRM', tags: ['crm'], publisher: 'community', isStarter: true, visibility: 'org' };
    expect(TemplateManifestSchema.safeParse(fixture).success).toBe(true);
    expect(uncarriedManifestKeys(fixture)).toEqual([...UNCARRIED_MANIFEST_KEYS]);
  });
});
