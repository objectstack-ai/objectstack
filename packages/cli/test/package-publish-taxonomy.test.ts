// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os package publish` and the marketplace taxonomy (`@objectstack/spec/marketplace`,
 * `taxonomy.zod.ts`).
 *
 * - The retired `category` — in `objectstack.manifest.json` or as the hidden
 *   `--category` flag — is refused before any network call, naming the facets
 *   that replace it, for the value given when the spec's mapping knows it.
 * - The facets (`businessFunctions`, `industries`, `solutionType`, `maturity`)
 *   are judged by the spec's own schema for each key and sent under their wire
 *   names; an absent key is not sent.
 * - A declared `solutionType` is checked against the built artifact: a
 *   `template` needs the `unmanaged` install mode, a `connector` a declared
 *   connector.
 *
 * Each case drives the real command and reads the request body it sends — or
 * asserts that nothing was sent at all.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PackagePublish, { readPublishTaxonomy, retiredCategoryRefusal } from '../src/commands/package/publish.js';

type Call = { url: string; body: any };

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

const ARTIFACT = { manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.2.0' }, objects: [] };

describe('os package publish — the marketplace taxonomy', () => {
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

  async function projectWith(manifest: Record<string, unknown>, artifact: Record<string, unknown> = ARTIFACT): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'package-publish-taxonomy-'));
    const path = join(dir, 'objectstack.json');
    await writeFile(path, JSON.stringify(artifact));
    await writeFile(join(dir, 'objectstack.manifest.json'), JSON.stringify(manifest));
    process.chdir(dir);
    process.env.OS_CLOUD_URL = 'http://cloud.test';
    process.env.OS_CLOUD_API_KEY = 'tok_123';
    return path;
  }

  function captureOutput(): string[] {
    const lines: string[] = [];
    for (const channel of ['log', 'error', 'warn'] as const) {
      vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
    }
    return lines;
  }

  /** Run the command; the exit code it ended with (undefined when it did not exit). */
  async function run(argv: string[]): Promise<number | undefined> {
    try {
      await PackagePublish.run(argv);
      return undefined;
    } catch (err: any) {
      return err?.oclif?.exit ?? err?.exitCode;
    }
  }

  const BASE = {};

  describe('the retired category', () => {
    it('refuses a manifest `category` before any network call, naming the facets for its value', async () => {
      const path = await projectWith({ ...BASE, category: 'finance' });
      const calls = stubCloud();
      const out = captureOutput();

      expect(await run([path])).toBe(1);
      expect(calls).toEqual([]);
      const text = out.join('\n');
      expect(text).toContain('objectstack.manifest.json declares `category`, which was removed');
      expect(text).toContain('"finance" maps to "businessFunctions": ["finance"], "solutionType": "app"');
    });

    it('refuses the hidden --category flag the same way', async () => {
      const path = await projectWith({ ...BASE });
      const calls = stubCloud();
      const out = captureOutput();

      expect(await run([path, '--category', 'devtools'])).toBe(1);
      expect(calls).toEqual([]);
      expect(out.join('\n')).toContain('`--category` was removed');
      expect(out.join('\n')).toContain('"devtools" maps to "businessFunctions": ["it"]');
    });

    it('tells a project scaffolded from the blank template that `starter` never classified it', async () => {
      const path = await projectWith({ ...BASE, category: 'starter', isStarter: true });
      const calls = stubCloud();
      const out = captureOutput();

      expect(await run([path])).toBe(1);
      expect(calls).toEqual([]);
      expect(out.join('\n')).toContain('"starter" was the blank template\'s own marker');
      expect(out.join('\n')).not.toContain('"solutionType": "template"');
    });
  });

  describe('retiredCategoryRefusal', () => {
    it('names the author\'s choice for a value with no certain business function, and keeps the old word for search', () => {
      const refusal = retiredCategoryRefusal('manifest', 'analytics');
      expect(refusal).toContain('"analytics" maps to "solutionType": "app", and its business functions are yours to choose');
      expect(refusal).toContain('Keep "analytics" in `tags`');
    });

    it('says a value ADR-0019 never lists has no replacement', () => {
      expect(retiredCategoryRefusal('manifest', 'ui-theme')).toMatch(/"ui-theme" has no replacement: .*ADR-0019/);
    });

    it('lists the business functions for a value the mapping does not know', () => {
      expect(retiredCategoryRefusal('flag', 'travel-agency')).toMatch(/Business functions: sales, marketing, customer_service/);
    });
  });

  describe('the facets', () => {
    it('sends every declared facet under its wire name', async () => {
      const path = await projectWith({
        ...BASE,
        businessFunctions: ['sales', 'customer_service'],
        industries: ['retail'],
        solutionType: 'app',
        maturity: 'beta',
      });
      const calls = stubCloud();
      captureOutput();

      expect(await run([path])).toBeUndefined();
      expect(calls[0].body).toMatchObject({
        business_functions: ['sales', 'customer_service'],
        industries: ['retail'],
        solution_type: 'app',
        maturity: 'beta',
      });
      expect('category' in calls[0].body).toBe(false);
    });

    it('sends no facet the manifest does not declare, so a re-publish leaves the stored values alone', async () => {
      const path = await projectWith({ ...BASE });
      const calls = stubCloud();
      captureOutput();

      expect(await run([path])).toBeUndefined();
      for (const wire of ['business_functions', 'industries', 'solution_type', 'maturity']) {
        expect(wire in calls[0].body, wire).toBe(false);
      }
    });

    it('refuses a facet its spec schema refuses, before any network call', async () => {
      const path = await projectWith({ ...BASE, businessFunctions: ['sales', 'finance', 'hr', 'legal'] });
      const calls = stubCloud();
      const out = captureOutput();

      expect(await run([path])).toBe(1);
      expect(calls).toEqual([]);
      expect(out.join('\n')).toMatch(/`businessFunctions` is not valid: .*at most 3 business functions/);
    });
  });

  describe('the solutionType cross-check against the built artifact', () => {
    it('refuses a template whose artifact permits no unmanaged install', async () => {
      const path = await projectWith({ ...BASE, solutionType: 'template' });
      const calls = stubCloud();
      const out = captureOutput();

      expect(await run([path])).toBe(1);
      expect(calls).toEqual([]);
      expect(out.join('\n')).toContain("permits only ['managed']");
    });

    it('sends a template whose artifact permits an unmanaged install', async () => {
      const path = await projectWith(
        { ...BASE, solutionType: 'template' },
        { ...ARTIFACT, manifest: { ...ARTIFACT.manifest, installModes: ['managed', 'unmanaged'] } },
      );
      const calls = stubCloud();
      captureOutput();

      expect(await run([path])).toBeUndefined();
      expect(calls[0].body.solution_type).toBe('template');
    });

    it('refuses a connector whose artifact declares no connector', async () => {
      const path = await projectWith({ ...BASE, solutionType: 'connector' });
      const calls = stubCloud();
      const out = captureOutput();

      expect(await run([path])).toBe(1);
      expect(calls).toEqual([]);
      expect(out.join('\n')).toContain('declares no connector');
    });

    it('sends a connector whose artifact declares one', async () => {
      const path = await projectWith(
        { ...BASE, solutionType: 'connector' },
        { ...ARTIFACT, connectors: [{ name: 'stripe', provider: 'openapi' }] },
      );
      const calls = stubCloud();
      captureOutput();

      expect(await run([path])).toBeUndefined();
      expect(calls[0].body.solution_type).toBe('connector');
    });
  });

  describe('readPublishTaxonomy', () => {
    it('judges the artifact\'s install modes through the spec\'s resolver: an unreadable value counts as the default', () => {
      const verdict = readPublishTaxonomy({ solutionType: 'template' }, { manifest: { installModes: 'unmanaged' } });
      expect(verdict.ok).toBe(false);
    });
  });
});
