// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32929, ADR-0150 D3 (c)] An app package's dashboard on a dataset its own
// module holds, on a booted build-shaped artifact of HotCRM's shape: one app
// package (`com.qa.sib.app`) and one module package (`com.qa.sib.rev`) that
// declares it, sharing a namespace. The module holds the object and the
// dataset; the app's dashboard binds it.
//
// The maintainer ruled option two on #32929 (6840360115): the resolution rule
// stays the declared closure (N1, 6729820123), so the app's reader is refused
// `409 RESOURCE_CONFLICT` (outside-closure) — and because the module already
// depends on the app, declaring it back is a cycle the kernel refuses at boot,
// so the refusal also names the move (#32929 PR 1). `os validate` / `os build` refuse the same binding
// (`packages/lint/src/validate-widget-bindings.artifact-datasets.test.ts`).
//
// CONTROL: the module's own dashboard on the same dataset answers 200, and the
// bare read (a caller with no package) is unchanged.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { composeStacks, defineStack } from '@objectstack/spec';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';

const APP = 'com.qa.sib.app';
const REV = 'com.qa.sib.rev';
const DATASET = 'sib_product_metrics';

const widget = (id: string) => ({ id, type: 'bar', title: id, dataset: DATASET, dimensions: ['category'], values: ['list_price_sum'], layout: { x: 0, y: 0, w: 6, h: 4 } });

function artifactFor(appDependsOnModule: boolean) {
  const app = defineStack({
    manifest: {
      id: APP, namespace: 'sib', name: 'qa_sib_app', version: '1.0.0', type: 'app',
      ...(appDependsOnModule ? { dependencies: { [REV]: '^1.0.0' } } : {}),
    },
    objects: [{ name: 'sib_account', label: 'Account', sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } }],
    dashboards: [{ name: 'sib_overview', label: 'Overview', columns: 12, widgets: [widget('top_products')] }],
  } as never);
  const module = defineStack({
    manifest: { id: REV, namespace: 'sib', name: 'qa_sib_rev', version: '1.0.0', type: 'module', dependencies: { [APP]: '^1.0.0' } },
    objects: [{ name: 'sib_product', label: 'Product', sharingModel: 'public_read_write', fields: {
      name: { type: 'text', label: 'Name' }, category: { type: 'text', label: 'Category' }, list_price: { type: 'number', label: 'List price' },
    } }],
    datasets: [{
      name: DATASET, label: 'Product metrics', object: 'sib_product',
      dimensions: [{ name: 'category', label: 'Category', field: 'category', type: 'string' }],
      measures: [{ name: 'list_price_sum', label: 'List price', aggregate: 'sum', field: 'list_price' }],
    }],
    dashboards: [{ name: 'sib_rev_dashboard', label: 'Revenue', columns: 12, widgets: [widget('top_products')] }],
  } as never);
  return composeStacks([module, app], { manifest: 'preserve' }) as any;
}

async function boot(artifact: unknown, dir: string): Promise<VerifyStack> {
  const artifactPath = join(dir, 'objectstack.json');
  writeBuildShapedArtifact(artifact as Record<string, unknown>, artifactPath);
  return bootStack(artifact, {
    extraPlugins: [new MetadataPlugin({ rootDir: dir, watch: false, artifactWatch: false, registerSystemObjects: false, artifactSource: { mode: 'local-file', path: artifactPath } })],
  });
}

const codeOf = (b: any) => (b?.error && typeof b.error === 'object' ? b.error.code : undefined) ?? b?.code ?? null;
const messageOf = (b: any) => String((b?.error && typeof b.error === 'object' ? b.error.message : b?.error) ?? b?.message ?? '');
const MOVE = `Declare a dependency on the package that holds it (ADR-0141). If that package already depends on "${APP}", the dependency would be a cycle: `
  + `move what reads it into that package, or move the dataset into "${APP}" (ADR-0150 D3).`;

describe('[#32929] an app package\'s dashboard on its own module\'s dataset (ADR-0150 D3 (c))', () => {
  let stack: VerifyStack;
  let admin: string;
  let dir: string;
  const selection = { dimensions: ['category'], measures: ['list_price_sum'] };

  const query = async (qs: string) => {
    const res = await stack.apiAs(admin, 'POST', `/analytics/dataset/query${qs}`, { datasetName: DATASET, selection });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = undefined; }
    return { status: res.status, text, body };
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-app-reads-module-'));
    stack = await boot(artifactFor(false), dir);
    admin = await stack.signIn();
    for (const [category, list_price] of [['hw', 10], ['sw', 20], ['hw', 5]] as const) {
      const res = await stack.apiAs(admin, 'POST', '/data/sib_product', { name: `${category}${list_price}`, category, list_price });
      expect(res.status).toBeLessThan(300);
    }
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('each dashboard is served under its own package, the reader package the console sends', async () => {
    for (const [name, pkg] of [['sib_overview', APP], ['sib_rev_dashboard', REV]] as const) {
      const res = await stack.apiAs(admin, 'GET', `/meta/dashboard/${name}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).item._packageId).toBe(pkg);
    }
  });

  it('the app\'s reader is refused 409 outside-closure, naming the move beside the dependency', async () => {
    const door = await query(`?callerPackage=${APP}`);
    expect([door.status, codeOf(door.body)], door.text).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(messageOf(door.body)).toBe(
      `The dataset "${DATASET}" is held outside the declared dependency closure of package "${APP}": package "${REV}". ${MOVE}`,
    );
  });

  it('the batch door refuses the same entry in the same words, one entry per query', async () => {
    const res = await stack.apiAs(admin, 'POST', `/analytics/dataset/query/batch?callerPackage=${APP}`, { queries: [{ datasetName: DATASET, selection }] });
    expect(res.status).toBe(200);
    const [entry] = ((await res.json()) as any).data.results;
    expect([entry.status, entry.error.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(entry.error.message).toContain(MOVE);
  });

  it('CONTROL: the module\'s own dashboard reads the dataset (200), and the bare read is unchanged', async () => {
    const own = await query(`?callerPackage=${REV}`);
    expect(own.status, own.text).toBe(200);
    expect(own.body.rows).toHaveLength(2);
    const bare = await query('');
    expect(bare.status, bare.text).toBe(200);
    expect(bare.body.rows).toHaveLength(2);
  });
});

describe('[#32929] the dependency the old sentence asked for is a cycle the kernel refuses', () => {
  it('an app package that declares its own module does not boot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dogfood-app-reads-module-cycle-'));
    let booted: VerifyStack | undefined;
    try {
      await expect((async () => { booted = await boot(artifactFor(true), dir); })()).rejects.toThrow(/Circular dependency detected/);
    } finally {
      await booted?.stop?.();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
