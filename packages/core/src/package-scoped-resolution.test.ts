// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package-scoped resolution rule (ADR-0150 D3) as a pure function of a
 * holder set and a closure — epic #31527 child R2 (#31716). No registry: the
 * holders are plain `(package, item)` pairs and the closure a plain map, so
 * every arm is pinned on the rule alone. objectql's two adapters (the
 * registry's holders, the engine's function holders) are pinned against this
 * in `packages/objectql/src/package-scoped-resolver.test.ts`.
 *
 * The `red line` cases are negative pins: each was ablated once (the loosened
 * behaviour put back, the pin read red, restored), readings in the PR body.
 */

import { describe, expect, it } from 'vitest';
import {
  BARE_NAME_ONE_HOLDER_TYPES,
  ENGINE_FUNCTION_TYPE,
  NAMESPACE_SCOPED_BARE_NAME_TYPES,
  OVERRIDABLE_BASELINE_PACKAGES,
  PackageScopedNameRefusedError,
  RUNTIME_COMPATIBILITY_PACKAGE_ID,
  isNamespaceScopedBareNameType,
  isPackageScopedType,
  packageScopedActionOwnersSentence,
  packageScopedHolderSource,
  resolvePackageScopedHolders,
  type PackageResolutionClosureOf,
  type PackageScopedResolvableType,
} from './package-scoped-resolution.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const C = 'com.acme.gamma';
const P = 'com.acme.caller';
const EMAIL = [...OVERRIDABLE_BASELINE_PACKAGES.email_template][0];

/** A closure where `P` reaches `reach`, and every other caller reaches nothing. */
const closure = (reach: readonly string[]): PackageResolutionClosureOf => (caller) => new Set(caller === P ? reach : []);

const resolve = (
  pairs: Array<[string | null, string]>,
  reach: readonly string[],
  callerPackageId?: string | null,
  type: PackageScopedResolvableType = 'flow',
  name = 'send_email',
) => resolvePackageScopedHolders({ type, name, callerPackageId }, packageScopedHolderSource(pairs), closure(reach));

describe('ADR-0150 D3 over a supplied holder set — a caller that belongs to a package', () => {
  it("answers the caller's own item before a closure holder", () => {
    expect(resolve([[A, 'a'], [P, 'p']], [A], P)).toEqual({ status: 'resolved', item: 'p', holder: { kind: 'package', packageId: P }, via: 'own' });
  });

  it('answers the unique holder in the closure; a holder outside it is no candidate', () => {
    expect(resolve([[C, 'c'], [A, 'a']], [A], P)).toEqual({ status: 'resolved', item: 'a', holder: { kind: 'package', packageId: A }, via: 'closure' });
  });

  it('asks the closure only when the caller holds no item itself', () => {
    let asked = 0;
    const counting: PackageResolutionClosureOf = () => { asked += 1; return new Set(); };
    resolvePackageScopedHolders({ type: 'flow', name: 'n', callerPackageId: P }, packageScopedHolderSource([[P, 'p']]), counting);
    expect(asked).toBe(0);
    resolvePackageScopedHolders({ type: 'flow', name: 'n', callerPackageId: P }, packageScopedHolderSource([[A, 'a']]), counting);
    expect(asked).toBe(1);
  });

  it('zero holders is not-found', () => {
    expect(resolve([], [A], P)).toEqual({ status: 'not-found' });
  });

  it('a holder that lacks what was asked answers not-found, never another holder', () => {
    const source = { packageHolders: [A], packageItem: () => undefined, environmentItem: () => undefined };
    expect(resolvePackageScopedHolders({ type: 'email_template', name: 'welcome', callerPackageId: P }, source, closure([A]))).toEqual({ status: 'not-found' });
  });
});

