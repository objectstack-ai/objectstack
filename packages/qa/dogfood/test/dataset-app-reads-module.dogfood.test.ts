// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32929, #32967, ADR-0150 D3 (c)] An app package's dashboard on a dataset
// its own module holds — HotCRM's shape — on the two doors an author meets:
// `os validate` on the composed config, and the dataset door of the booted
// build-shaped artifact. One app package (`com.qa.sib.app`) and one module
// package (`com.qa.sib.rev`) that declares it, sharing a namespace. The module
// holds the object and the dataset.
//
// The maintainer ruled option two on #32929 (6840360115): the resolution rule
// stays the declared closure (N1, 6729820123), and authoring refuses what the
// runtime refuses. The three cells:
//
//   1. HotCRM's shape (the app's dashboard binds the module's dataset):
//      `os validate` exits 1 naming the move (BASE main 2c98485d: exit 0), and
//      the app's reader is refused `409 RESOURCE_CONFLICT` (outside-closure).
//   2. Moved into the module (the dashboard is the module's): `os validate`
//      exits 0, and the module's reader is served 200.
//   3. The dependency the old sentence asked for (the app declaring its own
//      module) is a cycle the kernel refuses at boot.
//
// Plus two fences of review 6857932402: a residual top-level `datasets` beside
// the composition leaves the union run as it was (M2), and an app declaring a
// dependency the artifact does not carry is reported, not refused (S1).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { composeStacks, defineStack } from '@objectstack/spec';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';

const APP = 'com.qa.sib.app';
const REV = 'com.qa.sib.rev';
const DATASET = 'sib_product_metrics';

const widget = (id: string) => ({ id, type: 'bar', title: id, dataset: DATASET, dimensions: ['category'], values: ['list_price_sum'], layout: { x: 0, y: 0, w: 6, h: 4 } });

/** A dependency no input of the artifact carries: an installed package may hold the dataset (#32967 S1). */
const ELSEWHERE = 'com.qa.sib.elsewhere';

/** The two input stacks, as plain configs: `appReads` puts the dashboard in the app package (HotCRM's shape). */
function inputsFor(appDependsOnModule: boolean, appReads = true, appDependsElsewhere = false) {
  const dependencies = {
    ...(appDependsOnModule ? { [REV]: '^1.0.0' } : {}),
    ...(appDependsElsewhere ? { [ELSEWHERE]: '^1.0.0' } : {}),
  };
  const app = {
    manifest: {
      id: APP, namespace: 'sib', name: 'qa_sib_app', version: '1.0.0', type: 'app',
      ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    },
    objects: [{ name: 'sib_account', label: 'Account', sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } }],
    ...(appReads ? { dashboards: [{ name: 'sib_overview', label: 'Overview', columns: 12, widgets: [widget('top_products')] }] } : {}),
  };
  const module = {
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
  };
  return { module, app };
}

function artifactFor(appDependsOnModule: boolean) {
  const { module, app } = inputsFor(appDependsOnModule);
  return composeStacks([defineStack(module as never), defineStack(app as never)], { manifest: 'preserve' }) as any;
}

const CLI_BIN = join(dirname(createRequire(import.meta.url).resolve('@objectstack/cli/package.json')), 'bin', 'run.js');
const SPEC_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/spec/package.json'));

/** A top-level dataset no package body declares: the residual ADR-0130 D4 registers under the manifest's id. */
const RESIDUAL = {
  name: 'sib_account_metrics', label: 'Account metrics', object: 'sib_account',
  dimensions: [{ name: 'name', label: 'Name', field: 'name', type: 'string' }],
  measures: [{ name: 'account_count', label: 'Accounts', aggregate: 'count' }],
};

/**
 * `os validate` on the composed config an author writes (the `app-multi-package` shape), in a scratch directory.
 * `residual` adds a top-level `datasets` beside the composition's `packages[]` (#32967 M2); `elsewhere` has the
 * app declare a dependency the artifact does not carry (#32967 S1).
 */
