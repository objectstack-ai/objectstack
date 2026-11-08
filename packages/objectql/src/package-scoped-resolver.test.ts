// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shared package-scoped resolver (ADR-0150 D3) and the per-package overlay
 * slot it reads (D4) — #31575, child R of epic #31527.
 *
 * The registry under test is the real `SchemaRegistry`: packages installed
 * through `installPackage` (so their manifests, and with them the declared
 * dependency closure, are what the save door reads), items registered through
 * `registerItem` under each package's composite slot, and overlays through the
 * package-less bare slot, as `sys_metadata` hydration registers them.
 *
 * Red line 1 (never loosens) and red line 2 (ambiguity reported, never
 * guessed) are pinned by the `red line` cases; each was ablated once (loosened
 * behaviour put back, the pin read red, restored) and the readings are in the
 * PR body, not kept as test files.
 *
 * Red line 3 (independently releasable) is the `phase 1 parity` block: under
 * phase 1's one-holder rule (the registry sealed), the resolver answers every
 * covered type exactly as `getItem` does, so wiring a reader to it later
 * changes no answer a release gives today.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry.js';
import { BARE_NAME_REGISTRY_TYPES, type BareNameRegistryType } from './bare-name-one-holder.js';
import {
  resolvePackageScopedName,
  packageResolutionClosure,
  PACKAGE_SCOPED_TYPES,
  PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE,
  type PackageScopedResolution,
  type PackageScopedType,
} from './package-scoped-resolver.js';
import { packageDependencyClosure } from '@objectstack/metadata-protocol';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const C = 'com.acme.gamma';
const P = 'com.acme.caller';
const MID = 'com.acme.middle';
const SYS = 'com.objectstack.kernel.probe';
const EMAIL_BASELINE = 'com.objectstack.service.email';

