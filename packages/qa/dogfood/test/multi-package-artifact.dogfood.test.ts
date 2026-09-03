// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — ADR-0130 D4: one release artifact carrying TWO packages
// that share a namespace, booted for real and read back through the HTTP door
// a consumer reads.
//
// ## What would be green without this file
//
// Before this card, `packages[]` could be produced by nothing: `composeStacks(…,
// { manifest: 'preserve' })` folded N package IDENTITIES into the list, the
// load path iterated it, and every schema pin agreed — yet a two-package
// artifact installed two package records owning NOTHING, because the entries
// carried manifests with no metadata on them and the flattened top level (which
// does carry the metadata) is read only when `packages` is ABSENT. Every unit
// pin around that hole stayed green; only a boot notices.
//
// So this file asserts the two halves together, on one booted stack:
//
//   1. `GET /api/v1/packages` lists BOTH package rows — the artifact's
//      co-ownership declaration reached the registry (D1/D4).
//   2. Each package OWNS its own object — `crm_account` stamped to the App
//      package, `crm_order` to the module — which is the half a manifest-only
//      `packages[]` cannot deliver and the half that makes the split worth
//      anything (Studio scope, per-module context budget, a sellable unit).
//
// Boots a fixture stack of its own, so it stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import multiPackageStack from '@objectstack/example-multi-package';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';

const CORE = 'com.example.multi.core';
const ORDERS = 'com.example.multi.orders';

/** One row of `GET /api/v1/packages`, as far as these pins read it. */
interface PackageRow {
  manifest?: {
    id?: string;
    type?: string;
    namespace?: string;
    scope?: string;
    /** The definitions this package owns — an ASSEMBLED body's `objects` (#14599). */
    objects?: Array<{ name?: string }>;
  };
  writable?: boolean;
}

