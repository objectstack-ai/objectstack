// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os package publish` carries the `objectstack.manifest.json` listing keys the
 * hosted catalog stores, and names every key it does not send, instead of
 * dropping it silently.
 *
 * `TemplateManifestSchema` accepts `tags` and `preview`, so an author (or an
 * AI agent) writes them and the file validates. The hosted publish route
 * validates and stores `tags`, so publish sends them as written: the server
 * owns the bounds, and its 400 is what the author reads. `preview` still waits
 * on what the hosted side accepts (`CATALOG_SEND_ISSUE`). The top-level
 * `tagline` has no column on the hosted side: publish uses it as the
 * `description` when none is given, and otherwise does not send it. The
 * retired `visibility` is refused by name (the `--visibility` flag carries
 * it), as is the retired `publisher` (a trust tier only the platform assigns),
 * and the retired keys that never changed what publish sent (`name`,
 * `specVersion`, `skills`, `scaffold`, `isStarter`) are named for deletion
 * without failing the publish.
 *
 * These cases drive the real command and read the request body it sends, pin
 * that the deletion warning does not fail the publish (every project
 * scaffolded from the blank template before the retirement carries
 * `isStarter: true`), and classify every schema key so a key added later
 * cannot be dropped silently again.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemplateManifestSchema } from '@objectstack/spec/marketplace';
import PackagePublish, {
  CATALOG_SEND_ISSUE,
  RETIRED_INERT_MANIFEST_KEYS,
  UNCARRIED_MANIFEST_KEYS,
  retiredPublisherRefusal,
  retiredVisibilityRefusal,
  uncarriedManifestKeys,
} from '../src/commands/package/publish.js';

type Call = { url: string; body: any };

/**
 * Stub `fetch` so both publish POSTs succeed, and record what was sent. With
 * `refusePackage`, the package POST answers that status and body instead.
 */