/** A manifest whose namespace is its id's last segment, declaring `deps`. */
const manifest = (id: string, deps: string[] = [], namespace = id.split('.').pop()!) => ({
  id,
  name: id,
  version: '1.0.0',
  type: 'app',
  namespace,
  ...(deps.length > 0 ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
}) as never;

let registry: SchemaRegistry;
const install = (id: string, deps: string[] = [], namespace?: string) => registry.installPackage(manifest(id, deps, namespace), 'code');

/** A body every covered type's registration accepts, marked with `tag`. */
const body = (type: string, name: string, tag: string): Record<string, unknown> => {
  switch (type) {
    case 'action':
      return { name, label: `${tag} action`, type: 'script', body: { language: 'js', source: `return '${tag}';`, capabilities: [] } };
    case 'api':
      return {
        name, label: `${tag} api`, summary: `${tag} api`, path: `/api/v1/apps/${tag}/${name}`, method: 'GET',
        type: 'object_operation', objectParams: { object: `${tag}_item`, operation: 'find' },
      };
    case 'email_template':
      return { name, label: `${tag} template`, locale: 'en-US', subject: `${tag} subject`, bodyHtml: `<p>${tag}</p>` };
    case 'skill':
      return { name, label: `${tag} skill`, description: `${tag} skill`, instructions: `${tag}`, tools: [] };
    default:
      return { name, label: `${tag} ${type}` };
  }
};

const label = (r: PackageScopedResolution): string | undefined =>
  r.status === 'resolved' ? (r.item as { label?: string }).label : undefined;

/** A package's item, in its composite slot. */
const ship = (type: string, name: string, packageId: string, tag = packageId.split('.').pop()!) =>
  registry.registerItem(type, body(type, name, tag), 'name' as never, packageId);

/** A stored row hydrated into the bare slot, bound to `binding` (or to no package). */
const overlay = (type: string, name: string, binding: string | undefined, tag: string) =>
  registry.registerItem(type, { ...body(type, name, tag), ...(binding ? { _packageId: binding } : {}), _provenance: 'org' }, 'name' as never);

const resolve = (type: PackageScopedType, name: string, callerPackageId?: string | null, member?: string) =>
  resolvePackageScopedName(registry, { type, name, callerPackageId, member });

beforeEach(() => {
  registry = new SchemaRegistry();
  registry.logLevel = 'silent';
});

describe('ADR-0150 D3 — a caller that belongs to a package', () => {
  it("answers the caller's own item before a closure holder of the same name", () => {
    install(A);
    install(P, [A]);
    ship('flow', 'send_email', A);
    ship('flow', 'send_email', P);
    const r = resolve('flow', 'send_email', P);
    expect(r).toMatchObject({ status: 'resolved', via: 'own', holder: { kind: 'package', packageId: P } });
    expect(label(r)).toBe('caller flow');
  });

  it('answers the unique holder in the TRANSITIVE declared closure, and a holder outside it is no candidate', () => {
    install(A);
    install(MID, [A]);
    install(P, [MID]);
    install(C);
    ship('flow', 'send_email', C); // registered first: outside P's closure
    ship('flow', 'send_email', A);
    const r = resolve('flow', 'send_email', P);
    expect(r).toMatchObject({ status: 'resolved', via: 'closure', holder: { kind: 'package', packageId: A } });
    expect(label(r)).toBe('alpha flow');
  });

  it('puts every `sys` package in the closure, declared or not', () => {
    install(SYS, [], 'sys');
    install(P);
    ship('page', 'setup_home', SYS, 'kernel');
    const r = resolve('page', 'setup_home', P);
    expect(r).toMatchObject({ status: 'resolved', via: 'closure', holder: { kind: 'package', packageId: SYS } });
  });

  it('a caller package the registry cannot produce declares nothing: it reaches `sys` only', () => {
    install(SYS, [], 'sys');
    install(A);
    ship('page', 'home', A);
    expect(resolve('page', 'home', 'com.acme.not_installed')).toMatchObject({ status: 'refused', reason: 'outside-closure' });
    expect([...packageResolutionClosure(registry, 'com.acme.not_installed')]).toEqual([SYS]);
  });

  it('refuses, naming the holder, when the name is held only outside the closure — never an environment-wide guess', () => {
    install(C);
    install(P);
    ship('flow', 'send_email', C);
    const r = resolve('flow', 'send_email', P);
    expect(r).toMatchObject({
      status: 'refused', reason: 'outside-closure', callerPackageId: P,
      candidates: [{ kind: 'package', packageId: C }],
    });
    expect(r.status === 'refused' && r.message).toContain(C);
  });

  it("refuses, naming the environment, when only the environment's own item holds the name", () => {
    install(P);
    overlay('dataset', 'pipeline', undefined, 'env');
    expect(resolve('dataset', 'pipeline', P)).toMatchObject({
      status: 'refused', reason: 'outside-closure', candidates: [{ kind: 'environment' }],
    });
  });

  it('zero holders is not-found, never a refusal', () => {
    install(A);
    install(P, [A]);
    expect(resolve('flow', 'nothing_here', P)).toEqual({ status: 'not-found' });
  });
});

describe('ADR-0150 D3 — a caller with no package', () => {
  it("answers the environment's own item: a package-less row under a name no package holds", () => {
    install(A);
    ship('page', 'about', A);
    overlay('page', 'home', undefined, 'env');
    const r = resolve('page', 'home');
    expect(r).toMatchObject({ status: 'resolved', via: 'environment', holder: { kind: 'environment' } });
    expect(label(r)).toBe('env page');
  });

  it("a package-less row under the one holder's name is that holder's overlay, never a second item", () => {
    install(A);
    ship('page', 'home', A);
    overlay('page', 'home', undefined, 'env-custom');
    const r = resolve('page', 'home');
    expect(r).toMatchObject({ status: 'resolved', via: 'unique-holder', holder: { kind: 'package', packageId: A } });
    expect(label(r)).toBe('env-custom page');
    expect(r.status === 'resolved' && r.item).toBe(registry.getItem('page', 'home'));
  });

  it('answers the unique package holder', () => {
    install(A);
    ship('page', 'home', A);
    expect(resolve('page', 'home')).toMatchObject({ status: 'resolved', via: 'unique-holder', holder: { kind: 'package', packageId: A } });
  });

  it('reads `null`, `""` and the `sys_metadata` sentinel as no caller package', () => {
    install(A);
    ship('page', 'home', A);
    for (const caller of [null, '', 'sys_metadata']) {
      expect(resolve('page', 'home', caller)).toMatchObject({ status: 'resolved', via: 'unique-holder' });
    }
  });

  it('zero holders is not-found', () => {
    expect(resolve('page', 'home')).toEqual({ status: 'not-found' });
  });
});

describe('red line 1 — the resolver never loosens', () => {
  it('two holders in the closure refuse: no first-registered pick, even with a package-less row beside them', () => {
    install(A);
    install(B);
    install(P, [A, B]);
    ship('flow', 'send_email', A); // first-registered
    ship('flow', 'send_email', B);
    overlay('flow', 'send_email', undefined, 'env');
    const r = resolve('flow', 'send_email', P);
    expect(r.status).toBe('refused');
    expect(r).toMatchObject({ reason: 'ambiguous-in-closure', callerPackageId: P });
  });

  it('two package holders refuse a caller with no package: no first-registered pick', () => {
    install(A);
    install(B);
    ship('page', 'home', A); // first-registered
    ship('page', 'home', B);
    const r = resolve('page', 'home');
    expect(r.status).toBe('refused');
    expect(r).toMatchObject({ reason: 'ambiguous-in-environment', callerPackageId: null });
  });
});

describe('red line 2 — every refusal names every candidate', () => {
  it('in the closure: all three holders, in store order, each in the sentence', () => {
    for (const id of [A, B, C]) install(id);
    install(P, [A, B, C]);
    for (const id of [A, B, C]) ship('flow', 'send_email', id);
    const r = resolve('flow', 'send_email', P);
    expect(r).toMatchObject({ status: 'refused', reason: 'ambiguous-in-closure' });
    if (r.status !== 'refused') throw new Error('unreachable');
    expect(r.candidates).toEqual([A, B, C].map((packageId) => ({ kind: 'package', packageId })));
    for (const id of [A, B, C]) expect(r.message).toContain(`package "${id}"`);
  });

  it('in the environment: all three holders, each in the sentence', () => {
    for (const id of [A, B, C]) install(id);
    for (const id of [A, B, C]) ship('page', 'home', id);
    const r = resolve('page', 'home');
    if (r.status !== 'refused') throw new Error(`expected a refusal, got ${r.status}`);
    expect(r.candidates).toEqual([A, B, C].map((packageId) => ({ kind: 'package', packageId })));
    for (const id of [A, B, C]) expect(r.message).toContain(`package "${id}"`);
  });

  it('outside the closure: every holder and the environment', () => {
    install(A);
    install(B);
    install(P);
    ship('dataset', 'pipeline', A);
    ship('dataset', 'pipeline', B);
    const r = resolve('dataset', 'pipeline', P);
    if (r.status !== 'refused') throw new Error(`expected a refusal, got ${r.status}`);
    expect(r.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
  });
});

describe('ADR-0150 D3 exceptions', () => {
  it('a platform-requested name resolves environment-wide whatever the caller, and keeps one holder', () => {
    expect(PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE).toEqual({ permission: ['guest_portal'] });
    install(A);
    install(P); // declares nothing: A is outside its closure
    ship('permission', 'guest_portal', A);
    expect(resolve('permission', 'guest_portal', P)).toMatchObject({ status: 'resolved', via: 'unique-holder', holder: { packageId: A } });
    // A same-named set the caller holds (its stored row: the security
    // catalog refuses a second package-shipped one) is not chosen over the
    // environment-wide answer: two holders refuse.
    overlay('permission', 'guest_portal', P, 'caller');
    expect(resolve('permission', 'guest_portal', P)).toMatchObject({ status: 'refused', reason: 'ambiguous-in-environment' });
    // Any other permission set is package-scoped.
    ship('permission', 'sales_rep', A);
    expect(resolve('permission', 'sales_rep', P)).toMatchObject({ status: 'refused', reason: 'outside-closure' });
  });

  it('positions and objects are not addressed by package', () => {
    expect(PACKAGE_SCOPED_TYPES).not.toContain('position');
    expect(PACKAGE_SCOPED_TYPES).not.toContain('object');
    expect(() => resolve('position' as PackageScopedType, 'sales_rep')).toThrow(TypeError);
    expect(() => resolve('object' as PackageScopedType, 'crm_account')).toThrow(TypeError);
  });

  it("an overridable baseline yields to another reachable holder, and answers when it is the only one", () => {
    install(EMAIL_BASELINE, [], 'sys');
    install(A);
    install(P, [A]);
    ship('email_template', 'auth.password_reset', EMAIL_BASELINE, 'builtin');
    expect(resolve('email_template', 'auth.password_reset')).toMatchObject({ status: 'resolved', via: 'baseline' });
    expect(resolve('email_template', 'auth.password_reset', P)).toMatchObject({ status: 'resolved', via: 'baseline' });
    ship('email_template', 'auth.password_reset', A);
    expect(resolve('email_template', 'auth.password_reset')).toMatchObject({ status: 'resolved', via: 'unique-holder', holder: { packageId: A } });
    expect(resolve('email_template', 'auth.password_reset', P)).toMatchObject({ status: 'resolved', via: 'closure', holder: { packageId: A } });
  });

  it('a bundled type answers the asked member of the resolved package, or not-found', () => {
    install(A);
    install(P, [A]);
    ship('email_template', 'welcome', A);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'alpha-zh'), locale: 'zh-CN' }, 'name' as never, A);
    expect(label(resolve('email_template', 'welcome', P, 'zh-CN'))).toBe('alpha-zh template');
    expect(label(resolve('email_template', 'welcome', P))).toBe('alpha template');
    expect(resolve('email_template', 'welcome', P, 'fr-FR')).toEqual({ status: 'not-found' });
  });
});

