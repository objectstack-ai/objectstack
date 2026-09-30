// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os package publish` sends `visibility` only when the author passed
 * `--visibility` (#20892).
 *
 * The package upsert (`POST /api/v1/cloud/packages`) is also the RE-publish
 * path, and for an existing package the control plane patches visibility
 * whenever the body carries one. The flag used to default to `'org'` and was
 * always sent, so re-publishing a new version of a `marketplace` package
 * without repeating `--visibility marketplace` silently moved it to `org` and
 * out of the marketplace. The route cannot tell a CLI default from a choice,
 * so the fix lives at the producer: an omitted flag is an omitted key.
 *
 * ## The stand-in route, and what it is NOT
 *
 * The consumer is objectstack-ai/cloud's route
 * (`packages/service-cloud/src/routes/package-publish.ts`), which this
 * repository cannot run. `standInRoute()` below models only the two facts the
 * card's cloud seat read and measured on that route — for an EXISTING package
 * `if (body.visibility) patch.visibility = visibility`, and for a NEW package
 * an absent value defaults to `org` (cloud ADR-0007 decision 2) — so the
 * "re-publish leaves it unchanged" and "create yields the route's default"
 * cases can be stated end to end. Every assertion that decides pass or fail
 * here is about what the CLI SENT or PRINTED; the stand-in's stored value is
 * the consequence, and the control case (`--visibility org` DOES change it)
 * proves the stand-in is capable of the demotion the pins say no longer
 * happens.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreatePackageRequestSchema } from '@objectstack/spec/marketplace';
import PackagePublish from '../src/commands/package/publish.js';

type Call = { url: string; body: Record<string, unknown> };
type StoredPackage = { id: string; visibility: string };

const MANIFEST_ID = 'com.acme.crm';

/**
 * Stub `fetch` as the stand-in route described in the header. `rows` is the
 * control plane's package table, keyed by manifest id; pass a row to model a
 * re-publish, omit it to model a first publish. `echoVisibility: false` models
 * a control plane whose upsert answer does not report the stored value.
 */
function standInRoute(
  rows: Map<string, StoredPackage>,
  opts: { echoVisibility?: boolean } = {},
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ url, body });
    let data: Record<string, unknown>;
    if (url.endsWith('/versions')) {
      data = { id: 'ver_1', version: '1.2.0', listing_status: 'draft' };
    } else {
      const manifestId = String(body.manifest_id);
      const existing = rows.get(manifestId);
      let row: StoredPackage;
      if (existing) {
        if (body.visibility) existing.visibility = String(body.visibility);
        row = existing;
      } else {
        row = { id: 'pkg_new', visibility: typeof body.visibility === 'string' ? body.visibility : 'org' };
        rows.set(manifestId, row);
      }
      data = { id: row.id, created: !existing };
      if (opts.echoVisibility !== false) data.visibility = row.visibility;
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data }) } as unknown as Response;
  }));
  return calls;
}