describe('ADR-0150 D3 over a supplied holder set — a caller with no package', () => {
  it("answers the environment's own item first, then the unique package holder", () => {
    expect(resolve([[A, 'a'], [null, 'env']], [])).toMatchObject({ status: 'resolved', item: 'env', via: 'environment', holder: { kind: 'environment' } });
    expect(resolve([[A, 'a']], [])).toMatchObject({ status: 'resolved', item: 'a', via: 'unique-holder' });
  });

  it('reads `null`, `""` and the `sys_metadata` sentinel as no caller package, and never asks the closure', () => {
    const never: PackageResolutionClosureOf = () => { throw new Error('asked'); };
    for (const caller of [undefined, null, '', 'sys_metadata']) {
      expect(resolvePackageScopedHolders({ type: 'flow', name: 'n', callerPackageId: caller }, packageScopedHolderSource([[A, 'a']]), never))
        .toMatchObject({ status: 'resolved', via: 'unique-holder' });
    }
  });
});

describe('red line 1 — the rule never loosens', () => {
  it('two holders in the closure refuse: no first- or last-listed pick', () => {
    expect(resolve([[A, 'a'], [B, 'b']], [A, B], P)).toMatchObject({ status: 'refused', reason: 'ambiguous-in-closure', callerPackageId: P });
  });

  it('two package holders refuse a caller with no package', () => {
    expect(resolve([[A, 'a'], [B, 'b']], [])).toMatchObject({ status: 'refused', reason: 'ambiguous-in-environment', callerPackageId: null });
  });

  it('a name held only outside the closure is refused, never an environment-wide guess', () => {
    expect(resolve([[C, 'c']], [A], P)).toMatchObject({ status: 'refused', reason: 'outside-closure', candidates: [{ kind: 'package', packageId: C }] });
  });

  it("a package caller is refused the environment's own item (D3 (a))", () => {
    expect(resolve([[null, 'env']], [A], P)).toMatchObject({ status: 'refused', reason: 'outside-closure', candidates: [{ kind: 'environment' }] });
  });
});

describe('red line 2 — every refusal names every candidate', () => {
  it('in the closure, in the environment and outside the closure', () => {
    const three: Array<[string | null, string]> = [[A, 'a'], [B, 'b'], [C, 'c']];
    const packages = [A, B, C].map((packageId) => ({ kind: 'package', packageId }));
    for (const [reach, caller] of [[[A, B, C], P], [[], undefined]] as const) {
      const r = resolve(three, reach, caller);
      if (r.status !== 'refused') throw new Error(`expected a refusal, got ${r.status}`);
      expect(r.candidates).toEqual(packages);
      for (const id of [A, B, C]) expect(r.message).toContain(`package "${id}"`);
    }
    const outside = resolve([...three, [null, 'env']], [], P);
    if (outside.status !== 'refused') throw new Error(`expected a refusal, got ${outside.status}`);
    expect(outside.candidates).toEqual([...packages, { kind: 'environment' }]);
    expect(outside.message).toContain('the environment');
  });
});

describe('ADR-0150 D3 exceptions over a supplied holder set', () => {
  it('a platform-requested name resolves environment-wide whatever the caller', () => {
    expect(resolve([[C, 'c']], [], P, 'permission', 'guest_portal')).toMatchObject({ status: 'resolved', via: 'unique-holder' });
    expect(resolve([[C, 'c']], [], P, 'permission', 'sales_rep')).toMatchObject({ status: 'refused', reason: 'outside-closure' });
  });

  it('an overridable baseline yields to another holder of the step, and answers when it is the only one', () => {
    expect(resolve([[EMAIL, 'builtin']], [EMAIL], P, 'email_template', 'auth.password_reset')).toMatchObject({ status: 'resolved', via: 'baseline' });
    expect(resolve([[EMAIL, 'builtin'], [A, 'a']], [EMAIL, A], P, 'email_template', 'auth.password_reset')).toMatchObject({ status: 'resolved', item: 'a', via: 'closure' });
    expect(resolve([[EMAIL, 'builtin'], [A, 'a']], [], undefined, 'email_template', 'auth.password_reset')).toMatchObject({ status: 'resolved', item: 'a', via: 'unique-holder' });
  });

  it('resolves the engine\'s functions, and refuses positions and objects', () => {
    expect(resolve([[A, 'fn']], [A], P, ENGINE_FUNCTION_TYPE, 'score')).toMatchObject({ status: 'resolved', via: 'closure' });
    for (const type of ['position', 'object']) {
      expect(() => resolve([[A, 'x']], [A], P, type as PackageScopedResolvableType)).toThrow(TypeError);
    }
  });
});

