// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The action's `(package, objectName, name)` key (ADR-0150 D4) — #31673, child
 * E2 of epic #31527: the declaration half, R's resolver over the `action`
 * items that own one object ({@link resolveActionByPackage}), and the handler
 * half's coordinate ({@link actionHandlerCoordinate}).
 *
 * The registry is the real `SchemaRegistry`, as R's own suite builds it:
 * packages through `installPackage` (their manifests are the declared closure),
 * items through `registerItem` under each package's composite slot.
 *
 * The negative pins (`refuses`, `never`) were each ablated once — the refused
 * behaviour put back, the pin read red, restored — and the readings are in the
 * PR body, not kept as test files.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry.js';
import { resolveActionByPackage, actionHolderCoordinate } from './action-package-addressing.js';
import { actionHandlerCoordinate, ENVIRONMENT_ACTION_COORDINATE, HOST_ACTION_COORDINATE } from './action-handler-coordinate.js';
import { resolvePackageScopedName, type PackageScopedResolution } from './package-scoped-resolver.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const P = 'com.acme.caller';

const manifest = (id: string, deps: string[] = []) => ({
  id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()!,
  ...(deps.length > 0 ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
}) as never;

let registry: SchemaRegistry;
const install = (id: string, deps: string[] = []) => registry.installPackage(manifest(id, deps), 'code');

/** A package's action `name`, bound to `objectName` (or object-less), labelled by its package. */
const ship = (name: string, packageId: string, objectName?: string) =>
  registry.registerItem('action', {
    name, label: `${packageId.split('.').pop()} ${objectName ?? 'global'}`, type: 'script',
    body: { language: 'js', source: 'return 1;', capabilities: [] },
    ...(objectName ? { objectName } : {}),
  }, 'name' as never, packageId);

/** An environment-authored action (no package), as `sys_metadata` hydration registers it. */
const authored = (name: string, objectName?: string) =>
  registry.registerItem('action', {
    name, label: `env ${objectName ?? 'global'}`, type: 'script',
    body: { language: 'js', source: 'return 1;', capabilities: [] },
    ...(objectName ? { objectName } : {}), _provenance: 'org',
  }, 'name' as never);

const label = (r: PackageScopedResolution): string | undefined =>
  r.status === 'resolved' ? (r.item as { label?: string }).label : undefined;

const resolve = (objectName: string | undefined, actionName: string, callerPackageId?: string | null) =>
  resolveActionByPackage(registry, { objectName, actionName, callerPackageId });

beforeEach(() => {
  registry = new SchemaRegistry();
  registry.logLevel = 'silent';
});

describe('ADR-0150 D4 — an object-bound action is keyed (package, objectName, name)', () => {
  it('two packages\' same-named actions on two objects never meet: each object resolves its own holder', () => {
    install(A);
    install(B);
    ship('approve', A, 'account');
    ship('approve', B, 'lead');
    // Control: R alone, on the registry's (type, name) key, sees two holders.
    expect(resolvePackageScopedName(registry, { type: 'action', name: 'approve' })).toMatchObject({ status: 'refused' });
    expect(label(resolve('account', 'approve'))).toBe('alpha account');
    expect(label(resolve('lead', 'approve'))).toBe('beta lead');
    // A's caller asks for `lead`: A's `account` action is not a candidate; B's is outside A's closure.
    expect(resolve('lead', 'approve', A)).toMatchObject({
      status: 'refused', reason: 'outside-closure', candidates: [{ kind: 'package', packageId: B }],
    });
    expect(label(resolve('account', 'approve', A))).toBe('alpha account');
  });

  it('a caller of package P resolves its own action on the object before a closure holder\'s', () => {
    install(A);
    install(P, [A]);
    ship('approve', A, 'account');
    ship('approve', P, 'account');
    const r = resolve('account', 'approve', P);
    expect(r).toMatchObject({ status: 'resolved', via: 'own', holder: { kind: 'package', packageId: P } });
    expect(label(r)).toBe('caller account');
  });

  it('refuses a caller whose closure holds the name on the object twice, naming both holders', () => {
    install(A);
    install(B);
    install(P, [A, B]);
    ship('approve', A, 'account');
    ship('approve', B, 'account');
    const r = resolve('account', 'approve', P);
    expect(r).toMatchObject({ status: 'refused', reason: 'ambiguous-in-closure' });
    if (r.status !== 'refused') throw new Error('unreachable');
    expect(r.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    for (const id of [A, B]) expect(r.message).toContain(id);
  });

  it('D3 (a) — refuses a package caller whose only holder on the object is an environment-authored action, naming the environment', () => {
    install(P);
    authored('approve', 'account');
    const r = resolve('account', 'approve', P);
    expect(r).toMatchObject({ status: 'refused', reason: 'outside-closure', candidates: [{ kind: 'environment' }] });
  });

  it('D3 (a) control — the same environment-authored action resolves for a caller with no package', () => {
    install(P);
    authored('approve', 'account');
    expect(resolve('account', 'approve')).toMatchObject({ status: 'resolved', via: 'environment', holder: { kind: 'environment' } });
  });

  it('refuses a package caller whose only holder is a package outside its closure, naming it — never served', () => {
    install(A);
    install(P);
    ship('approve', A, 'account');
    expect(resolve('account', 'approve', P)).toMatchObject({
      status: 'refused', reason: 'outside-closure', candidates: [{ kind: 'package', packageId: A }],
    });
  });

  it('falls to the object-less holders only when no holder is bound to the object, in the router\'s order', () => {
    install(A);
    install(B);
    install(P, [A, B]);
    ship('approve', A); // object-less
    expect(label(resolve('account', 'approve', P))).toBe('alpha global');
    ship('approve', B, 'account');
    expect(label(resolve('account', 'approve', P))).toBe('beta account');
  });

  it('a refusal on the object never falls through to an object-less holder', () => {
    install(A);
    install(B);
    install(P, [A, B]);
    ship('approve', A, 'account');
    ship('approve', B, 'account');
    registry.registerItem('action', { name: 'approve', label: 'caller global', type: 'script', body: { language: 'js', source: 'return 1;', capabilities: [] } }, 'name' as never, P);
    expect(resolve('account', 'approve', P)).toMatchObject({ status: 'refused', reason: 'ambiguous-in-closure' });
  });

  it('an object-less route resolves among the object-less holders only', () => {
    install(A);
    install(P, [A]);
    ship('approve', A, 'account');
    expect(resolve('global', 'approve', P)).toEqual({ status: 'not-found' });
    ship('approve', P);
    expect(label(resolve('global', 'approve', P))).toBe('caller global');
  });

  it('one holder of the name answers the same item R\'s own read answers (phase-1 parity, reading (b))', () => {
    install(A);
    ship('approve', A, 'account');
    const r = resolve('account', 'approve');
    const direct = resolvePackageScopedName(registry, { type: 'action', name: 'approve' });
    expect(r).toEqual(direct);
    expect(r.status === 'resolved' ? actionHolderCoordinate(r) : undefined).toBe(A);
  });
});

describe('ADR-0150 D4 — the coordinate a handler is registered under', () => {
  it('reads a package\'s handler owner `app:ID` as that package, a plugin id as itself', () => {
    expect(actionHandlerCoordinate(`app:${A}`)).toBe(A);
    expect(actionHandlerCoordinate('com.objectstack.plugin.auth')).toBe('com.objectstack.plugin.auth');
  });

  it('reads the authored-action resync as the environment\'s slot, and no owner as host code\'s — two slots', () => {
    expect(actionHandlerCoordinate('metadata-service')).toBe(ENVIRONMENT_ACTION_COORDINATE);
    for (const owner of [undefined, '']) expect(actionHandlerCoordinate(owner)).toBe(HOST_ACTION_COORDINATE);
    expect(HOST_ACTION_COORDINATE).not.toBe(ENVIRONMENT_ACTION_COORDINATE);
  });

  it('an environment holder resolves to the environment\'s coordinate', () => {
    authored('approve', 'account');
    const r = resolve('account', 'approve');
    expect(r.status === 'resolved' ? actionHolderCoordinate(r) : 'x').toBe(ENVIRONMENT_ACTION_COORDINATE);
  });
});