describe('the closure is the save door\'s closure (one implementation)', () => {
  it('equals `packageDependencyClosure` plus the `sys` packages', () => {
    install(SYS, [], 'sys');
    install(A);
    install(MID, [A]);
    install(P, [MID, 'com.acme.declared_not_installed']);
    const declared = packageDependencyClosure(P, registry);
    expect(declared?.dependencies.sort()).toEqual([A, MID, 'com.acme.declared_not_installed'].sort());
    expect([...packageResolutionClosure(registry, P)].sort()).toEqual([...declared!.dependencies, SYS].sort());
  });
});

describe('ADR-0150 D4 — the per-package overlay slot', () => {
  it("an overlay of one package's item never shadows another package's same-named item", () => {
    install(A);
    install(B);
    ship('page', 'home', A);
    ship('page', 'home', B);
    overlay('page', 'home', A, 'alpha-custom');
    // `getItem` is unchanged: its bare slot answers every caller first.
    expect((registry.getItem<{ label: string }>('page', 'home', B))?.label).toBe('alpha-custom page');
    // The per-package slot binds the overlay to A only.
    expect(registry.getPackageScopedItem<{ label: string }>('page', 'home', A)?.label).toBe('alpha-custom page');
    expect(registry.getPackageScopedItem<{ label: string }>('page', 'home', B)?.label).toBe('beta page');
    expect(registry.getEnvironmentScopedItem('page', 'home')).toBeUndefined();
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([A, B]);
    install(P, [B]);
    expect(label(resolve('page', 'home', P))).toBe('beta page');
  });

  it("a package-less row is the environment's own item only while no package holds the name", () => {
    install(A);
    overlay('page', 'home', undefined, 'env');
    expect(registry.getEnvironmentScopedItem<{ label: string }>('page', 'home')?.label).toBe('env page');
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([]);
    // A package that takes the name later makes the row its overlay (ADR-0150 D3).
    ship('page', 'home', A);
    expect(registry.getEnvironmentScopedItem('page', 'home')).toBeUndefined();
    expect(registry.getPackageScopedItem<{ label: string }>('page', 'home', A)?.label).toBe('env page');
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([A]);
  });

  it('a package-less row over a name two packages hold binds to neither, and is no environment item', () => {
    install(A);
    install(B);
    ship('page', 'home', A);
    ship('page', 'home', B);
    overlay('page', 'home', undefined, 'env');
    expect(registry.getEnvironmentScopedItem('page', 'home')).toBeUndefined();
    expect(registry.getPackageScopedItem<{ label: string }>('page', 'home', A)?.label).toBe('alpha page');
    expect(registry.getPackageScopedItem<{ label: string }>('page', 'home', B)?.label).toBe('beta page');
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([A, B]);
    expect(resolve('page', 'home')).toMatchObject({ status: 'refused', reason: 'ambiguous-in-environment' });
  });

  it("a paired `.custom` package's row binds to its base's item (ADR-0146 D9)", () => {
    install(A);
    ship('flow', 'send_email', A);
    overlay('flow', 'send_email', `${A}.custom`, 'alpha-pair');
    expect(registry.getPackageScopedItem<{ label: string }>('flow', 'send_email', A)?.label).toBe('alpha-pair flow');
    expect(registry.packageScopedHoldersOf('flow', 'send_email')).toEqual([A]);
  });

  it('a row bound to a package that ships no item of the name is that package\'s own stored item', () => {
    install(A);
    install(B);
    ship('flow', 'send_email', A);
    overlay('flow', 'send_email', B, 'beta-stored');
    expect(registry.packageScopedHoldersOf('flow', 'send_email')).toEqual([A, B]);
    expect(registry.getPackageScopedItem<{ label: string }>('flow', 'send_email', B)?.label).toBe('beta-stored flow');
    expect(registry.getPackageScopedItem<{ label: string }>('flow', 'send_email', A)?.label).toBe('alpha flow');
    expect(resolve('flow', 'send_email')).toMatchObject({ status: 'refused', reason: 'ambiguous-in-environment' });
  });

  it("a bundle's overlay members bind per member", () => {
    install(A);
    ship('email_template', 'welcome', A);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'alpha-zh-custom'), locale: 'zh-CN', _packageId: A, _provenance: 'org' }, 'name' as never);
    expect(registry.getPackageScopedItem<{ label: string }>('email_template', 'welcome', A, 'zh-CN')?.label).toBe('alpha-zh-custom template');
    expect(registry.getPackageScopedItem<{ label: string }>('email_template', 'welcome', A)?.label).toBe('alpha template');
    expect(registry.getEnvironmentScopedItem('email_template', 'welcome', 'zh-CN')).toBeUndefined();
  });
});

