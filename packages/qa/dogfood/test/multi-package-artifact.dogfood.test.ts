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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import multiPackageStack from '@objectstack/example-multi-package';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const CORE = 'com.example.multi.core';
const ORDERS = 'com.example.multi.orders';

/** One row of `GET /api/v1/packages`, as far as these pins read it. */
interface PackageRow {
  manifest?: { id?: string; type?: string; namespace?: string; scope?: string };
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

  it('both rows are read-only — the server\'s own verdict, not a scope heuristic', () => {
    // ADR-0070 D2 / ADR-0130 Consequences row 6: a package booted from an
    // artifact through `registerApp` is read-only whatever its scope says,
    // because `isWritablePackage` reads `engine.manifests` FIRST. The module is
    // the row that separates that verdict from Studio's client-side
    // `scope !== 'project'` heuristic — it is authored with no `scope` key at
    // all, and a client rule reading the row alone cannot tell it from a
    // Studio-created writable base.
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