function stubCloud(refusePackage?: { status: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (refusePackage && !url.endsWith('/versions')) {
      return { ok: false, status: refusePackage.status, statusText: '', json: async () => refusePackage.body } as any;
    }
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
  'manifestId', 'displayName', 'description', 'tags', 'iconUrl',
  'homepageUrl', 'license', 'translations', 'readmePath',
  'businessFunctions', 'industries', 'solutionType', 'maturity',
] as const;
/**
 * Retired keys the schema still declares as tombstones: publish refuses them,
 * naming the replacement (`test/package-publish-taxonomy.test.ts`).
 */
const REFUSED = ['category', 'visibility', 'publisher'] as const;
/** Scaffold-time extras: read by `create-objectstack`, never a publish key. */
const SCAFFOLD_ONLY = ['namespace'] as const;

const DECLARES = 'objectstack.manifest.json declares';

describe('os package publish — manifest keys', () => {
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
    dir = '';
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

  /** Everything the command printed, on any console channel. */
  function captureOutput(): string[] {
    const lines: string[] = [];
    for (const channel of ['log', 'error', 'warn'] as const) {
      vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
    }
    return lines;
  }

  const warningsIn = (lines: string[]) => lines.filter((line) => line.includes(DECLARES));

  describe('tags', () => {
    it('sends the manifest’s tags as written, and does not warn about them', async () => {
      const path = await projectWith({ tags: ['crm', 'sales'] });
      const calls = stubCloud();
      const out = captureOutput();

      await PackagePublish.run([path]);

      expect(calls).toHaveLength(2);
      expect(calls[0].url).toBe('http://cloud.test/api/v1/cloud/packages');
      expect(calls[0].body.tags).toEqual(['crm', 'sales']);
      expect(warningsIn(out).some((line) => line.includes('`tags`'))).toBe(false);
    });

    it('sends a declared empty list, which clears the stored tags', async () => {
      const path = await projectWith({ tags: [] });
      const calls = stubCloud();
      captureOutput();

      await PackagePublish.run([path]);

      expect(calls[0].body.tags).toEqual([]);
    });

    it('sends no `tags` key when the manifest declares none, so the stored tags are left alone', async () => {
      const path = await projectWith({});
      const calls = stubCloud();
      captureOutput();

      await PackagePublish.run([path]);

      expect('tags' in calls[0].body).toBe(false);
    });

    it('applies no bound of its own: the server judges the list, and its refusal reaches the author as written', async () => {
      // More tags, and longer ones, than the hosted route accepts. The CLI
      // has no copy of those numbers, so the list reaches the wire unchanged
      // and the server's 400 is the author's answer.
      const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}-${'x'.repeat(64)}`);
      const path = await projectWith({ tags });
      const refusal = 'tags: at most 20 tags of at most 64 characters each';
      const calls = stubCloud({
        status: 400,
        body: { success: false, error: { code: 'VALUE_TOO_LONG', message: refusal, details: { field: 'tags' } } },
      });
      const out = captureOutput();

      let exitCode: number | undefined;
      try {
        await PackagePublish.run([path]);
      } catch (err: any) {
        exitCode = err?.oclif?.exit ?? err?.exitCode;
      }

      expect(exitCode).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0].body.tags).toEqual(tags);
      expect(out.join('\n')).toContain(refusal);
    });
  });

  describe('top-level `tagline`', () => {
    it('is sent as the `description` when neither --description nor the manifest gives one', async () => {
      const path = await projectWith({ tagline: '  CRM for small teams  ' });
      const calls = stubCloud();
      const out = captureOutput();

      await PackagePublish.run([path]);

      expect(calls[0].body.description).toBe('CRM for small teams');
      expect('tagline' in calls[0].body).toBe(false);
      expect(warningsIn(out).some((line) => line.includes('`tagline`'))).toBe(false);
    });

    it('is not sent when the manifest gives a `description`, and a warning names it', async () => {
      const path = await projectWith({
        description: 'Customer records', tagline: 'CRM for small teams',
      });
      const calls = stubCloud();
      const out = captureOutput();

      await PackagePublish.run([path]);

      expect(calls[0].body.description).toBe('Customer records');
      expect('tagline' in calls[0].body).toBe(false);
      expect(warningsIn(out).some((line) => line.includes('`tagline`'))).toBe(true);
    });

    it('is not sent when --description is passed, and a warning names it', async () => {
      const path = await projectWith({ tagline: 'CRM for small teams' });
      const calls = stubCloud();
      const out = captureOutput();

      await PackagePublish.run([path, '--description', 'From the flag']);

      expect(calls[0].body.description).toBe('From the flag');
      expect('tagline' in calls[0].body).toBe(false);
      expect(warningsIn(out).some((line) => line.includes('`tagline`'))).toBe(true);
    });

    it('leaves the per-locale `translations.*.tagline` as it was', async () => {
      const path = await projectWith({
        translations: { 'zh-CN': { tagline: '小团队的 CRM' } },
      });
      const calls = stubCloud();
      captureOutput();

      await PackagePublish.run([path]);

      expect(calls[0].body.translations).toEqual({ 'zh-CN': { tagline: '小团队的 CRM' } });
    });
  });

  describe('keys it does not send', () => {
    it('names the retired `isStarter` for deletion, still publishes, and never sends it', async () => {
      // The blank template wrote `isStarter: true` until its retirement, so
      // every project scaffolded from it carries the key.
      const path = await projectWith({ displayName: 'Acme CRM', isStarter: true });
      const calls = stubCloud();
      const out = captureOutput();

      await PackagePublish.run([path]);

      expect(calls).toHaveLength(2);
      const warnings = warningsIn(out);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('`isStarter`');
      expect(warnings[0]).toContain('removed in @objectstack/spec 18');
      // Not "not carried yet": nothing is pending on the hosted side for it.
      expect(warnings[0]).not.toContain('does not carry');
      expect(warnings[0]).not.toContain(CATALOG_SEND_ISSUE);
      // ⛔ Never sent under either spelling: the platform decides the starter flag.
      for (const key of ['isStarter', 'is_starter']) expect(key in calls[0].body).toBe(false);
    });

    it('names `preview` as not carried by the hosted catalog yet, with the tracking issue', async () => {
      const path = await projectWith({
        preview: { screenshots: ['shot.png'] },
      });
      const calls = stubCloud();
      const out = captureOutput();

      await PackagePublish.run([path]);

      expect(calls).toHaveLength(2);
      const warnings = warningsIn(out);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('`preview`');
      expect(warnings[0]).toContain('hosted catalog does not carry yet');
      expect(warnings[0]).toContain(CATALOG_SEND_ISSUE);
      expect('preview' in calls[0].body).toBe(false);
    });

    it('names the retired keys that never changed what it sent for deletion, and still publishes', async () => {
      // Every project scaffolded from the blank template before the retirement
      // carries these, so naming them must not fail the publish.
      const path = await projectWith({
        name: 'acme-crm', specVersion: '^18.0.0', skills: ['objectstack-data'], scaffold: { variables: {} },
        isStarter: true,
      });
      const calls = stubCloud();
      const out = captureOutput();

      await PackagePublish.run([path]);

      expect(calls).toHaveLength(2);
      const warnings = warningsIn(out);
      expect(warnings).toHaveLength(1);
      for (const key of RETIRED_INERT_MANIFEST_KEYS) {
        expect(warnings[0]).toContain(`\`${key}\``);
        expect(key in calls[0].body).toBe(false);
      }
      expect(warnings[0]).toContain('removed in @objectstack/spec 18');
      expect(warnings[0]).not.toContain(CATALOG_SEND_ISSUE);
    });

    it('stays quiet when the manifest declares only keys it sends', async () => {
      const path = await projectWith({ displayName: 'Acme CRM', tags: ['crm'] });
      stubCloud();
      const out = captureOutput();

      await PackagePublish.run([path]);

      expect(warningsIn(out)).toEqual([]);
    });
  });

  describe('the retired `publisher`', () => {
    it('is refused by name before any network call', async () => {
      const path = await projectWith({ displayName: 'Acme CRM', publisher: 'community' });
      const calls = stubCloud();
      const out = captureOutput();

      let exitCode: number | undefined;
      try {
        await PackagePublish.run([path]);
      } catch (err: any) {
        exitCode = err?.oclif?.exit ?? err?.exitCode;
      }

      expect(exitCode).toBe(1);
      expect(calls).toHaveLength(0);
      expect(out.join('\n')).toContain(retiredPublisherRefusal());
    });

    it('control: a manifest without it publishes, and the request carries no publisher', async () => {
      const path = await projectWith({ displayName: 'Acme CRM' });
      const calls = stubCloud();
      captureOutput();

      await PackagePublish.run([path]);

      expect(calls).toHaveLength(2);
      expect('publisher' in calls[0].body).toBe(false);
    });
  });

  describe('the retired `visibility`', () => {
    it('is refused by name before any network call, naming the flag that carries it', async () => {
      const path = await projectWith({ displayName: 'Acme CRM', visibility: 'marketplace' });
      const calls = stubCloud();
      const out = captureOutput();

      let exitCode: number | undefined;
      try {
        await PackagePublish.run([path]);
      } catch (err: any) {
        exitCode = err?.oclif?.exit ?? err?.exitCode;
      }

      expect(exitCode).toBe(1);
      expect(calls).toHaveLength(0);
      const printed = out.join('\n');
      expect(printed).toContain(retiredVisibilityRefusal());
      expect(printed).toContain('--visibility');
    });

    it('control: the --visibility flag alone still sets it, with no refusal', async () => {
      const path = await projectWith({ displayName: 'Acme CRM' });
      const calls = stubCloud();
      captureOutput();

      await PackagePublish.run([path, '--visibility', 'marketplace']);

      expect(calls).toHaveLength(2);
      expect(calls[0].body.visibility).toBe('marketplace');
    });
  });
});

