// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An INSTALLED package carrying a page declaration a newer spec retires does
 * not stop the kernel build: the registration door replays the versioned
 * ADR-0087 forward conversion over a package body that declares its protocol
 * range, and refuses what survives it (`ObjectQL.convertPackageBodyForward`,
 * `engine.ts`).
 *
 * ## The artifact under test — HotCRM 4.0.1's published bundle
 *
 * `__fixtures__/hotcrm-4.0.1-published-pages.artifact.json` is
 * `dist/objectstack.json` as the `v4.0.1` tag of objectstack-ai/hotcrm builds
 * it with its own pinned toolchain (`@objectstack/cli` 17.7.0; the artifact
 * declares `engines.protocol: ^17.7.0`), trimmed to the artifact's `manifest`
 * and, per package body, the manifest fields and the FULL `pages` collection —
 * every other collection removed, every page byte-identical. Its two bodies
 * carry the shapes the #23610 retirements refuse: `sales_home_page` is a
 * `type: 'home'` page with `isDefault: true` (the refusal that stopped every
 * hosted environment's kernel build), three record pages spell
 * `template: 'full-width'`, and — with no lossless rewrite — two pages name an
 * unregistered template (`centered`, `utility-bar`) and the home page two
 * regions `three-column` does not place (`left_sidebar`, `right_sidebar`).
 *
 * ## The door under test — the one a hosted kernel reaches
 *
 * The measured failure named `MisplacedDefaultPageError`, the registry's own
 * refusal, and not a parse issue at `pages.N.template` — so the kernel that
 * failed registered the package BODIES through the `manifest` service /
 * `registerApp` with no strict body parse in between (a whole option-B
 * artifact handed to the service is parsed body by body by
 * `resolveArtifactPackageOrder` first, and HotCRM 4.0.1 fails that parse on
 * the shapes no conversion rewrites). This file drives that door: each body,
 * flat, through `manifest.register`.
 *
 * What is pinned:
 *   - the kernel builds: both bodies register, with a warning naming each
 *     conversion that fired, and the registry serves `sales_home_page` without
 *     the flag and the `full-width` pages as `default` — the converted copy is
 *     what registered, record and items alike;
 *   - the shapes with no lossless rewrite are left exactly as installed: the
 *     registry does not judge templates or regions (parse-only refusals), so
 *     they load as they always did;
 *   - CONTROL, the authoring posture: the same body with its declared range
 *     removed (a manifest a plugin builds in code) is still refused with the
 *     parse's sentence, and so is one authored against a floor newer than
 *     every retirement;
 *   - the ablation: with the D2 entry absent from the spec's step 18 the same
 *     boot is red again (run once at landing — the PR body carries the reading).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { MISPLACED_DEFAULT_PAGE_CODE } from './registry.js';
import type { ObjectQL } from './engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, '__fixtures__/hotcrm-4.0.1-published-pages.artifact.json');

type Bag = Record<string, any>;
type ManifestService = { register(m: unknown): void | Promise<void> };
type Refusal = Error & { code?: string; status?: number; name?: string };

const HOTCRM_ID = 'app.objectstack.hotcrm';
const SERVICE_ID = 'app.objectstack.hotcrm.service';
const IS_DEFAULT_CONVERSION = 'page-is-default-off-record-page-removed';
const TEMPLATE_CONVERSION = 'page-template-full-width-to-default';

/** The artifact, parsed fresh per call so no test sees another's mutation. */
const artifact = (): Bag => JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
/** One package body as a hosted kernel registers it: flat, as `os build` assembled it. */
const body = (id: string): Bag => {
  const entry = artifact().packages.find((e: Bag) => e.manifest.id === id);
  if (!entry) throw new Error(`fixture carries no package ${id}`);
  return entry.manifest;
};

const caught = async (fn: () => unknown): Promise<Refusal | undefined> => {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
};

const kernels: ObjectKernel[] = [];
const boot = async () => {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  kernels.push(kernel);
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  const warnings: string[] = [];
  (ql as unknown as { logger: { warn: (line: unknown) => void } }).logger.warn = (line: unknown) => { warnings.push(String(line)); };
  const manifest = kernel.getService<ManifestService>('manifest');
  return {
    registry: ql.registry,
    warnings,
    register: (m: unknown) => caught(() => manifest.register(m)),
    /** The engine door itself, with the artifact's own package list (ADR-0130 D1) — what a loader that holds the whole artifact hands over. */
    registerBody: (m: unknown, packageIds: string[]) => caught(() => ql.registerApp(m, { packageIds })),
  };
};

afterEach(async () => {
  while (kernels.length) {
    const k = kernels.pop()!;
    if (k.getState() === 'running') await k.shutdown();
  }
});

describe('the fixture is HotCRM 4.0.1\'s published page shape', () => {
  it('declares the 17.7.0 floor and carries every shape the #23610 retirements refuse', () => {
    const a = artifact();
    expect(a.manifest).toMatchObject({ id: HOTCRM_ID, version: '4.0.1', engines: { protocol: '^17.7.0' } });
    expect(a.packages.map((e: Bag) => e.manifest.id)).toEqual([SERVICE_ID, HOTCRM_ID]);
    const pages: Bag[] = a.packages.flatMap((e: Bag) => e.manifest.pages);
    expect(pages).toHaveLength(8);
    const home = pages.find((p) => p.name === 'sales_home_page')!;
    expect(home).toMatchObject({ type: 'home', isDefault: true, template: 'three-column' });
    expect(home.regions.map((r: Bag) => r.name)).toEqual(['header', 'left_sidebar', 'main', 'right_sidebar']);
    expect(pages.filter((p) => p.template === 'full-width').map((p) => p.name).sort()).toEqual([
      'case_detail_page', 'lead_detail_page', 'opportunity_detail_page',
    ]);
    expect(pages.filter((p) => !['default', 'header-sidebar-main', 'three-column', 'dashboard', 'full-width'].includes(p.template)).map((p) => [p.name, p.template])).toEqual([
      ['app_launcher_page', 'centered'],
      ['utility_bar_page', 'utility-bar'],
    ]);
  });
});

describe('a kernel built from HotCRM 4.0.1\'s published bundle boots, with the named warning', () => {
  it('registers both package bodies at the engine door, converting the retired declarations instead of refusing', async () => {
    const { registry, warnings, registerBody } = await boot();

    // The two bodies are co-owners of one artifact (both declare namespace
    // `crm`, ADR-0130 D1), so each is handed over with the artifact's package
    // list, as the `manifest` service hands every body of an artifact it
    // ordered. The `manifest.register` door for ONE body is pinned below.
    const scope = [SERVICE_ID, HOTCRM_ID];
    expect(await registerBody(body(SERVICE_ID), scope)).toBeUndefined();
    expect(await registerBody(body(HOTCRM_ID), scope)).toBeUndefined();

    // The named warning: one line per (package, conversion), naming the
    // conversion id, the body's floor and the first converted site.
    const named = (id: string, conversion: string) =>
      warnings.filter((w) => w.includes(`package '${id}'`) && w.includes(`conversion '${conversion}'`));
    expect(named(HOTCRM_ID, IS_DEFAULT_CONVERSION)).toHaveLength(1);
    expect(named(HOTCRM_ID, IS_DEFAULT_CONVERSION)[0]).toContain('declared protocol floor 17.7.0');
    expect(named(HOTCRM_ID, IS_DEFAULT_CONVERSION)[0]).toContain('first at pages[5].isDefault');
    expect(named(HOTCRM_ID, TEMPLATE_CONVERSION)).toHaveLength(1);
    expect(named(SERVICE_ID, TEMPLATE_CONVERSION)).toHaveLength(1);
    // The service body carries no misplaced default, so that conversion has nothing to say there.
    expect(named(SERVICE_ID, IS_DEFAULT_CONVERSION)).toEqual([]);

    // Both packages are installed and every page registered.
    expect(registry.getPackage(HOTCRM_ID)).toBeDefined();
    expect(registry.getPackage(SERVICE_ID)).toBeDefined();
    const pages = registry.listItems<Bag>('page');
    expect(pages.map((p) => p.name).sort()).toEqual([
      'account_detail_page', 'account_workbench', 'app_launcher_page', 'case_detail_page',
      'lead_detail_page', 'opportunity_detail_page', 'sales_home_page', 'utility_bar_page',
    ]);
    const page = (name: string) => pages.find((p) => p.name === name)!;

    // The converted copy registered: the flag is gone from the home page and
    // the three `full-width` pages read `default`, items and record alike.
    expect(page('sales_home_page')).not.toHaveProperty('isDefault');
    expect(page('sales_home_page')).toMatchObject({ type: 'home', template: 'three-column', _packageId: HOTCRM_ID });
    for (const name of ['case_detail_page', 'lead_detail_page', 'opportunity_detail_page']) {
      expect(page(name).template, name).toBe('default');
      // A default record page bound to an object keeps the one meaning the flag has.
      expect(page(name).isDefault, name).toBe(true);
    }
    const recordPages = (registry.getPackage(HOTCRM_ID)!.manifest as Bag).pages as Bag[];
    expect(recordPages.find((p) => p.name === 'sales_home_page')).not.toHaveProperty('isDefault');
    expect(recordPages.find((p) => p.name === 'lead_detail_page')!.template).toBe('default');

    // The shapes with no lossless rewrite are served exactly as installed: the
    // registry never judged templates or regions, and still does not.
    expect(page('app_launcher_page').template).toBe('centered');
    expect(page('utility_bar_page').template).toBe('utility-bar');
    expect(page('sales_home_page').regions.map((r: Bag) => r.name)).toEqual(['header', 'left_sidebar', 'main', 'right_sidebar']);
  });

  it('the package whose page stopped the measured kernel build registers through `manifest.register`, converted, with the warning', async () => {
    const { registry, warnings, register } = await boot();
    expect(await register(body(HOTCRM_ID))).toBeUndefined();
    expect(registry.getPackage(HOTCRM_ID)).toBeDefined();
    const home = registry.listItems<Bag>('page').find((p) => p.name === 'sales_home_page')!;
    expect(home).toBeDefined();
    expect(home).not.toHaveProperty('isDefault');
    expect(warnings.filter((w) => w.includes(`package '${HOTCRM_ID}'`) && w.includes(`conversion '${IS_DEFAULT_CONVERSION}'`))).toHaveLength(1);
  });

  it('registers the same body again without a second warning — the converted copy is idempotent and the line is deduped', async () => {
    const { warnings, register } = await boot();
    expect(await register(body(HOTCRM_ID))).toBeUndefined();
    const once = warnings.filter((w) => w.includes(`conversion '${IS_DEFAULT_CONVERSION}'`)).length;
    expect(once).toBe(1);
    expect(await register(body(HOTCRM_ID))).toBeUndefined();
    expect(warnings.filter((w) => w.includes(`conversion '${IS_DEFAULT_CONVERSION}'`))).toHaveLength(1);
  });
});

describe('CONTROL — the authoring posture at the same door is unchanged', () => {
  const expectMisplaced = (err: Refusal | undefined) => {
    expect(err, 'the registration was refused').toBeDefined();
    expect({ code: err!.code, status: err!.status }).toEqual({ code: MISPLACED_DEFAULT_PAGE_CODE, status: 422 });
    expect(err!.name).toBe('MisplacedDefaultPageError');
    expect(err!.message.startsWith(`Page "sales_home_page" of package "${HOTCRM_ID}": \`isDefault: true\` is refused on a \`type: 'home'\` page`)).toBe(true);
  };

  it('the same body with NO declared range — a manifest built in code — is still refused with the parse\'s sentence', async () => {
    const { registry, warnings, register } = await boot();
    const { engines: _engines, ...codeRegistered } = body(HOTCRM_ID);
    expectMisplaced(await register(codeRegistered));
    expect(registry.getPackage(HOTCRM_ID)).toBeUndefined();
    expect(registry.listItems<Bag>('page')).toEqual([]);
    expect(warnings.filter((w) => w.includes('ADR-0087 conversion'))).toEqual([]);
  });

  it('the same body authored against a floor newer than every retirement is still refused — the window is versioned, not an amnesty', async () => {
    const { registry, register } = await boot();
    expectMisplaced(await register({ ...body(HOTCRM_ID), engines: { protocol: '>=99.0.0' } }));
    expect(registry.getPackage(HOTCRM_ID)).toBeUndefined();
  });

  it('the item seam is the same door: a package-bound page registered directly, with no body to read a range off, is still refused', async () => {
    const { registry } = await boot();
    const home = body(HOTCRM_ID).pages.find((p: Bag) => p.name === 'sales_home_page');
    const err = await caught(() => registry.registerItem('page', home, 'name', HOTCRM_ID));
    expectMisplaced(err);
  });
});

describe('a whole option-B artifact handed to the manifest service converts before its bodies are parsed', () => {
  // The real 4.0.1 artifact also carries shapes no conversion rewrites
  // (`centered`, `utility-bar`, the two unplaced regions), which the strict
  // body parse of `resolveArtifactPackageOrder` refuses before any body
  // registers — so this case carries only the convertible shapes, in the
  // artifact's own `packages[]` form and under its own declared floor.
  it('an artifact declaring `^17.7.0` whose body carries a misplaced default and a `full-width` page registers, converted', async () => {
    const { registry, warnings, register } = await boot();
    const a = artifact();
    const home = body(HOTCRM_ID).pages.find((p: Bag) => p.name === 'sales_home_page');
    const lead = body(HOTCRM_ID).pages.find((p: Bag) => p.name === 'lead_detail_page');
    const payload = {
      ...a.manifest,
      packages: [{
        manifest: {
          ...body(HOTCRM_ID),
          pages: [
            { ...home, regions: home.regions.filter((r: Bag) => r.name === 'header' || r.name === 'main') },
            lead,
          ],
        },
      }],
    };
    expect(await register(payload)).toBeUndefined();
    const pages = registry.listItems<Bag>('page');
    expect(pages.find((p) => p.name === 'sales_home_page')).not.toHaveProperty('isDefault');
    expect(pages.find((p) => p.name === 'lead_detail_page')!.template).toBe('default');
    expect(warnings.filter((w) => w.includes(`conversion '${IS_DEFAULT_CONVERSION}'`))).toHaveLength(1);
  });
});