describe('phase 1 parity — under the one-holder rule the resolver answers as `getItem` does (red line 3)', () => {
  const NAME = 'shared_name';

  /** A sealed registry where A holds every covered name and P depends on A. */
  const sealedWithHolder = (withOverlay: boolean, binding?: string) => {
    install(A);
    install(P, [A]);
    install('com.acme.unrelated');
    for (const type of BARE_NAME_REGISTRY_TYPES) {
      ship(type, NAME, A);
      if (withOverlay) overlay(type, NAME, binding, 'alpha-custom');
    }
    registry.sealBareNameHolders();
  };

  for (const overlayBinding of [null, A, undefined] as const) {
    const withOverlay = overlayBinding !== null;
    const what = overlayBinding === null ? '' : overlayBinding === A ? ' and its bound overlay' : ' and a package-less row over its name';
    it(`every covered type, one package holder${what}: the same item for no caller, the holder and a dependent`, () => {
      sealedWithHolder(withOverlay, overlayBinding ?? undefined);
      for (const type of BARE_NAME_REGISTRY_TYPES as readonly BareNameRegistryType[]) {
        for (const caller of [undefined, A, P]) {
          const r = resolve(type, NAME, caller);
          expect(r.status, `${type} for ${caller ?? 'no caller'}`).toBe('resolved');
          expect(r.status === 'resolved' && r.item, `${type} for ${caller ?? 'no caller'}`).toBe(registry.getItem(type, NAME, caller));
        }
      }
    });
  }

  it("every covered type, the environment's own item only: the same item for no caller", () => {
    registry.sealBareNameHolders();
    for (const type of BARE_NAME_REGISTRY_TYPES) {
      overlay(type, NAME, undefined, 'env');
      const r = resolve(type, NAME);
      expect(r.status === 'resolved' && r.item, type).toBe(registry.getItem(type, NAME));
    }
  });

  it('a second package holder is still refused by phase 1, so no reader can meet two', () => {
    sealedWithHolder(false);
    install(B);
    expect(() => ship('flow', NAME, B)).toThrow();
  });
});