describe('every TemplateManifestSchema key is sent, warned about, refused, retired, or scaffold-only', () => {
  it('partitions the schema keys exactly', () => {
    const schemaKeys = Object.keys(TemplateManifestSchema.shape).sort();
    const classified = [
      ...SENT, ...UNCARRIED_MANIFEST_KEYS, ...REFUSED, ...SCAFFOLD_ONLY, ...RETIRED_INERT_MANIFEST_KEYS,
    ].sort();
    expect(classified).toEqual(schemaKeys);
    // No key sits in two buckets.
    expect(new Set(classified).size).toBe(classified.length);
  });

  it('warns only about keys the schema accepts', () => {
    // A warned key the schema rejects would never reach publish; the list
    // would then be naming a key no valid file can carry.
    const fixture = { displayName: 'Acme CRM', tags: ['crm'], preview: { demoUrl: 'https://demo.example.com' } };
    expect(TemplateManifestSchema.safeParse(fixture).success).toBe(true);
    expect(uncarriedManifestKeys(fixture)).toEqual([...UNCARRIED_MANIFEST_KEYS]);
  });

  it('names for deletion only keys the schema refuses', () => {
    // Each retired key is a tombstone: a parse of the file refuses it, which
    // is what the warning tells the author.
    for (const key of RETIRED_INERT_MANIFEST_KEYS) {
      expect(TemplateManifestSchema.safeParse({ [key]: 'x' }).success, key).toBe(false);
    }
  });
});