describe('os package publish — `visibility` is sent only when asked for', () => {
  let dir = '';
  const prevEnv = { url: process.env.OS_CLOUD_URL, key: process.env.OS_CLOUD_API_KEY };
  const prevCwd = process.cwd();
  let output: string[] = [];

  beforeEach(() => {
    output = [];
    for (const channel of ['error', 'log', 'warn'] as const) {
      vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
        // Strip ANSI styling so the assertions read the words, not the colours.
        output.push(args.map(String).join(' ').replace(/\u001b\[[0-9;]*m/g, ''));
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
    dir = await mkdtemp(join(tmpdir(), 'package-publish-visibility-'));
    const path = join(dir, 'objectstack.json');
    await writeFile(
      path,
      JSON.stringify({ manifest: { id: MANIFEST_ID, name: 'Acme CRM', version: '1.2.0' }, objects: [] }),
    );
    process.env.OS_CLOUD_URL = 'http://cloud.test';
    process.env.OS_CLOUD_API_KEY = 'tok_123';
    return path;
  }

  function printed(label: string): string | undefined {
    const line = output.find((l) => l.trimStart().startsWith(`${label}:`));
    return line?.slice(line.indexOf(':') + 1).trim();
  }

  it('omits the `visibility` key from the upsert body when --visibility is not passed', async () => {
    const path = await artifact();
    const calls = standInRoute(new Map());

    await PackagePublish.run([path]);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('http://cloud.test/api/v1/cloud/packages');
    expect('visibility' in calls[0].body).toBe(false);
    // The acceptance face treats an absent visibility as legal.
    expect(CreatePackageRequestSchema.shape.visibility.safeParse(undefined).success).toBe(true);
  });

  it.each(['private', 'org', 'marketplace'] as const)(
    'carries the flag value when --visibility %s is passed',
    async (value) => {
      const path = await artifact();
      const calls = standInRoute(new Map());

      await PackagePublish.run([path, '--visibility', value]);

      expect(calls[0].body.visibility).toBe(value);
      expect(CreatePackageRequestSchema.shape.visibility.safeParse(value).success).toBe(true);
    },
  );

  it('re-publishing a `marketplace` package without the flag leaves its visibility unchanged', async () => {
    const path = await artifact();
    const rows = new Map([[MANIFEST_ID, { id: 'pkg_1', visibility: 'marketplace' }]]);
    const calls = standInRoute(rows);

    await PackagePublish.run([path]);

    expect('visibility' in calls[0].body).toBe(false);
    expect(rows.get(MANIFEST_ID)?.visibility).toBe('marketplace');
    // The summary reports the control plane's answer, not a local default…
    expect(printed('Visibility')).toBe('marketplace');
    // …and the draft-listing hint fires on that answer too.
    expect(output.join('\n')).toContain('Hint: visibility is marketplace but the version is still draft');
  });

  // Control: the stand-in DOES demote when the body asks it to, so the case
  // above is green because the CLI stopped asking, not because nothing could
  // have changed the row.
  it('control — an explicit --visibility org on the same re-publish does move it', async () => {
    const path = await artifact();
    const rows = new Map([[MANIFEST_ID, { id: 'pkg_1', visibility: 'marketplace' }]]);
    standInRoute(rows);

    await PackagePublish.run([path, '--visibility', 'org']);

    expect(rows.get(MANIFEST_ID)?.visibility).toBe('org');
    expect(printed('Visibility')).toBe('org');
    expect(output.join('\n')).not.toContain('Hint: visibility is marketplace');
  });

  it('creating a package without the flag yields what the route decides, and prints that', async () => {
    const path = await artifact();
    const rows = new Map<string, StoredPackage>();
    const calls = standInRoute(rows);

    await PackagePublish.run([path]);

    expect('visibility' in calls[0].body).toBe(false);
    expect(rows.get(MANIFEST_ID)?.visibility).toBe('org');
    expect(printed('Visibility')).toBe('org');
  });

  it('says so when neither the flag nor the control plane names the visibility — never `undefined`', async () => {
    const path = await artifact();
    standInRoute(new Map([[MANIFEST_ID, { id: 'pkg_1', visibility: 'marketplace' }]]), { echoVisibility: false });

    await PackagePublish.run([path]);

    expect(printed('Visibility')).toBe('not reported by the control plane');
    expect(output.join('\n')).not.toMatch(/Visibility:\s*undefined/);
  });

  // `--submit` has no client-side precondition on the flag; the control plane
  // judges the STORED visibility. With the default gone, an omitted flag must
  // neither be refused locally nor re-introduce a visibility on the wire.
  it('--submit without --visibility submits for review and sends no visibility', async () => {
    const path = await artifact();
    const rows = new Map([[MANIFEST_ID, { id: 'pkg_1', visibility: 'marketplace' }]]);
    const calls = standInRoute(rows);

    await PackagePublish.run([path, '--submit']);

    expect(calls).toHaveLength(2);
    expect('visibility' in calls[0].body).toBe(false);
    expect(calls[1].url).toBe('http://cloud.test/api/v1/cloud/packages/pkg_1/versions');
    expect(calls[1].body.submit_for_review).toBe(true);
    expect(rows.get(MANIFEST_ID)?.visibility).toBe('marketplace');
  });
});