function validate(appReads: boolean, opts: { residual?: boolean; elsewhere?: boolean } = {}): { exitCode: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-app-reads-module-validate-'));
  try {
    const { module, app } = inputsFor(false, appReads, opts.elsewhere);
    const composed = `composeStacks([defineStack(${JSON.stringify(module)}), defineStack(${JSON.stringify(app)})], { manifest: 'preserve' })`;
    writeFileSync(
      join(dir, 'objectstack.config.mjs'),
      "import { composeStacks, defineStack } from '@objectstack/spec';\n\n"
        + (opts.residual
          ? `export default { ...${composed}, datasets: [${JSON.stringify(RESIDUAL)}] };\n`
          : `export default ${composed};\n`),
    );
    mkdirSync(join(dir, 'node_modules', '@objectstack'), { recursive: true });
    symlinkSync(SPEC_ROOT, join(dir, 'node_modules', '@objectstack', 'spec'), 'dir');
    const res = spawnSync(process.execPath, [CLI_BIN, 'validate'], {
      cwd: dir, encoding: 'utf8', timeout: 120_000, env: { ...process.env, NO_COLOR: '1' },
    });
    return { exitCode: res.status ?? 1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('[#32967] os validate refuses what the runtime refuses: the app\'s dashboard on its module\'s dataset', () => {
  it('cell 1: HotCRM\'s shape exits 1, naming the dataset, both packages and the move (BASE: exit 0)', () => {
    const run = validate(true);
    expect(run.exitCode, run.output).toBe(1);
    expect(run.output).toContain('widget-dataset-unknown');
    expect(run.output).toContain(DATASET);
    expect(run.output).toContain(REV);
    expect(run.output).toContain('dependency cycle');
  }, 180_000);

  it('cell 2: the dashboard moved into the module exits 0', () => {
    const run = validate(false);
    expect(run.exitCode, run.output).toBe(0);
  }, 180_000);

  it('M2: a residual top-level dataset leaves the union run unchanged: the module\'s dashboard on its own dataset exits 0', () => {
    // The union run carries the app's manifest (the last input's) and, the top level
    // holding `datasets`, folds only the bodies' dashboards: judged as the app's, the
    // module's own dataset would be outside the app's closure.
    const run = validate(false, { residual: true });
    expect(run.exitCode, run.output).toBe(0);
    expect(run.output).not.toContain('widget-dataset-unknown');
  }, 180_000);

  it('S1: HotCRM\'s shape with a dependency the artifact does not carry is reported, not refused (exit 0)', () => {
    const run = validate(true, { elsewhere: true });
    expect(run.exitCode, run.output).toBe(0);
    expect(run.output).toContain('widget-dataset-unknown');
    expect(run.output).toContain(`not judged: it may come from "${ELSEWHERE}"`);
    expect(run.output).not.toContain('refused 409');
  }, 180_000);
});

async function boot(artifact: unknown, dir: string): Promise<VerifyStack> {
  const artifactPath = join(dir, 'objectstack.json');
  writeBuildShapedArtifact(artifact as Record<string, unknown>, artifactPath);
  return bootStack(artifact, {
    extraPlugins: [new MetadataPlugin({ rootDir: dir, watch: false, artifactWatch: false, registerSystemObjects: false, artifactSource: { mode: 'local-file', path: artifactPath } })],
  });
}

const codeOf = (b: any) => (b?.error && typeof b.error === 'object' ? b.error.code : undefined) ?? b?.code ?? null;
const messageOf = (b: any) => String((b?.error && typeof b.error === 'object' ? b.error.message : b?.error) ?? b?.message ?? '');
/** The runtime's refusal names the move beside the dependency (#32929 PR 1). */
const CYCLE_MOVE = 'the dependency would be a cycle: move what reads it into that package';

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

  it('cell 1: the app\'s reader is refused 409 outside-closure, naming the move beside the dependency', async () => {
    const door = await query(`?callerPackage=${APP}`);
    expect([door.status, codeOf(door.body)], door.text).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(messageOf(door.body)).toContain(`The dataset "${DATASET}" is held outside the declared dependency closure of package "${APP}"`);
    expect(messageOf(door.body)).toContain(CYCLE_MOVE);
  });

  it('the batch door refuses the same entry in the same words, one entry per query', async () => {
    const res = await stack.apiAs(admin, 'POST', `/analytics/dataset/query/batch?callerPackage=${APP}`, { queries: [{ datasetName: DATASET, selection }] });
    expect(res.status).toBe(200);
    const [entry] = ((await res.json()) as any).data.results;
    expect([entry.status, entry.error.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(entry.error.message).toContain(CYCLE_MOVE);
  });

  it('cell 2: the module\'s own dashboard reads the dataset (200); CONTROL: the bare read is unchanged', async () => {
    const own = await query(`?callerPackage=${REV}`);
    expect(own.status, own.text).toBe(200);
    expect(own.body.rows).toHaveLength(2);
    const bare = await query('');
    expect(bare.status, bare.text).toBe(200);
    expect(bare.body.rows).toHaveLength(2);
  });
});

describe('[#32929] the dependency the old sentence asked for is a cycle the kernel refuses', () => {
  it('cell 3: an app package that declares its own module does not boot', async () => {
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
