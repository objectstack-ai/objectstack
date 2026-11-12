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
 *
 * Child R2 (#31716) moved the rule into `@objectstack/core`
 * (`resolvePackageScopedHolders`, over a holder set and a closure the caller
 * supplies) and the closure walk into `@objectstack/metadata-core`, so this
 * module is two adapters: the registry's (`resolvePackageScopedName`, every
 * case above unchanged) and the engine functions' (`resolvePackageScopedFunction`
 * over `ObjectQL#functionHoldersOf`): the `R2` blocks at the end. Their parity
 * block holds the core, over the registry's holders and the one walk, to
 * exactly the adapter's answer; their red-line pins were ablated the same
 * way, readings in the PR body.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry.js';
import { BARE_NAME_REGISTRY_TYPES, type BareNameRegistryType } from './bare-name-one-holder.js';
import {
  resolvePackageScopedName,
  resolvePackageScopedFunction,
  resolvePackageScopedHolders,
  packageScopedHolderSource,
  packageResolutionClosure,
  ENGINE_FUNCTION_TYPE,
  PACKAGE_SCOPED_TYPES,
  PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE,
  type PackageScopedHolderSource,
  type PackageScopedResolution,
  type PackageScopedResolvableType,
  type PackageScopedType,
} from './package-scoped-resolver.js';
import { ObjectQL } from './engine.js';
import * as metadataCore from '@objectstack/metadata-core';
import * as core from '@objectstack/core';
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
    expect(PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE).toEqual({
      permission: ['guest_portal'],
      // [#31699] The auth mails the platform sends with no package.
      email_template: [
        'auth.password_reset', 'auth.verify_email', 'auth.magic_link', 'auth.invitation',
        'auth.account_invitation', 'auth.two_factor_otp', 'auth.email_change_notice', 'auth.existing_account_sign_up',
      ],
    });
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
    // A name the platform requests (#31699) resolves environment-wide for a package caller too.
    expect(resolve('email_template', 'auth.password_reset', P)).toMatchObject({ status: 'resolved', via: 'unique-holder', holder: { packageId: A } });
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

  it('[#31699] a pair row that declares another holder as its base is skipped on the base\'s address, which falls to its own item', () => {
    install(A);
    install(B);
    ship('email_template', 'welcome', A);
    ship('email_template', 'welcome', B);
    ship('page', 'home', A);
    ship('page', 'home', B);
    const pairRow = (type: string, nameOf: string, tag: string, declared?: string) => registry.registerItem(type, {
      ...body(type, nameOf, tag), _packageId: `${A}.custom`, _provenance: 'org',
      ...(declared ? { overrides: { package: declared } } : {}),
    }, 'name' as never);
    pairRow('email_template', 'welcome', 'bound-to-beta', B);
    pairRow('page', 'home', 'bound-to-beta', B);
    expect(registry.getPackageScopedItem<{ label: string }>('email_template', 'welcome', A)?.label).toBe('alpha template');
    expect(registry.getPackageScopedItem<{ label: string }>('page', 'home', A)?.label).toBe('alpha page');
    // CONTROL: the other holder's own item is unchanged.
    expect(registry.getPackageScopedItem<{ label: string }>('page', 'home', B)?.label).toBe('beta page');
  });

  it('[#31699] CONTROL — a pair row that declares its own base, or none, is still the base\'s', () => {
    install(A);
    install(B);
    ship('page', 'home', A);
    ship('page', 'home', B);
    registry.registerItem('page', { ...body('page', 'home', 'pair-own'), _packageId: `${A}.custom`, _provenance: 'org', overrides: { package: A } }, 'name' as never);
    expect(registry.getPackageScopedItem<{ label: string }>('page', 'home', A)?.label).toBe('pair-own page');
    registry.registerItem('page', { ...body('page', 'home', 'pair-plain'), _packageId: `${A}.custom`, _provenance: 'org' }, 'name' as never);
    expect(registry.getPackageScopedItem<{ label: string }>('page', 'home', A)?.label).toBe('pair-plain page');
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

/**
 * [#32408, epic ruling 6761802819 on #31699 F2] An App's customization pair is
 * shared by every package of the App (ADR-0146 D3), so a row stored there is
 * bound by the exact read's one owner check (`pairRowOnAddress`,
 * metadata-protocol): bound to X → only X; unbound with two packages of the
 * App holding the name → neither; unbound with one → that one; the App's own
 * address keeps #28390 ruling A. Every reader of the registry's overlay slot
 * reads the same binding — the holder set, a holder's bundle members (which
 * decide whether a holding is a bundle addition), a package's item and the
 * environment's item. Before this, they read the pair's per-package base only:
 * the row was the pair's own item (a third holder) or the App's, whatever it
 * declared. Ablated once (the binding put back to the per-package base): the
 * readings are in the PR body.
 */
describe('[#32408] every overlay-slot reader binds an App pair\'s row as the exact read does', () => {
  const APP = 'com.acme.suite';
  const X = 'com.acme.suitex';
  const Y = 'com.acme.suitey';
  const PAIR = `${APP}.custom`;
  /** The App and its packages X and Y: each a `module` declaring the App. */
  const installSuite = () => {
    install(APP);
    for (const id of [X, Y]) {
      registry.installPackage({ ...(manifest(id, [APP]) as object), type: 'module' } as never, 'code');
    }
  };
  /** A row Studio saved into the App's pair, hydrated into the bare slot. */
  const pairRow = (type: string, nameOf: string, tag: string, declared?: string, locale?: string) => registry.registerItem(type, {
    ...body(type, nameOf, tag), ...(locale ? { locale } : {}), _packageId: PAIR, _provenance: 'org',
    ...(declared ? { overrides: { package: declared } } : {}),
  }, 'name' as never);
  const pageOf = (packageId: string) => registry.getPackageScopedItem<{ label: string }>('page', 'home', packageId)?.label;
  const templateOf = (packageId: string, member: string) =>
    registry.getPackageScopedItem<{ label: string }>('email_template', 'welcome', packageId, member)?.label;

  beforeEach(installSuite);

  it('bound to X → only X: X\'s address serves it, Y\'s serves its own, the pair is no holder (BASE: the pair\'s own item, a third holder)', () => {
    ship('page', 'home', X);
    ship('page', 'home', Y);
    pairRow('page', 'home', 'pair', X);
    expect(pageOf(X)).toBe('pair page');
    expect(pageOf(Y)).toBe('suitey page');
    expect(pageOf(PAIR)).toBeUndefined();
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([X, Y]);
    expect(registry.getEnvironmentScopedItem('page', 'home')).toBeUndefined();
  });

  it('bound to X beside the App holding the name → only X, never the App (BASE: the App\'s, whatever it declared)', () => {
    ship('page', 'home', APP);
    ship('page', 'home', X);
    pairRow('page', 'home', 'pair', X);
    expect(pageOf(X)).toBe('pair page');
    expect(pageOf(APP)).toBe('suite page');
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([APP, X]);
  });

  it('bound to X, a bundle member: X holds it, the App does not, so X\'s locale stays an addition to the App\'s template (BASE: the App held it, and the bare read was refused naming both)', () => {
    ship('email_template', 'welcome', APP);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'suitex'), locale: 'fr-FR' }, 'name' as never, X);
    pairRow('email_template', 'welcome', 'pair', X, 'fr-FR');
    expect(templateOf(X, 'fr-FR')).toBe('pair template');
    expect(templateOf(APP, 'fr-FR')).toBeUndefined();
    expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([APP]);
    expect(label(resolve('email_template', 'welcome'))).toBe('suite template');
    expect(registry.getEnvironmentScopedItem('email_template', 'welcome', 'fr-FR')).toBeUndefined();
  });

  it('NARROWING — a later package whose only locale is the one the App\'s pair overrides for X is an addition to the App\'s template, refused naming the App (BASE: admitted, the pair\'s locale counted as the App\'s)', () => {
    ship('email_template', 'welcome', APP);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'suitex'), locale: 'fr-FR' }, 'name' as never, X);
    pairRow('email_template', 'welcome', 'pair', X, 'fr-FR');
    registry.sealBareNameHolders();
    const Z = 'com.acme.zeta';
    registry.installPackage({ ...(manifest(Z, [APP]) as object), type: 'module' } as never, 'code');
    expect(() => registry.registerItem('email_template', { ...body('email_template', 'welcome', 'zeta'), locale: 'fr-FR' }, 'name' as never, Z))
      .toThrow(`already held by package "${APP}"`);
  });

  it('unbound with two packages of the App holding the name → neither, and the pair is no holder (BASE: the pair\'s own item, a third holder)', () => {
    ship('page', 'home', X);
    ship('page', 'home', Y);
    pairRow('page', 'home', 'pair');
    ship('email_template', 'welcome', X);
    ship('email_template', 'welcome', Y);
    pairRow('email_template', 'welcome', 'pair', undefined, 'fr-FR');
    expect([pageOf(X), pageOf(Y), pageOf(PAIR)]).toEqual(['suitex page', 'suitey page', undefined]);
    expect([templateOf(X, 'fr-FR'), templateOf(Y, 'fr-FR'), templateOf(PAIR, 'fr-FR')]).toEqual([undefined, undefined, undefined]);
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([X, Y]);
    expect(resolve('page', 'home')).toMatchObject({
      status: 'refused', reason: 'ambiguous-in-environment',
      candidates: [{ kind: 'package', packageId: X }, { kind: 'package', packageId: Y }],
    });
    expect(registry.getEnvironmentScopedItem('page', 'home')).toBeUndefined();
    expect(registry.getEnvironmentScopedItem('email_template', 'welcome', 'fr-FR')).toBeUndefined();
  });

  it('unbound, beside a bundle addition of another package of the App → the one package holding the name, as `?package=X` reads it (contract review F1; BASE: the pair\'s own item)', () => {
    const Z = 'com.acme.zeta';
    registry.installPackage({ ...(manifest(Z, [APP, X]) as object), type: 'module' } as never, 'code');
    ship('email_template', 'welcome', X);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'zeta'), locale: 'fr-FR' }, 'name' as never, Z);
    pairRow('email_template', 'welcome', 'pair', undefined, 'de-DE');
    expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([X]);
    expect(templateOf(X, 'de-DE')).toBe('pair template');
    expect(templateOf(Z, 'de-DE')).toBeUndefined();
    expect(registry.getEnvironmentScopedItem('email_template', 'welcome', 'de-DE')).toBeUndefined();
  });

  it('CONTROL — unbound, of the very locale a bundle addition of another package of the App ships → no package: the row may customize that package\'s member (never a guess)', () => {
    const Z = 'com.acme.zeta';
    registry.installPackage({ ...(manifest(Z, [APP, X]) as object), type: 'module' } as never, 'code');
    ship('email_template', 'welcome', X);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'zeta'), locale: 'fr-FR' }, 'name' as never, Z);
    pairRow('email_template', 'welcome', 'pair', undefined, 'fr-FR');
    expect(templateOf(X, 'fr-FR')).toBeUndefined();
    expect(templateOf(Z, 'fr-FR')).toBe('zeta template');
  });

  it('unbound, beside a package of the App that a pair row binds a member another holder ships → no package, as `?package=X` refuses it naming both (contract review F4 b; BASE at d9d3621f: X)', () => {
    // The declared en-US row is admitted while Z ships en-US and outlives an upgrade of Z that drops it (measured at the save door).
    const Z = 'com.acme.zeta';
    registry.installPackage({ ...(manifest(Z, [APP, X]) as object), type: 'module' } as never, 'code');
    ship('email_template', 'welcome', X);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'zeta'), locale: 'fr-FR' }, 'name' as never, Z);
    pairRow('email_template', 'welcome', 'pairz', Z, 'en-US');
    pairRow('email_template', 'welcome', 'pair', undefined, 'de-DE');
    expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([X, Z]);
    expect(templateOf(Z, 'en-US')).toBe('pairz template');
    expect([templateOf(X, 'de-DE'), templateOf(Z, 'de-DE')]).toEqual([undefined, undefined]);
    expect(registry.getEnvironmentScopedItem('email_template', 'welcome', 'de-DE')).toBeUndefined();
  });

  it('unbound, beside an addition of a package of the App to a holder outside the App → the one package of the App holding the name, as `?package=X` reads it (contract review F4 a; BASE at d9d3621f: no package)', () => {
    const W = 'com.other.west';
    const Z = 'com.acme.zeta';
    install(W);
    // Z reaches two Apps; its namespace picks the App A (`appOf`), so A's pair customizes it.
    registry.installPackage({ ...(manifest(Z, [APP, W], 'suite') as object), type: 'module' } as never, 'code');
    ship('email_template', 'welcome', X);
    ship('email_template', 'welcome', W);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'zeta'), locale: 'fr-FR' }, 'name' as never, Z);
    pairRow('email_template', 'welcome', 'pair', undefined, 'de-DE');
    expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([X, W]);
    expect(metadataCore.appOf(Z, metadataCore.installedManifestsOf(registry)), 'Z is a package of the App').toBe(APP);
    expect(templateOf(X, 'de-DE')).toBe('pair template');
    expect([templateOf(Z, 'de-DE'), templateOf(W, 'de-DE')]).toEqual([undefined, undefined]);
  });

  it('CONTROL — unbound, while another App\'s pair stores an undeclared row of the name → no package: the count would wait on that pair\'s (contract review F6, epic seat 1\'s ruling; BASE at a8b63c29: Y)', () => {
    // App B: P ships en-US, Q (on P) ships de-DE; B's pair stores an undeclared fr-FR row (owners P and Q).
    // App A: U (on A and P, A's namespace) ships fr-FR, Y ships it-IT; A's pair stores an undeclared es-ES row.
    // Both undeclared rows are admitted at the save door (measured).
    const B = 'com.beta.base';
    const P = 'com.beta.basep';
    const Q = 'com.beta.baseq';
    const U = 'com.acme.suiteu';
    install(B);
    registry.installPackage({ ...(manifest(P, [B]) as object), type: 'module' } as never, 'code');
    registry.installPackage({ ...(manifest(Q, [B, P]) as object), type: 'module' } as never, 'code');
    registry.installPackage({ ...(manifest(U, [APP, P], 'suite') as object), type: 'module' } as never, 'code');
    ship('email_template', 'welcome', P);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'baseq'), locale: 'de-DE' }, 'name' as never, Q);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'suiteu'), locale: 'fr-FR' }, 'name' as never, U);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'suitey'), locale: 'it-IT' }, 'name' as never, Y);
    registry.registerItem('email_template', {
      ...body('email_template', 'welcome', 'bpair'), locale: 'fr-FR', _packageId: `${B}.custom`, _provenance: 'org',
    }, 'name' as never);
    pairRow('email_template', 'welcome', 'pair', undefined, 'es-ES');
    // Each pair's row would wait on the other pair's count, so neither binds (the exact read serves both: #32561).
    expect(registry.getPackageScopedItem('email_template', 'welcome', P, 'fr-FR')).toBeUndefined();
    expect([templateOf(U, 'es-ES'), templateOf(Y, 'es-ES')]).toEqual([undefined, undefined]);
    expect(registry.getEnvironmentScopedItem('email_template', 'welcome', 'es-ES')).toBeUndefined();
  });

  it('unbound with one package of the App holding the name → that one (BASE: the pair\'s own item, and the bare read refused naming both)', () => {
    ship('page', 'home', X);
    pairRow('page', 'home', 'pair');
    ship('email_template', 'welcome', X);
    pairRow('email_template', 'welcome', 'pair', undefined, 'fr-FR');
    expect(pageOf(X)).toBe('pair page');
    expect(templateOf(X, 'fr-FR')).toBe('pair template');
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([X]);
    expect(label(resolve('page', 'home'))).toBe('pair page');
    expect(registry.getEnvironmentScopedItem('page', 'home')).toBeUndefined();
  });

  it('a row declaring a package that holds no item of the name binds to no package: the App keeps its own item, X its own (BASE: the App\'s address served the row)', () => {
    ship('page', 'home', APP);
    ship('page', 'home', X);
    pairRow('page', 'home', 'pair', Y);
    expect([pageOf(APP), pageOf(X), pageOf(Y)]).toEqual(['suite page', 'suitex page', undefined]);
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([APP, X]);
    expect(registry.getEnvironmentScopedItem('page', 'home')).toBeUndefined();
  });

  it('CONTROL — two real holders (two independent Apps, no shared pair) still refuse the bare read naming both, with or without a pair row beside them', () => {
    install(A);
    install(B);
    ship('page', 'home', A);
    ship('page', 'home', B);
    const refusedNamingBoth = {
      status: 'refused', reason: 'ambiguous-in-environment',
      candidates: [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }],
    };
    expect(resolve('page', 'home')).toMatchObject(refusedNamingBoth);
    registry.registerItem('page', { ...body('page', 'home', 'alpha-pair'), _packageId: `${A}.custom`, _provenance: 'org' }, 'name' as never);
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([A, B]);
    expect(resolve('page', 'home')).toMatchObject(refusedNamingBoth);
  });

  it('CONTROL — the App\'s own address keeps #28390 ruling A: an unbound row of its pair is the App\'s, beside a package of the App', () => {
    ship('page', 'home', APP);
    ship('page', 'home', X);
    pairRow('page', 'home', 'pair');
    expect([pageOf(APP), pageOf(X)]).toEqual(['pair page', 'suitex page']);
    expect(registry.packageScopedHoldersOf('page', 'home')).toEqual([APP, X]);
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

// ---------------------------------------------------------------------------
// Child R2 (#31716): the rule over a holder set the caller supplies.
// ---------------------------------------------------------------------------

/** The registry's holders of `(type, name)`, as `(package, item)` pairs. */
const registryPairs = (type: PackageScopedType, name: string): Array<[string | null, unknown]> => {
  const pairs: Array<[string | null, unknown]> = registry
    .packageScopedHoldersOf(type, name)
    .map((id) => [id, registry.getPackageScopedItem(type, name, id)]);
  const environment = registry.getEnvironmentScopedItem(type, name);
  if (environment !== undefined) pairs.push([null, environment]);
  return pairs;
};

describe('R2 parity — the core rule over the registry\'s holders and the one walk answers as `resolvePackageScopedName`', () => {
  const CALLERS = [undefined, null, '', 'sys_metadata', A, B, C, MID, P, SYS, 'com.acme.not_installed'];

  it('every caller, every arm: own, closure, unique holder, environment, baseline, platform-requested, ambiguous, outside, not-found', () => {
    install(SYS, [], 'sys');
    install(EMAIL_BASELINE, [], 'sys');
    install(A);
    install(B);
    install(C);
    install(MID, [A]);
    install(P, [MID, B]);
    ship('flow', 'own_and_closure', P);
    ship('flow', 'own_and_closure', A);
    ship('flow', 'closure_only', A);
    ship('flow', 'two_in_closure', A);
    ship('flow', 'two_in_closure', B);
    ship('flow', 'outside_only', C);
    ship('page', 'kernel_page', SYS, 'kernel');
    overlay('dataset', 'env_only', undefined, 'env');
    overlay('page', 'held_and_customized', undefined, 'env-custom');
    ship('page', 'held_and_customized', C);
    ship('email_template', 'auth.password_reset', EMAIL_BASELINE, 'builtin');
    ship('email_template', 'baseline_beside_holder', EMAIL_BASELINE, 'builtin');
    ship('email_template', 'baseline_beside_holder', A);
    ship('permission', 'guest_portal', C);
    const names: Array<[PackageScopedType, string]> = [
      ['flow', 'own_and_closure'], ['flow', 'closure_only'], ['flow', 'two_in_closure'], ['flow', 'outside_only'],
      ['page', 'kernel_page'], ['dataset', 'env_only'], ['page', 'held_and_customized'],
      ['email_template', 'auth.password_reset'], ['email_template', 'baseline_beside_holder'],
      ['permission', 'guest_portal'], ['flow', 'nothing_here'],
    ];
    const seen = new Set<string>();
    for (const [type, name] of names) {
      for (const callerPackageId of CALLERS) {
        const expected = resolvePackageScopedName(registry, { type, name, callerPackageId });
        const actual = resolvePackageScopedHolders(
          { type, name, callerPackageId },
          packageScopedHolderSource(registryPairs(type, name)),
          (caller) => metadataCore.packageResolutionClosure(registry, caller),
        );
        expect(actual, `${type} ${name} for ${String(callerPackageId)}`).toEqual(expected);
        seen.add(expected.status === 'resolved' ? expected.via : expected.status === 'refused' ? expected.reason : 'not-found');
      }
    }
    // The matrix reaches every arm of the rule, so the equality above is about all of them.
    expect([...seen].sort()).toEqual([
      'ambiguous-in-closure', 'ambiguous-in-environment', 'baseline', 'closure', 'environment',
      'not-found', 'outside-closure', 'own', 'unique-holder',
    ]);
  });

  it('a bundled type: the core answers the member the source serves', () => {
    install(A);
    install(P, [A]);
    ship('email_template', 'welcome', A);
    registry.registerItem('email_template', { ...body('email_template', 'welcome', 'alpha-zh'), locale: 'zh-CN' }, 'name' as never, A);
    for (const member of ['zh-CN', undefined, 'fr-FR']) {
      const source: PackageScopedHolderSource = {
        packageHolders: registry.packageScopedHoldersOf('email_template', 'welcome'),
        packageItem: (id) => registry.getPackageScopedItem('email_template', 'welcome', id, member),
        environmentItem: () => registry.getEnvironmentScopedItem('email_template', 'welcome', member),
      };
      expect(resolvePackageScopedHolders({ type: 'email_template', name: 'welcome', callerPackageId: P }, source, (caller) => packageResolutionClosure(registry, caller)))
        .toEqual(resolvePackageScopedName(registry, { type: 'email_template', name: 'welcome', callerPackageId: P, member }));
    }
  });
});

describe('R2 — the holder source and the types the entry resolves', () => {
  it('builds a source from `(package, item)` pairs: package holders in order, `null` as the environment', () => {
    const source = packageScopedHolderSource<string>([[B, 'b'], [null, 'env'], [A, 'a']]);
    expect(source.packageHolders).toEqual([B, A]);
    expect(source.packageItem(A)).toBe('a');
    expect(source.packageItem(C)).toBeUndefined();
    expect(source.environmentItem()).toBe('env');
    expect(packageScopedHolderSource([[A, 'a']]).environmentItem()).toBeUndefined();
  });

  it('refuses a holder set that names one holder twice: nothing picks between its two items', () => {
    expect(() => packageScopedHolderSource([[A, 1], [A, 2]])).toThrow(TypeError);
    expect(() => packageScopedHolderSource([[null, 1], [null, 2]])).toThrow(TypeError);
  });

  it('resolves `function` over a supplied source, and the registry entry refuses it: the registry holds no function', () => {
    install(A);
    install(P, [A]);
    const source = packageScopedHolderSource([[A, 'alpha fn']]);
    expect(resolvePackageScopedHolders({ type: ENGINE_FUNCTION_TYPE, name: 'score', callerPackageId: P }, source, (caller) => packageResolutionClosure(registry, caller)))
      .toMatchObject({ status: 'resolved', item: 'alpha fn', via: 'closure', holder: { kind: 'package', packageId: A } });
    expect(() => resolve('function' as PackageScopedType, 'score', P)).toThrow(TypeError);
  });

  it('positions and objects are not resolved over a supplied source either', () => {
    const source = packageScopedHolderSource([[A, 'x']]);
    for (const type of ['position', 'object']) {
      expect(() => resolvePackageScopedHolders({ type: type as PackageScopedResolvableType, name: 'n' }, source, () => new Set())).toThrow(TypeError);
    }
  });
});

describe('R2 — engine functions resolve in their referrer\'s package (ADR-0150 D4)', () => {
  let engine: ObjectQL;
  const fn = (tag: string) => Object.assign((): void => undefined, { tag });
  const installOn = (id: string, deps: string[] = [], namespace?: string) => engine.registry.installPackage(manifest(id, deps, namespace), 'code');
  const resolveFn = (name: string, callerPackageId?: string | null) => resolvePackageScopedFunction(engine, { name, callerPackageId });
  const tagOf = (r: PackageScopedResolution) =>
    r.status === 'resolved' ? ((r.item as { handler: { tag?: string } }).handler.tag) : undefined;

  beforeEach(() => {
    engine = new ObjectQL();
    engine.registry.logLevel = 'silent';
  });

  it('keeps every package\'s function of one name, the owner `app:ID` read as the package; the bare map still keeps the last', () => {
    engine.registerFunction('score', fn('alpha'), `app:${A}`);
    engine.registerFunction('score', fn('beta'), { packageId: B, effect: 'writes' });
    expect((engine.resolveFunction('score') as unknown as { tag: string }).tag).toBe('beta');
    const holders = engine.functionHoldersOf('score');
    expect(holders.packageHolders).toEqual([A, B]);
    expect((holders.packageItem(A)?.handler as unknown as { tag: string }).tag).toBe('alpha');
    expect(holders.packageItem(B)).toMatchObject({ packageId: B, effect: 'writes' });
    expect(holders.environmentItem()).toBeUndefined();
    expect(engine.functionHoldersOf('nothing_here').packageHolders).toEqual([]);
  });

  it('a package re-registering its function replaces its own entry, never adds a holder', () => {
    engine.registerFunction('score', fn('alpha-1'), `app:${A}`);
    engine.registerFunction('score', fn('alpha-2'), `app:${A}`);
    expect(engine.functionHoldersOf('score').packageHolders).toEqual([A]);
    expect((engine.functionHoldersOf('score').packageItem(A)?.handler as unknown as { tag: string }).tag).toBe('alpha-2');
  });

  it('own, then the closure: a flow of P resolves its dependency\'s function, each holder its own', () => {
    installOn(A);
    installOn(B);
    installOn(P, [A]);
    engine.registerFunction('score', fn('alpha'), `app:${A}`);
    engine.registerFunction('score', fn('beta'), `app:${B}`);
    expect(resolveFn('score', P)).toMatchObject({ status: 'resolved', via: 'closure', holder: { packageId: A } });
    expect(tagOf(resolveFn('score', P))).toBe('alpha');
    expect(tagOf(resolveFn('score', A))).toBe('alpha');
    expect(tagOf(resolveFn('score', B))).toBe('beta');
    engine.registerFunction('score', fn('caller'), `app:${P}`);
    expect(resolveFn('score', P)).toMatchObject({ status: 'resolved', via: 'own' });
    expect(tagOf(resolveFn('score', P))).toBe('caller');
  });

  it('red line 1: two holders in the closure refuse — no first- or last-registered pick', () => {
    installOn(A);
    installOn(B);
    installOn(P, [A, B]);
    engine.registerFunction('score', fn('alpha'), `app:${A}`);
    engine.registerFunction('score', fn('beta'), `app:${B}`);
    expect(resolveFn('score', P)).toMatchObject({ status: 'refused', reason: 'ambiguous-in-closure', type: 'function', callerPackageId: P });
    expect(resolveFn('score')).toMatchObject({ status: 'refused', reason: 'ambiguous-in-environment', callerPackageId: null });
  });

  it('red line 1: a function held only outside the closure is refused, never served', () => {
    installOn(C);
    installOn(P);
    engine.registerFunction('score', fn('gamma'), `app:${C}`);
    const r = resolveFn('score', P);
    expect(r).toMatchObject({ status: 'refused', reason: 'outside-closure', candidates: [{ kind: 'package', packageId: C }] });
    expect(r.status === 'refused' && r.message).toContain('The function "score"');
  });

  it('red line 2: every refusal names every holder, and the platform', () => {
    for (const id of [A, B, C]) installOn(id);
    installOn(P, [A, B, C]);
    installOn(MID);
    for (const id of [A, B, C]) engine.registerFunction('score', fn(id), `app:${id}`);
    const inClosure = resolveFn('score', P);
    if (inClosure.status !== 'refused') throw new Error(`expected a refusal, got ${inClosure.status}`);
    expect(inClosure.candidates).toEqual([A, B, C].map((packageId) => ({ kind: 'package', packageId })));
    for (const id of [A, B, C]) expect(inClosure.message).toContain(`package "${id}"`);
    const outside = resolveFn('score', MID);
    if (outside.status !== 'refused') throw new Error(`expected a refusal, got ${outside.status}`);
    expect(outside.reason).toBe('outside-closure');
    expect(outside.candidates).toEqual([A, B, C].map((packageId) => ({ kind: 'package', packageId })));
    engine.registerFunction('score', fn('host'));
    const withPlatform = resolveFn('score', P);
    if (withPlatform.status !== 'refused') throw new Error(`expected a refusal, got ${withPlatform.status}`);
    expect(withPlatform.reason).toBe('ambiguous-in-closure');
    expect(withPlatform.candidates).toEqual([...[A, B, C].map((packageId) => ({ kind: 'package', packageId })), { kind: 'platform' }]);
    expect(withPlatform.message).toContain('the platform');
  });

  describe('an owner-less registration is the platform\'s, in every caller\'s reach like `sys` (ruling 6729484996)', () => {
    it('a caller with no package and a package caller whose only holder it is both resolve to it', () => {
      installOn(P);
      engine.registerFunction('score', fn('host'));
      expect(engine.functionHoldersOf('score').packageHolders).toEqual([]);
      expect(engine.functionHoldersOf('score').environmentItem()).toBeUndefined();
      for (const caller of [undefined, P]) {
        expect(resolveFn('score', caller)).toMatchObject({ status: 'resolved', via: 'platform', holder: { kind: 'platform' } });
        expect(tagOf(resolveFn('score', caller))).toBe('host');
      }
    });

    it('a holder outside the closure is no candidate beside it', () => {
      installOn(C);
      installOn(P);
      engine.registerFunction('score', fn('gamma'), `app:${C}`);
      engine.registerFunction('score', fn('host'));
      expect(tagOf(resolveFn('score', P))).toBe('host');
    });

    it('the caller\'s own function still comes first', () => {
      installOn(P);
      engine.registerFunction('score', fn('host'));
      engine.registerFunction('score', fn('caller'), `app:${P}`);
      expect(resolveFn('score', P)).toMatchObject({ status: 'resolved', via: 'own' });
      expect(tagOf(resolveFn('score', P))).toBe('caller');
    });

    it('red line 1: beside a closure holder it refuses, naming both', () => {
      installOn(A);
      installOn(P, [A]);
      engine.registerFunction('score', fn('alpha'), `app:${A}`);
      engine.registerFunction('score', fn('host'));
      expect(resolveFn('score', P)).toMatchObject({
        status: 'refused', reason: 'ambiguous-in-closure',
        candidates: [{ kind: 'package', packageId: A }, { kind: 'platform' }],
      });
      // A caller with no package counts it as one more holder: beside a package's, it refuses (6730444942).
      expect(resolveFn('score')).toMatchObject({
        status: 'refused', reason: 'ambiguous-in-environment', callerPackageId: null,
        candidates: [{ kind: 'package', packageId: A }, { kind: 'platform' }],
      });
    });
  });

  it('a `sys` package\'s function is in every caller\'s closure', () => {
    installOn(SYS, [], 'sys');
    installOn(P);
    engine.registerFunction('now_utc', fn('kernel'), `app:${SYS}`);
    expect(resolveFn('now_utc', P)).toMatchObject({ status: 'resolved', via: 'closure', holder: { packageId: SYS } });
  });

  it('unregistering a package removes its holder, even one the bare map had already replaced', () => {
    installOn(A);
    installOn(B);
    engine.registerFunction('score', fn('alpha'), `app:${A}`);
    engine.registerFunction('score', fn('beta'), `app:${B}`);
    expect(engine.unregisterFunctionsByPackage(`app:${A}`)).toBe(0); // the bare map holds B's: its count is unchanged
    expect(engine.functionHoldersOf('score').packageHolders).toEqual([B]);
    expect(engine.unregisterFunctionsByPackage(`app:${B}`)).toBe(1);
    expect(engine.functionHoldersOf('score').packageHolders).toEqual([]);
    expect(resolveFn('score')).toEqual({ status: 'not-found' });
  });

  it('a holder set is a snapshot: a later registration is not in it', () => {
    engine.registerFunction('score', fn('alpha'), `app:${A}`);
    const holders = engine.functionHoldersOf('score');
    engine.registerFunction('score', fn('beta'), `app:${B}`);
    expect(holders.packageHolders).toEqual([A]);
  });
});

describe('R2 — one rule, one walk: objectql re-exports them, it computes neither', () => {
  it('the rule and its vocabulary are `@objectstack/core`\'s own', () => {
    expect(resolvePackageScopedHolders).toBe(core.resolvePackageScopedHolders);
    expect(packageScopedHolderSource).toBe(core.packageScopedHolderSource);
    expect(PACKAGE_SCOPED_TYPES).toBe(core.PACKAGE_SCOPED_TYPES);
    expect(PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE).toBe(core.PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE);
    expect(BARE_NAME_REGISTRY_TYPES.every((type) => core.BARE_NAME_ONE_HOLDER_TYPES.includes(type))).toBe(true);
  });

  it('the closure is `@objectstack/metadata-core`\'s one walk', () => {
    expect(packageResolutionClosure).toBe(metadataCore.packageResolutionClosure);
    expect(packageDependencyClosure).toBe(metadataCore.packageDependencyClosure);
  });
});

describe('R2 — a bundle addition is no holder of its base\'s name for a bare read (#28802)', () => {
  const D = 'com.acme.addon';
  const member = (packageId: string, locale: string, tag: string) =>
    registry.registerItem('email_template', { ...body('email_template', 'welcome', tag), locale }, 'name' as never, packageId);
  /** A dependent's stored row, as the save door hydrates it: the bare slot, stamped with the dependent. */
  const storedMember = (packageId: string, locale: string, tag: string) =>
    registry.registerItem('email_template', { ...body('email_template', 'welcome', tag), locale, _packageId: packageId, _provenance: 'org' }, 'name' as never);

  beforeEach(() => {
    install(A);
    install(D, [A]);
    install(P, [A]);
    ship('email_template', 'welcome', A);
  });

  for (const [how, add] of [['in its composite slot', member], ['as a stored row', storedMember]] as const) {
    it(`a dependent's locale its base does not ship (${how}) adds no holder: the base's name still resolves`, () => {
      add(D, 'fr-FR', 'addon-fr');
      expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([A]);
      for (const caller of [undefined, P]) {
        expect(label(resolve('email_template', 'welcome', caller))).toBe('alpha template');
      }
      // The addition is still the dependent's member, read naming the dependent.
      expect(registry.getPackageScopedItem<{ label: string }>('email_template', 'welcome', D, 'fr-FR')?.label).toBe('addon-fr template');
      // The base's address does not serve it.
      expect(resolve('email_template', 'welcome', undefined, 'fr-FR')).toEqual({ status: 'not-found' });
    });

    it(`the dependent's own bare read (${how}) still answers its own item at step 1, as before the addition rule`, () => {
      add(D, 'fr-FR', 'addon-fr');
      expect(registry.packageScopedHoldersOf('email_template', 'welcome', D)).toEqual([A, D]);
      expect(resolve('email_template', 'welcome', D, 'fr-FR')).toMatchObject({ status: 'resolved', via: 'own', holder: { kind: 'package', packageId: D } });
      expect(label(resolve('email_template', 'welcome', D, 'fr-FR'))).toBe('addon-fr template');
      expect(label(resolve('email_template', 'welcome', D))).toBe('addon-fr template');
      // A member only the base holds: unchanged — the caller's own holding answers, and it lacks it.
      expect(resolve('email_template', 'welcome', D, 'en-US')).toEqual({ status: 'not-found' });
    });
  }

  it('red line 1: a dependent holding a member its base holds is a holder, and the bare read refuses', () => {
    member(D, 'en-US', 'addon-en');
    expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([A, D]);
    expect(resolve('email_template', 'welcome')).toMatchObject({
      status: 'refused', reason: 'ambiguous-in-environment',
      candidates: [{ kind: 'package', packageId: A }, { kind: 'package', packageId: D }],
    });
  });

  it('red line 1: a package that does not declare the holder is a holder, whatever members it adds', () => {
    install(B);
    member(B, 'fr-FR', 'beta-fr');
    expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([A, B]);
    expect(resolve('email_template', 'welcome')).toMatchObject({ status: 'refused', reason: 'ambiguous-in-environment' });
  });

  it('only a bundled type has additions: a dependent\'s same-named flow is a holder', () => {
    ship('flow', 'send_email', A);
    ship('flow', 'send_email', D);
    expect(registry.packageScopedHoldersOf('flow', 'send_email')).toEqual([A, D]);
  });
});

describe('R2 — an object registered with no package id is a caller with no package (`__runtime__`)', () => {
  it('a `__runtime__` caller reaches an environment-only item over the registry', () => {
    registry.registerItem('flow', body('flow', 'env_only', 'env'), 'name' as never);
    expect(label(resolve('flow', 'env_only', core.RUNTIME_COMPATIBILITY_PACKAGE_ID))).toBe('env flow');
  });

  it('the compatibility API stamps that one spelling', () => {
    const ql = new ObjectQL();
    expect(ql.registerObject({ name: 'rt_probe', fields: {} } as never)).toBeDefined();
    expect((ql.registry.getObject('rt_probe') as { _packageId?: unknown } | undefined)?._packageId).toBe(core.RUNTIME_COMPATIBILITY_PACKAGE_ID);
  });
});

describe('R2 — a residual owner (ADR-0130 D4) reaches what it declares through the one walk', () => {
  const RESIDUAL = 'com.acme.release';

  it('a residual declaring a dependency reaches that dependency\'s item; declaring none, it is refused outside-closure', () => {
    install(A);
    ship('flow', 'send_email', A);
    expect(registry.getPackage(RESIDUAL)).toBeUndefined();
    expect(resolve('flow', 'send_email', RESIDUAL)).toMatchObject({
      status: 'refused', reason: 'outside-closure', candidates: [{ kind: 'package', packageId: A }],
    });
    registry.recordResidualOwnerDependencies(RESIDUAL, [A]);
    expect(resolve('flow', 'send_email', RESIDUAL)).toMatchObject({ status: 'resolved', via: 'closure', holder: { kind: 'package', packageId: A } });
    expect(packageDependencyClosure(RESIDUAL, registry)).toEqual({ packageId: RESIDUAL, dependencies: [A] });
    // No package record appears for it.
    expect(registry.getPackage(RESIDUAL)).toBeUndefined();
    expect(registry.getAllPackages().map((p) => p.manifest?.id)).not.toContain(RESIDUAL);
  });

  it('a residual declaring none reaches nothing beyond `sys`, and a package record always wins over a residual record', () => {
    install(A);
    ship('flow', 'send_email', A);
    registry.recordResidualOwnerDependencies(RESIDUAL, []);
    expect(resolve('flow', 'send_email', RESIDUAL)).toMatchObject({ status: 'refused', reason: 'outside-closure' });
    install(P);
    registry.recordResidualOwnerDependencies(P, [A]);
    expect(resolve('flow', 'send_email', P)).toMatchObject({ status: 'refused', reason: 'outside-closure' });
  });
});