describe('dogfood: one artifact, two co-owning packages (ADR-0130 D4)', () => {
  let stack: VerifyStack;
  let token: string;
  let rows: PackageRow[];

  beforeAll(async () => {
    stack = await bootStack(multiPackageStack);
    token = await stack.signIn();
    const res = await stack.apiAs(token, 'GET', '/packages');
    expect(res.status, 'GET /api/v1/packages').toBe(200);
    // `sendOk(res, { packages, total })` — the shape read off the handler, not
    // guessed: a `?? []` fallback over a key this door does not send would turn
    // "the door answered something else" into "there are no packages", and this
    // file's whole subject is a list that is supposed to have two rows in it.
    const body = (await res.json()) as { data?: { packages?: PackageRow[]; total?: number } };
    expect(Array.isArray(body.data?.packages), `GET /packages answered ${JSON.stringify(body).slice(0, 400)}`).toBe(true);
    rows = body.data?.packages ?? [];
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('lists BOTH packages of the artifact', () => {
    const ids = rows.map((r) => r.manifest?.id).filter((id): id is string => typeof id === 'string');
    // Narrowed to this artifact's own packages: a booted kernel installs its
    // platform packages too, and asserting the whole list would pin the
    // kernel's boot composition instead of this artifact's registration.
    expect(ids.filter((id) => id.startsWith('com.example.multi.')).sort()).toEqual([CORE, ORDERS]);
  });

  it('carries both package TYPES — one app, one module, one namespace', () => {
    const core = rows.find((r) => r.manifest?.id === CORE);
    const orders = rows.find((r) => r.manifest?.id === ORDERS);

    expect(core?.manifest?.type).toBe('app');
    expect(orders?.manifest?.type).toBe('module');
    // The co-ownership ADR-0130 D1 is about: two packages, ONE namespace, and
    // no object renamed to buy the boundary (ADR-0129 D1–D2).
    expect(core?.manifest?.namespace).toBe('crm');
    expect(orders?.manifest?.namespace).toBe('crm');
  });

  it('both rows carry the schema default `scope: "project"` — nothing here is scope-less', () => {
    // [#14597] This file used to document `orders` as being SERVED with no
    // `scope` key. It authors none, but `defineStack` parses every `packages[]`
    // entry through `ManifestSchema` (`ArtifactPackageEntrySchema`), whose
    // `scope` is `.default('project')` — so the default is materialised at
    // compile time, into `dist/objectstack.json` and into both served rows.
    // Pinned on a real boot because that is the only place the old claim could
    // ever have been checked, and it never was: every unit pin around it
    // asserted a hand-built scope-less manifest instead of this artifact's.
    const core = rows.find((r) => r.manifest?.id === CORE);
    const orders = rows.find((r) => r.manifest?.id === ORDERS);

    expect(core?.manifest?.scope).toBe('project');
    expect(orders?.manifest?.scope).toBe('project');
  });

  it('both rows are read-only — the server\'s own verdict, not a scope heuristic', () => {
    // ADR-0070 D2 / ADR-0130 Consequences row 6: a package booted from an
    // artifact through `registerApp` is read-only whatever its scope says,
    // because `isWritablePackage` reads `engine.manifests` FIRST. That is the
    // whole content of the verdict here — and it is NOT reproducible from these
    // rows, which carry `scope: 'project'` (pinned above). ⛔ This fixture is
    // therefore not the row that separates the server rule from a client-side
    // `scope !== 'project'` one: the scope-less pair that does (a booted
    // marketplace import, read-only, vs a Studio-created base, writable) only
    // arises where a manifest reaches the registry without a `ManifestSchema`
    // parse, and is pinned in
    // `packages/runtime/src/domains/packages-writable-verdict.test.ts` (#14597).
    const core = rows.find((r) => r.manifest?.id === CORE);
    const orders = rows.find((r) => r.manifest?.id === ORDERS);

    // Asserted as a boolean, not as falsiness: `undefined` is what this row
    // carried before the verdict shipped, and `expect(...).toBeFalsy()` would
    // read a missing key as a passing answer.
    expect(core?.writable).toBe(false);
    expect(orders?.writable).toBe(false);
  });

  it('each object is owned by the package that declared it — not by the artifact', async () => {
    // The half a manifest-only `packages[]` cannot deliver. `_packageId` is the
    // stamp `registerApp` writes per manifest, so this is the co-ownership
    // claim measured where the registry actually holds it.
    const ql = await stack.kernel.getServiceAsync<{
      registry: { getObject(name: string): { _packageId?: string } | undefined };
    }>('objectql');

    expect(ql.registry.getObject('crm_account')?._packageId).toBe(CORE);
    expect(ql.registry.getObject('crm_order')?._packageId).toBe(ORDERS);
  });

  it('the shared namespace is owned by BOTH packages, not taken by one', async () => {
    // ADR-0130 D1's whole subject, read off the structure that always supported
    // it: `namespaceRegistry` is `Map<namespace, Set<packageId>>`, and the
    // install gate used to refuse the second package into an owned namespace.
    const ql = await stack.kernel.getServiceAsync<{
      registry: { getNamespaceOwners(ns: string): string[] };
    }>('objectql');

    expect([...ql.registry.getNamespaceOwners('crm')].sort()).toEqual([CORE, ORDERS]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// #14599 — the METADATA door, which the block above does not reach
// ───────────────────────────────────────────────────────────────────────────
//
// `bootStack` registers `AppPlugin` and no `MetadataPlugin`, so everything
// above is measured on the ObjectQL registry alone. The defect this block pins
// lives in the OTHER reader — `MetadataPlugin._parseAndRegisterArtifact`, the
// door a real `objectstack dev` / `objectstack serve` boot loads the artifact
// through — and the two only disagree once both are present. That is why this
// block boots the same stack a second time WITH the artifact door mounted, over
// a build-shaped artifact written to a temp file (`artifactSource`), exactly as
// `showcase-object-extension-meta-read.dogfood.test.ts` does.
//
// What it pins, in the words of the card:
//
//   1. `GET /api/v1/meta/object` serves ONE `crm_order` row and ONE
//      `crm_account` row, each carrying its OWN package id. Before the fix the
//      door registered the flattened top level stamped with the ARTIFACT's
//      `manifest.id` (the App package — `selectManifest`'s `'last'` pick), the
//      registry owned the same object under the module's id, and the list merge
//      — keyed `${packageId}${name}` — served `crm_order` TWICE.
//   2. `?package=` returns exactly what `GET /api/v1/packages` says that
//      package owns. Before the fix `?package=<the App>` returned the MODULE's
//      object, because the core-stamped copy was re-ingested as the App
//      package's contribution to `crm_order`.
//   3. The layers door and the item door name the SAME owner. Before the fix
//      layers said the App package and the item door said the module — one
//      platform, two answers to "who owns `crm_order`".
//
// ⚠️ This suite resolves `@objectstack/metadata` through its `dist/`, so an
// ablation of the door must REBUILD before each leg or it measures the previous
// build (see `scripts/ablation-dist-preflight.mjs`).

/** One row of a `/meta/<type>` list read, as far as these pins read it. */
interface MetaRow { name?: string; _packageId?: string; _packageVersion?: string | null }

describe('dogfood: the metadata door attributes a two-package artifact per package (#14599)', () => {
  let stack: VerifyStack;
  let token: string;
  let tempDir: string;
  /** `GET /api/v1/packages` from THIS boot — the door `?package=` is checked against. */
  let packageRows: PackageRow[];

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'os-14599-mp-'));
    const artifactPath = join(tempDir, 'objectstack.json');
    // The real build lowering, not `JSON.stringify(stack)` (#6293).
    writeBuildShapedArtifact(multiPackageStack as unknown as Record<string, unknown>, artifactPath);

    stack = await bootStack(multiPackageStack, {
      extraPlugins: [
        new MetadataPlugin({
          rootDir: tempDir,
          watch: false,
          artifactWatch: false,
          registerSystemObjects: false,
          artifactSource: { mode: 'local-file', path: artifactPath },
        }),
      ],
    });
    token = await stack.signIn();

    const pkgRes = await stack.apiAs(token, 'GET', '/packages');
    expect(pkgRes.status, 'GET /api/v1/packages').toBe(200);
    const pkgBody = (await pkgRes.json()) as { data?: { packages?: PackageRow[] } };
    expect(
      Array.isArray(pkgBody.data?.packages),
      `GET /packages answered ${JSON.stringify(pkgBody).slice(0, 300)}`,
    ).toBe(true);
    packageRows = pkgBody.data?.packages as PackageRow[];
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Read a `/meta/<type>` list door. The shape is ASSERTED rather than defaulted:
   * a `?? []` over a key the door does not send would turn "the door answered
   * something else" into "there are no rows", and a duplicate-row pin that reads
   * an empty list passes for the wrong reason.
   */
  const metaList = async (path: string): Promise<MetaRow[]> => {
    const res = await stack.apiAs(token, 'GET', path);
    expect(res.status, `GET /api/v1${path}`).toBe(200);
    const body = (await res.json()) as { items?: MetaRow[] };
    expect(Array.isArray(body.items), `GET /api/v1${path} answered ${JSON.stringify(body).slice(0, 300)}`)
      .toBe(true);
    return body.items as MetaRow[];
  };

  const crmRows = (rows: MetaRow[]): MetaRow[] =>
    rows.filter((r) => typeof r.name === 'string' && r.name.startsWith('crm_'));

  it('serves each object exactly ONCE, owned by the package that declares it', async () => {
    const rows = crmRows(await metaList('/meta/object'));

    // The duplicate, as a count: this was 3 rows for 2 objects.
    expect(rows.map((r) => r.name).sort()).toEqual(['crm_account', 'crm_order']);

    const byName = new Map(rows.map((r) => [r.name, r]));
    // The card's headline. Pre-fix ONE of the two `crm_order` rows carried this
    // id and the other carried the App package's.
    expect(byName.get('crm_order')?._packageId).toBe(ORDERS);
    expect(byName.get('crm_account')?._packageId).toBe(CORE);
  });

  it('`?package=` returns exactly what `GET /api/v1/packages` says that package owns', async () => {
    const core = crmRows(await metaList(`/meta/object?package=${CORE}`));
    const orders = crmRows(await metaList(`/meta/object?package=${ORDERS}`));

    // Pre-fix the App package's read returned BOTH objects — Studio's Data
    // pillar for the App package listed the module's Order alongside Account.
    expect(core.map((r) => r.name)).toEqual(['crm_account']);
    expect(orders.map((r) => r.name)).toEqual(['crm_order']);

    // Agreement with the package door, not two independently asserted lists:
    // the defect was precisely that these two doors disagreed.
    const owned = (id: string) => {
      const row = packageRows.find((r) => r.manifest?.id === id);
      const objects = row?.manifest?.objects;
      expect(Array.isArray(objects), `GET /packages row '${id}' carries no \`objects\``).toBe(true);
      return (objects as Array<{ name?: string }>).map((o) => o?.name).sort();
    };
    expect(core.map((r) => r.name).sort()).toEqual(owned(CORE));
    expect(orders.map((r) => r.name).sort()).toEqual(owned(ORDERS));
  });

  it('the layers door and the item door name the SAME owner', async () => {
    const layersRes = await stack.apiAs(token, 'GET', '/meta/object/crm_order/layers');
    expect(layersRes.status, 'GET /api/v1/meta/object/crm_order/layers').toBe(200);
    const layers = (await layersRes.json()) as {
      code?: { _packageId?: string }; packageId?: string; provenance?: string;
    };

    // Pre-fix: `com.example.multi.core` in both slots — the metadata service's
    // own copy, stamped with the artifact manifest.
    expect(layers.code?._packageId).toBe(ORDERS);
    expect(layers.packageId).toBe(ORDERS);

    // The item door, asked under the WRONG package on purpose: it answered
    // `orders` even pre-fix, and that disagreement with the layers door above
    // is what "the platform holds two answers" meant.
    const itemRes = await stack.apiAs(token, 'GET', `/meta/object/crm_order?package=${CORE}`);
    expect(itemRes.status).toBe(200);
    const item = (await itemRes.json()) as { item?: { _packageId?: string }; packageId?: string };

    expect(item.item?._packageId).toBe(ORDERS);
    expect(item.packageId).toBe(ORDERS);
    expect(item.packageId).toBe(layers.packageId);
  });
});
