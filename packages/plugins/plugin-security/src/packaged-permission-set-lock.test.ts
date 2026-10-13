// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Maintainer ruling 2026-08-24 (verbatim: 「同意 第一步(创业阶段,Salesforce
 * 式)」) — step 1: LOCK THE BASE, CLONE TO CUSTOMIZE.
 *
 * A Studio/API save targeting a package-declared permission set is refused at
 * the server with a message that names the sanctioned path (clone it), so no
 * silent overlay row is ever minted again.
 *
 * The lock's one door is the metadata door's authoring gate
 * (`packaged-permission-set-lock-gate.ts`, pinned end to end in
 * `packaged-permission-set-lock-gate.test.ts`). The `sys_permission_set` data
 * door that also consulted it retired with the catalog row objects (ADR-0131
 * D3), and its pins with it. This file pins the two halves that do not depend
 * on a door:
 *
 *  - the CLASSIFIER — "shipped by a code package" is judged from the
 *    provenance the SchemaRegistry carries, never from a name-keyed page read
 *    over a table (#21789);
 *  - the refusal's END-USER copy — the guidance reaches the wire as
 *    `userMessage`, through the producer's own error resolution.
 */

import { describe, it, expect } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import {
  classifyPackagedPermissionSet,
  PackagedPermissionSetLockedError,
  PackagedPermissionSetProvenanceUnknownError,
} from './packaged-permission-set-lock.js';
import { registerPackagedPermissionSetLockGate } from './packaged-permission-set-lock-gate.js';

// ─────────────────────────────────────────────────────────────────────────────
// Doubles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The engine surface the classifier reads: its SchemaRegistry, and nothing
 * else. `null` models a kernel with no readable registry.
 */
function makeQl(declared: any[] | null = null) {
  const ql: any = {};
  if (declared !== null) {
    ql.registry = { listItems: (type: string) => (type === 'permission' ? declared : []) };
  }
  return ql;
}

/** Register the lock on a protocol double and hand back the gate it registered. */
function lockGate(
  ql: any,
  getMetaItemLayered: (req: { name: string }) => Promise<unknown> = async ({ name }) =>
    ({ type: 'permission', name, code: null, overlay: null, effective: null }),
) {
  let gate: ((ctx: { type: string; name: string; body: unknown }) => Promise<void>) | undefined;
  const protocol = {
    registerAuthoringGate: (_type: string, g: typeof gate) => { gate = g; },
    getMetaItemLayered,
  };
  expect(registerPackagedPermissionSetLockGate(protocol, ql)).toBe(true);
  return gate!;
}

/** A shipped artifact: a body as the SchemaRegistry stamps it (ADR-0010). */
const packagedSet = (over: Record<string, any> = {}) => ({
  name: 'ehr_quality_inspector',
  label: 'Quality Inspector',
  objects: { obj_a: { allowRead: true }, obj_b: { allowRead: true } },
  systemPermissions: ['pkg.baseline'],
  _packageId: 'com.example.ehr',
  ...over,
});

/** An env-authored definition — the same body shape, with no package behind it. */
const orgSet = (over: Record<string, any> = {}) => ({
  name: 'org_support_agent',
  label: 'Support Agent',
  objects: { ticket: { allowRead: true } },
  systemPermissions: ['support.use'],
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// [#21789] The lock reads the ROW's provenance, not the presence of a package id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The registry holds stored rows as well as artifacts. The metadata layer
 * hydrates every env-wide `sys_metadata` row into it (a list read, and the
 * boot) as `mergeArtifactProtection(stateTenantAuthorship(row), artifact)`: the
 * row's `package_id` column stamped on as `_packageId`, `_provenance: 'org'`
 * written over it, and, only where a code artifact ships the name, the
 * artifact's envelope written over that. These builders produce exactly those
 * three bodies, so the verdicts below are about the shapes the boot really
 * registers, measured on a booted showcase.
 */
const RUNTIME_PACKAGE = 'app.crm_workspace';
/** Shape 1: a set saved into a writable runtime package, as hydrated. */
const hydratedRuntimePackageRow = (over: Record<string, any> = {}) => ({
  ...orgSet({ name: 'workspace_rep' }),
  _packageId: RUNTIME_PACKAGE,
  _provenance: 'org',
  ...over,
});
/** Shapes 2 and 3: the org's own set, and a clone, as hydrated (no package column). */
const hydratedOrgRow = (over: Record<string, any> = {}) => ({ ...orgSet(), _provenance: 'org', ...over });
/** A code-shipped artifact as the loader registers it (`applyProtection` with a package id). */
const shippedArtifact = (over: Record<string, any> = {}) => packagedSet({ _provenance: 'package', ...over });

describe('[#21789] the lock judges "shipped by a code package" from the row\'s provenance', () => {
  it('a set in a writable runtime package, hydrated with its package id, is NOT packaged', () => {
    expect(classifyPackagedPermissionSet('workspace_rep', makeQl([hydratedRuntimePackageRow()])))
      .toEqual({ status: 'org' });
  });

  it('an org-owned set and a clone, hydrated as stored rows, are NOT packaged', () => {
    const ql = makeQl([hydratedOrgRow(), hydratedOrgRow({ name: 'ehr_quality_inspector_local' })]);
    expect(classifyPackagedPermissionSet('org_support_agent', ql)).toEqual({ status: 'org' });
    expect(classifyPackagedPermissionSet('ehr_quality_inspector_local', ql)).toEqual({ status: 'org' });
  });

  it('control: a code-shipped set stays packaged, alone and beside a stored row of its name', () => {
    expect(classifyPackagedPermissionSet('ehr_quality_inspector', makeQl([shippedArtifact()])))
      .toEqual({ status: 'packaged', packageId: 'com.example.ehr' });
    // A legacy overlay of a shipped name is hydrated wearing the artifact's
    // envelope, and the artifact is in the same list: still packaged, in either order.
    const legacyOverlay = shippedArtifact({ systemPermissions: ['overlaid'] });
    for (const items of [[legacyOverlay, shippedArtifact()], [shippedArtifact(), legacyOverlay]]) {
      expect(classifyPackagedPermissionSet('ehr_quality_inspector', makeQl(items)))
        .toEqual({ status: 'packaged', packageId: 'com.example.ehr' });
    }
  });

  it('the layered read\'s code layer is judged the same way when there is no registry', () => {
    const ql = makeQl(null);
    const read = (code: unknown) => ({ status: 'read' as const, envelope: { code, overlay: null, effective: code } });
    expect(classifyPackagedPermissionSet('workspace_rep', ql, read(hydratedRuntimePackageRow())))
      .toEqual({ status: 'org' });
    expect(classifyPackagedPermissionSet('ehr_quality_inspector', ql, read(shippedArtifact())))
      .toEqual({ status: 'packaged', packageId: 'com.example.ehr' });
  });

  it('the metadata door accepts a runtime-package set and still refuses a code-shipped one with 403 NOT_OVERRIDABLE', async () => {
    const gate = lockGate(makeQl([hydratedRuntimePackageRow(), shippedArtifact()]));

    await expect(gate({ type: 'permission', name: 'workspace_rep', body: orgSet({ name: 'workspace_rep' }) }))
      .resolves.toBeUndefined();
    await expect(gate({ type: 'permission', name: 'ehr_quality_inspector', body: packagedSet() }))
      .rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The refusal's guidance reaches the END USER — `userMessage` on the wire
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The console renders a refusal's `userMessage` verbatim and substitutes its
 * generic "You don't have permission to save this record." for every 403 that
 * carries none (the objectui#5210 producer-side opt-in; `declaredUserMessage`
 * in `@objectstack/types` is the one read every door applies). An unmarked
 * lock refusal therefore told the admin nothing about the clone path, which is
 * the whole point of the ruling the lock implements.
 *
 * The wire envelope is computed by the producer's own mapping, not restated:
 * `resolveThrownHttpError` is the dispatcher door's resolution of the throw the
 * metadata door's gate raises.
 *
 * Every case asserts the envelope (`status` + `code`) AND the `userMessage`:
 * the code and status are the refusal's identity and must not move, and the
 * marked text is what this block is about. The text itself is not pinned word
 * for word — what is pinned is what the end user must and must not be shown:
 * the guidance (clone it), and none of the diagnostic's machine names, package
 * ids or API paths (the console's friendly-copy rule, objectstack#3821).
 */
describe('the lock refusal carries its guidance as `userMessage` on the wire envelope', () => {
  const PACKAGE_ID = 'com.example.ehr';
  const SET_NAME = 'ehr_quality_inspector';

  /** End-user copy: a non-empty string carrying none of the diagnostic's machine identifiers. */
  const expectEndUserCopy = (text: unknown, ...machineNames: string[]) => {
    expect(typeof text, 'userMessage must be present on the wire').toBe('string');
    expect(String(text).trim().length).toBeGreaterThan(0);
    for (const machineName of machineNames) {
      expect(text, `userMessage must not name '${machineName}'`).not.toContain(machineName);
    }
    expect(text, 'userMessage must not carry an API path').not.toMatch(/\/api\//);
  };

  it('a save of a package-declared set: 403 NOT_OVERRIDABLE with the clone guidance in `userMessage`', async () => {
    const gate = lockGate(makeQl([shippedArtifact()]));
    const rejection = await gate({ type: 'permission', name: SET_NAME, body: packagedSet() })
      .then(() => null, (e: any) => e);
    expect(rejection).toBeInstanceOf(PackagedPermissionSetLockedError);

    const resolved = resolveThrownHttpError(rejection);
    expect(resolved.status).toBe(403);
    expect(resolved.code).toBe('NOT_OVERRIDABLE');
    expectEndUserCopy(resolved.userMessage, SET_NAME, PACKAGE_ID);
    expect(String(resolved.userMessage)).toMatch(/clone it instead/i);
    // The diagnostic channel is untouched: it still names the set and the
    // package for logs and developers. The mark never replaces `message`.
    expect(String(rejection.message)).toContain(SET_NAME);
    expect(String(rejection.message)).toContain(PACKAGE_ID);
  });

  it('the fail-closed sibling (provenance unknown): 403 NOT_OVERRIDABLE with retry-or-clone guidance, and no diagnostic reason', async () => {
    const ql = makeQl([]);
    ql.registry = { listItems: () => { throw new Error('registry unavailable'); } };
    const gate = lockGate(ql, async () => { throw new Error('metadata store unavailable'); });
    const rejection = await gate({ type: 'permission', name: 'unknown_provenance', body: {} })
      .then(() => null, (e: any) => e);
    expect(rejection).toBeInstanceOf(PackagedPermissionSetProvenanceUnknownError);

    const resolved = resolveThrownHttpError(rejection);
    expect(resolved.status).toBe(403);
    expect(resolved.code).toBe('NOT_OVERRIDABLE');
    expectEndUserCopy(
      resolved.userMessage, 'unknown_provenance', 'registry unavailable', 'metadata store unavailable',
    );
    expect(String(resolved.userMessage)).toMatch(/try again/i);
    expect(String(resolved.userMessage)).toMatch(/clone/i);
    // The reason stays where it was: the diagnostic channel.
    expect(String(rejection.message)).toContain('registry unavailable');
  });
});