describe('the holder source', () => {
  it('keeps the pairs\' order, `null` as the environment, and is a snapshot', () => {
    const pairs: Array<[string | null, string]> = [[B, 'b'], [null, 'env'], [A, 'a']];
    const source = packageScopedHolderSource(pairs);
    pairs.push([C, 'c']);
    expect(source.packageHolders).toEqual([B, A]);
    expect(source.packageItem(A)).toBe('a');
    expect(source.environmentItem()).toBe('env');
  });

  it('refuses a holder named twice: nothing picks between its two items', () => {
    expect(() => packageScopedHolderSource([[A, 1], [A, 2]])).toThrow(TypeError);
    expect(() => packageScopedHolderSource([[null, 1], [null, 2]])).toThrow(TypeError);
  });
});

describe('the platform\'s item — in every caller\'s reach, like `sys` (epic seat ruling 6729484996)', () => {
  const withPlatform = (pairs: Array<[string, string]>, platform: string | undefined) => {
    const packages = packageScopedHolderSource(pairs);
    return { ...packages, platformItem: () => platform };
  };
  const ask = (pairs: Array<[string, string]>, platform: string | undefined, reach: readonly string[], callerPackageId?: string) =>
    resolvePackageScopedHolders({ type: ENGINE_FUNCTION_TYPE, name: 'score', callerPackageId }, withPlatform(pairs, platform), closure(reach));

  it('a package caller whose only reachable candidate it is resolves to it; a holder outside the closure is no candidate', () => {
    expect(ask([], 'host', [], P)).toEqual({ status: 'resolved', item: 'host', holder: { kind: 'platform' }, via: 'platform' });
    expect(ask([[C, 'c']], 'host', [], P)).toMatchObject({ status: 'resolved', item: 'host', via: 'platform' });
  });

  it('the caller\'s own item comes first', () => {
    expect(ask([[P, 'p']], 'host', [], P)).toMatchObject({ status: 'resolved', item: 'p', via: 'own' });
  });

  it('red line 1: beside a closure holder it refuses, naming each', () => {
    const r = ask([[A, 'a']], 'host', [A], P);
    expect(r).toMatchObject({ status: 'refused', reason: 'ambiguous-in-closure', candidates: [{ kind: 'package', packageId: A }, { kind: 'platform' }] });
    expect(r.status === 'refused' && r.message).toContain('the platform');
  });

  it('a caller with no package: the environment\'s own item first, then the platform counted as one more holder', () => {
    expect(ask([], 'host', [])).toEqual({ status: 'resolved', item: 'host', holder: { kind: 'platform' }, via: 'platform' });
    const both = ask([[A, 'a']], 'host', []);
    expect(both).toMatchObject({
      status: 'refused', reason: 'ambiguous-in-environment', callerPackageId: null,
      candidates: [{ kind: 'package', packageId: A }, { kind: 'platform' }],
    });
    expect(both.status === 'refused' && both.message).toContain('the platform');
    const env = { ...withPlatform([[A, 'a']], 'host'), environmentItem: () => 'env' };
    expect(resolvePackageScopedHolders({ type: ENGINE_FUNCTION_TYPE, name: 'score' }, env, closure([]))).toMatchObject({ item: 'env', via: 'environment' });
    expect(ask([[A, 'a']], undefined, [])).toMatchObject({ item: 'a', via: 'unique-holder' });
  });
});

describe('the compatibility API\'s default package id is a caller with no package (epic seat ruling from E6)', () => {
  it('a `__runtime__` caller reaches an environment-only item, as a caller with no package does', () => {
    expect(RUNTIME_COMPATIBILITY_PACKAGE_ID).toBe('__runtime__');
    const envOnly = packageScopedHolderSource<string>([[null, 'env']]);
    const never: PackageResolutionClosureOf = () => { throw new Error('asked'); };
    expect(resolvePackageScopedHolders({ type: 'flow', name: 'n', callerPackageId: RUNTIME_COMPATIBILITY_PACKAGE_ID }, envOnly, never))
      .toEqual({ status: 'resolved', item: 'env', holder: { kind: 'environment' }, via: 'environment' });
  });

  it('only the caller side: an item stamped `__runtime__` is still a package holder', () => {
    expect(resolve([['__runtime__', 'r'], [A, 'a']], [])).toMatchObject({ status: 'refused', reason: 'ambiguous-in-environment' });
  });
});

describe('the one refusal class every package-scoped by-name door throws (ADR-0150 D5)', () => {
  it('carries the 409 RESOURCE_CONFLICT envelope under both status spellings, and the resolver\'s refusal and sentence', () => {
    const refusal = resolve([[A, 'a'], [B, 'b']], []);
    expect(refusal.status).toBe('refused');
    if (refusal.status !== 'refused') return;
    const err = new PackageScopedNameRefusedError(refusal);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PackageScopedNameRefusedError');
    expect(err.code).toBe('RESOURCE_CONFLICT');
    expect(err.status).toBe(409);
    expect(err.httpStatus).toBe(409);
    expect(err.refusal).toBe(refusal);
    expect(err.message).toBe(refusal.message);
  });
});

describe('the types narrowed to the namespace (ADR-0150 D2/D9)', () => {
  it('each is a phase-1 type ADR-0150 addresses by package, so a reader that refuses a bare read of a narrowed type it cannot judge reaches every one', () => {
    expect(NAMESPACE_SCOPED_BARE_NAME_TYPES.length).toBeGreaterThan(0);
    for (const type of NAMESPACE_SCOPED_BARE_NAME_TYPES) {
      expect(BARE_NAME_ONE_HOLDER_TYPES, type).toContain(type);
      // [#31700] The engine's function registry is the one member that is no
      // metadata type: it keeps its holders per package itself (D4's last row).
      expect(isPackageScopedType(type), type).toBe(type !== ENGINE_FUNCTION_TYPE);
      expect(isNamespaceScopedBareNameType(type), type).toBe(true);
    }
    expect(isNamespaceScopedBareNameType('flow')).toBe(false);
    expect(isNamespaceScopedBareNameType(undefined)).toBe(false);
  });

  it('[#31700] the picklist family has narrowed: picklist, mapping, dataset, api and the engine function', () => {
    for (const type of ['picklist', 'mapping', 'dataset', 'api', ENGINE_FUNCTION_TYPE]) {
      expect(isNamespaceScopedBareNameType(type), type).toBe(true);
    }
  });
});

describe('[#32244, review 6781770671 N1] packageScopedActionOwnersSentence', () => {
  it('two packages on two objects: each is a different action, naming each package with its object', () => {
    expect(packageScopedActionOwnersSentence(new Map([[A, ['account']], [B, ['contact']]]))).toBe(
      `Each is a different action: package "${A}" binds it to object "account"; package "${B}" binds it to object "contact".`,
    );
  });

  it('an object and none are different actions too', () => {
    expect(packageScopedActionOwnersSentence(new Map([[A, ['account']], [B, [undefined]]]))).toBe(
      `Each is a different action: package "${A}" binds it to object "account"; package "${B}" binds it to no object.`,
    );
  });

  it('two packages on ONE object are not called different actions: the sentence only names them', () => {
    expect(packageScopedActionOwnersSentence(new Map([[A, ['account']], [B, ['account']]]))).toBe(
      `Package "${A}" binds it to object "account"; package "${B}" binds it to object "account".`,
    );
  });
});
