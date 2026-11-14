// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2, child N] Inside one namespace, a `(type, name)` of the twelve
 * uncovered bucket 2/3 types has one package holder — refused at the package
 * door (`SchemaRegistry.installPackage`, beside the ADR-0130 D3 object check),
 * naming every holder (`namespace-co-owner-names.ts`).
 *
 * Every refusal is asserted by its ADR-0112 envelope (`code` + `status`), the
 * holders it names and the structured `conflicts[]` — never a bare throw.
 *
 * The CONTROLs pin what the rule leaves alone: the same name in two
 * namespaces, the same name across two types, the same package again, a
 * shareable platform namespace, the environment catalog, and every type
 * outside the twelve.
 */

import { describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { NamespaceNameConflictError, RESERVED_NAMESPACES, SchemaRegistry } from './registry.js';
import { BARE_NAME_ONE_HOLDER_TYPES } from './bare-name-one-holder.js';
import {
  NAMESPACE_UNIQUE_TYPES,
  declaredNamespaceUniqueNames,
  isNamespaceJudged,
  namespaceNameConflictMessage,
  namespaceNameConflicts,
  namespacePackageOf,
  type NamespaceUniqueType,
} from './namespace-co-owner-names.js';
import type { ObjectQL } from './engine.js';

type Refusal = Error & {
  code?: string;
  status?: number;
  httpStatus?: number;
  conflicts?: Array<{ namespace: string; type: string; name: string; incomingPackageId: string; existingPackageIds: string[] }>;
};

const COLLECTION: Record<NamespaceUniqueType, string> = {
  sharing_rule: 'sharingRules',
  queue: 'queues',
  assignment_rule: 'assignmentRules',
  hook: 'hooks',
  job: 'jobs',
  app: 'apps',
  page: 'pages',
  dashboard: 'dashboards',
  report: 'reports',
  book: 'books',
  analytics_cube: 'analyticsCubes',
  tool: 'tools',
};

/** A package of namespace `ns` declaring `decl`'s items, each labelled with the package's last id segment. */
const pkg = (id: string, ns: string | undefined, decl: Partial<Record<NamespaceUniqueType, string[]>> = {}, extra: Record<string, unknown> = {}) => {
  const tag = id.split('.').pop()!;
  const out: Record<string, unknown> = { id, name: tag, version: '1.0.0', type: 'app', ...(ns ? { namespace: ns } : {}), ...extra };
  for (const [type, names] of Object.entries(decl) as Array<[NamespaceUniqueType, string[]]>) {
    // A page is a `home` page: a record page (the default type) placing no
    // component is refused at parse, and this file is about names, not bodies.
    out[COLLECTION[type]] = names.map((name) => ({ name, label: `${tag} ${type}`, ...(type === 'page' ? { type: 'home' } : {}) }));
  }
  return out;
};

const scopeOf = (...ids: string[]) => ({ packageIds: ids });

const install = (registry: SchemaRegistry, manifest: unknown, scope?: { packageIds: string[] }): Refusal | undefined => {
  try {
    registry.installPackage(manifest as never, 'code', undefined, scope);
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
};

const fresh = (collisionPolicy: 'error' | 'warn' = 'error') => new SchemaRegistry({ multiTenant: false, collisionPolicy });

describe('the vocabulary', () => {
  it('the twelve types, in ADR-0150 child N\'s order', () => {
    expect(NAMESPACE_UNIQUE_TYPES).toEqual([
      'sharing_rule', 'queue', 'assignment_rule', 'hook', 'job',
      'app', 'page', 'dashboard', 'report', 'book', 'analytics_cube', 'tool',
    ]);
  });

  it('phase 1\'s one-holder list is not touched: the two lists share at most `tool`', () => {
    const shared = NAMESPACE_UNIQUE_TYPES.filter((t) => (BARE_NAME_ONE_HOLDER_TYPES as readonly string[]).includes(t));
    expect(shared.filter((t) => t !== 'tool')).toEqual([]);
  });

  it('judges every named namespace but the install gate\'s shareable ones (`RESERVED_NAMESPACES` and `sys`)', () => {
    for (const ns of [...RESERVED_NAMESPACES, 'sys']) expect(isNamespaceJudged(ns), ns).toBe(false);
    expect(isNamespaceJudged('')).toBe(false);
    expect(isNamespaceJudged(undefined)).toBe(false);
    expect(isNamespaceJudged('crm')).toBe(true);
  });

  it('reads each collection by its manifest key, nested plugins one level deep, and the app rows the engine registers', () => {
    const declared = declaredNamespaceUniqueNames({
      id: 'com.acme.alpha',
      name: 'alpha',
      ...Object.fromEntries(NAMESPACE_UNIQUE_TYPES.map((t) => [COLLECTION[t], [{ name: `${t}_one` }]])),
      // an item named by `id` alone, as the engine's seam names it
      pages: [{ id: 'by_id' }, { label: 'nameless' }],
      plugins: [
        // a nested plugin's `apps` is NOT registered by the nested seam; its own app row is
        { name: 'inner', navigation: [], apps: [{ name: 'nested_apps_entry' }], tools: [{ name: 'inner_tool' }] },
      ],
    });
    const spelt = declared.map((d) => `${d.type}/${d.name}`);
    expect(spelt).toEqual([
      'sharing_rule/sharing_rule_one', 'queue/queue_one', 'assignment_rule/assignment_rule_one',
      'hook/hook_one', 'job/job_one', 'app/app_one', 'page/by_id', 'dashboard/dashboard_one',
      'report/report_one', 'book/book_one', 'analytics_cube/analytics_cube_one', 'tool/tool_one',
      'app/inner', 'tool/inner_tool',
    ]);
    expect(spelt).not.toContain('app/nested_apps_entry');
  });

  it('the manifest itself is an app only when it registers as one (a name, a navigation, no `apps`)', () => {
    expect(declaredNamespaceUniqueNames({ id: 'x', name: 'shell', navigation: [] })).toEqual([{ type: 'app', name: 'shell' }]);
    expect(declaredNamespaceUniqueNames({ id: 'x', name: 'shell', navigation: [], apps: [{ name: 'a' }] }))
      .toEqual([{ type: 'app', name: 'a' }]);
    expect(declaredNamespaceUniqueNames({ id: 'x', name: 'shell' })).toEqual([]);
  });

  it('the predicate names EVERY other holder of the namespace, once per (type, name)', () => {
    const incoming = namespacePackageOf(pkg('com.acme.gamma', 'crm', { page: ['home', 'home'] }))!;
    const conflicts = namespaceNameConflicts(incoming, [
      namespacePackageOf(pkg('com.acme.alpha', 'crm', { page: ['home'] }))!,
      namespacePackageOf(pkg('com.acme.beta', 'crm', { page: ['home'] }))!,
      namespacePackageOf(pkg('com.other.delta', 'hr', { page: ['home'] }))!,
    ]);
    expect(conflicts).toEqual([
      { namespace: 'crm', type: 'page', name: 'home', incomingPackageId: 'com.acme.gamma', existingPackageIds: ['com.acme.alpha', 'com.acme.beta'] },
    ]);
    const message = namespaceNameConflictMessage(conflicts);
    for (const id of ['com.acme.gamma', 'com.acme.alpha', 'com.acme.beta']) expect(message).toContain(`"${id}"`);
    expect(message).not.toContain('com.other.delta');
    expect(message).toContain('the page "home" in namespace "crm"');
  });
});

describe.each(NAMESPACE_UNIQUE_TYPES)('%s — a second package of one namespace declaring a held name is refused at install', (type) => {
  it('refuses the second co-owner, naming both holders, ahead of every mutation', () => {
    const registry = fresh();
    const scope = scopeOf('com.acme.alpha', 'com.acme.beta');
    expect(install(registry, pkg('com.acme.alpha', 'crm', { [type]: ['shared_item', 'alpha_only'] }), scope)).toBeUndefined();

    const err = install(registry, pkg('com.acme.beta', 'crm', { [type]: ['beta_only', 'shared_item'] }), scope);
    expect(err).toBeInstanceOf(NamespaceNameConflictError);
    expect([err?.code, err?.status, err?.httpStatus]).toEqual(['NAMESPACE_CONFLICT', 422, 422]);
    expect(err?.conflicts).toEqual([
      { namespace: 'crm', type, name: 'shared_item', incomingPackageId: 'com.acme.beta', existingPackageIds: ['com.acme.alpha'] },
    ]);
    expect(err?.message).toContain('package "com.acme.beta"');
    expect(err?.message).toContain('package "com.acme.alpha"');
    expect(err?.message).toContain('"shared_item"');
    // Ahead of every mutation: no record, no namespace ownership.
    expect(registry.getPackage('com.acme.beta')).toBeUndefined();
    expect(registry.getNamespaceOwners('crm')).toEqual(['com.acme.alpha']);
  });

  it('CONTROL — the same name in two DIFFERENT namespaces installs (phase 1\'s business, unchanged)', () => {
    const registry = fresh();
    expect(install(registry, pkg('com.acme.alpha', 'crm', { [type]: ['shared_item'] }))).toBeUndefined();
    expect(install(registry, pkg('com.other.hr', 'hr', { [type]: ['shared_item'] }))).toBeUndefined();
    expect(registry.getPackage('com.other.hr')).toBeDefined();
  });

  it('CONTROL — the same package re-registering its own item installs', () => {
    const registry = fresh();
    const scope = scopeOf('com.acme.alpha', 'com.acme.beta');
    expect(install(registry, pkg('com.acme.alpha', 'crm', { [type]: ['shared_item'] }), scope)).toBeUndefined();
    expect(install(registry, pkg('com.acme.alpha', 'crm', { [type]: ['shared_item'] }), scope)).toBeUndefined();
    expect(install(registry, pkg('com.acme.alpha', 'crm', { [type]: ['shared_item'] }))).toBeUndefined();
  });
});

describe('what the rule leaves alone', () => {
  it('CONTROL — the same name across two different types in one namespace installs', () => {
    const registry = fresh();
    const scope = scopeOf('com.acme.alpha', 'com.acme.beta');
    expect(install(registry, pkg('com.acme.alpha', 'crm', { page: ['home'], tool: ['lookup'] }), scope)).toBeUndefined();
    expect(install(registry, pkg('com.acme.beta', 'crm', { dashboard: ['home'], report: ['lookup'] }), scope)).toBeUndefined();
  });

  it('CONTROL — co-owners with distinct names both install, and the bare name keeps serving its one holder (reading (b))', async () => {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    try {
      const svc = kernel.getService('manifest') as { register(m: unknown): void | Promise<void> };
      await svc.register({
        packages: [
          { manifest: pkg('com.acme.alpha', 'crm', { page: ['alpha_home'] }) },
          { manifest: pkg('com.acme.beta', 'crm', { page: ['beta_home'] }) },
        ],
      });
      const ql = kernel.getService<ObjectQL>('objectql');
      expect((ql.registry.getItem('page', 'alpha_home') as { label?: string } | undefined)?.label).toBe('alpha page');
      expect((ql.registry.getItem('page', 'beta_home') as { label?: string } | undefined)?.label).toBe('beta page');
    } finally {
      await kernel.shutdown();
    }
  });

  it('CONTROL — a package declaring one name twice in itself is one holder, never refused here', () => {
    const registry = fresh();
    expect(install(registry, pkg('com.acme.alpha', 'crm', { page: ['home', 'home'] }))).toBeUndefined();
  });

  it('CONTROL — a shareable platform namespace is not judged (the install gate lets packages share it)', () => {
    const registry = fresh();
    for (const ns of ['sys', ...RESERVED_NAMESPACES]) {
      expect(install(registry, pkg(`com.platform.${ns}.one`, ns, { page: ['home'] }))).toBeUndefined();
      expect(install(registry, pkg(`com.platform.${ns}.two`, ns, { page: ['home'] }))).toBeUndefined();
    }
  });

  it('CONTROL — a package with no namespace holds nothing to share', () => {
    const registry = fresh();
    expect(install(registry, pkg('com.acme.alpha', undefined, { page: ['home'] }))).toBeUndefined();
    expect(install(registry, pkg('com.acme.beta', undefined, { page: ['home'] }))).toBeUndefined();
  });

  it('CONTROL — the environment catalog is never a holder', () => {
    const registry = fresh();
    registry.registerItem('page', { name: 'home', label: 'environment page' }, 'name');
    expect(install(registry, pkg('com.acme.alpha', 'crm', { page: ['home'] }))).toBeUndefined();
  });

  it('CONTROL — a type outside the twelve is not judged here (a view, a flow, a permission set)', () => {
    const registry = fresh();
    const scope = scopeOf('com.acme.alpha', 'com.acme.beta');
    const extra = (tag: string) => ({ views: [{ name: 'shared_view', label: tag }], flows: [{ name: 'shared_flow', label: tag }] });
    expect(install(registry, pkg('com.acme.alpha', 'crm', {}, extra('alpha')), scope)).toBeUndefined();
    expect(install(registry, pkg('com.acme.beta', 'crm', {}, extra('beta')), scope)).toBeUndefined();
  });

  it('an uninstall takes its names with it: the next package of the namespace may hold them', () => {
    const registry = fresh();
    const scope = scopeOf('com.acme.alpha', 'com.acme.beta');
    expect(install(registry, pkg('com.acme.alpha', 'crm', { page: ['home'] }), scope)).toBeUndefined();
    registry.uninstallPackage('com.acme.alpha');
    expect(install(registry, pkg('com.acme.beta', 'crm', { page: ['home'] }), scope)).toBeUndefined();
  });
});

describe('the refusal', () => {
  it('lists every conflicting name in one refusal, in declaration order', () => {
    const registry = fresh();
    const scope = scopeOf('com.acme.alpha', 'com.acme.beta');
    expect(install(registry, pkg('com.acme.alpha', 'crm', { page: ['home'], queue: ['triage'], hook: ['on_save'] }), scope)).toBeUndefined();
    const err = install(registry, pkg('com.acme.beta', 'crm', { queue: ['triage'], hook: ['on_save'], page: ['home'] }), scope);
    expect(err?.code).toBe('NAMESPACE_CONFLICT');
    expect(err?.conflicts?.map((c) => `${c.type}/${c.name}`)).toEqual(['queue/triage', 'hook/on_save', 'page/home']);
    expect(err?.message).toContain('3 names');
  });

  it('a co-owner by a declared dependency is judged as an artifact co-owner is (ADR-0141 D5)', () => {
    const registry = fresh();
    expect(install(registry, pkg('com.acme.crm', 'crm', { app: ['crm_home'] }))).toBeUndefined();
    const err = install(registry, pkg('com.acme.crm.billing', 'crm', { app: ['crm_home'] }, { dependencies: { 'com.acme.crm': '^1.0.0' } }));
    expect([err?.code, err?.status]).toEqual(['NAMESPACE_CONFLICT', 422]);
    expect(err?.conflicts?.[0]?.existingPackageIds).toEqual(['com.acme.crm']);
  });

  it('`OS_METADATA_COLLISION=warn` does not downgrade it: two strangers the namespace gate let share `crm` are refused', () => {
    const registry = fresh('warn');
    expect(install(registry, pkg('com.acme.alpha', 'crm', { report: ['pipeline'] }))).toBeUndefined();
    const err = install(registry, pkg('com.other.beta', 'crm', { report: ['pipeline'] }));
    expect(err).toBeInstanceOf(NamespaceNameConflictError);
    expect(registry.getPackage('com.other.beta')).toBeUndefined();
  });

  it('runs after the ADR-0130 D3 object check: an install refused by both answers the object refusal', () => {
    const registry = fresh();
    const scope = scopeOf('com.acme.alpha', 'com.acme.beta');
    const object = { name: 'crm_account', label: 'Account', fields: { name: { name: 'name', label: 'Name', type: 'text' } } };
    registry.registerObject({ ...object } as never, 'com.acme.alpha', 'crm', 'own');
    expect(install(registry, pkg('com.acme.alpha', 'crm', { page: ['home'] }, { objects: [object] }), scope)).toBeUndefined();
    const err = install(registry, pkg('com.acme.beta', 'crm', { page: ['home'] }, { objects: [object] }), scope);
    expect(err?.code).toBe('DUPLICATE_ARTIFACT_OBJECT_NAME');
  });

  it('after the cold boot\'s seal, a same-namespace tool is refused by THIS rule (it runs ahead of the bare-name rule)', () => {
    const registry = fresh();
    const scope = scopeOf('com.acme.alpha', 'com.acme.beta');
    expect(install(registry, pkg('com.acme.alpha', 'crm', { tool: ['lookup'] }), scope)).toBeUndefined();
    registry.sealBareNameHolders();
    const err = install(registry, pkg('com.acme.beta', 'crm', { tool: ['lookup'] }), scope);
    expect(err).toBeInstanceOf(NamespaceNameConflictError);
    expect(err?.conflicts?.[0]).toMatchObject({ type: 'tool', name: 'lookup', existingPackageIds: ['com.acme.alpha'] });
  });

  it('on the real load path, an artifact whose co-owners share a name is refused at install, per family', async () => {
    // One spec-valid body per family (the load path parses each package entry).
    const account = { name: 'crm_account', label: 'Account', fields: { name: { name: 'name', label: 'Name', type: 'text' } } };
    const bodies = {
      sharing_rule: { sharingRules: [{ name: 'shared_item', label: 'x', type: 'criteria', object: 'crm_account', sharedWith: { type: 'team', value: 'sales' }, condition: 'true', accessLevel: 'read' }] },
      hook: { hooks: [{ name: 'shared_item', label: 'x', object: 'crm_account', events: ['beforeInsert'], body: { language: 'js', source: 'return;' } }] },
      page: { pages: [{ name: 'shared_item', label: 'x', type: 'app', regions: [] }] },
      tool: { tools: [{ name: 'shared_item', label: 'x', description: 'A tool', parameters: {} }] },
    } as const;
    for (const type of ['sharing_rule', 'hook', 'page', 'tool'] as const) {
      const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
      await kernel.use(new ObjectQLPlugin());
      await kernel.bootstrap();
      try {
        const svc = kernel.getService('manifest') as { register(m: unknown): void | Promise<void> };
        let err: Refusal | undefined;
        try {
          await svc.register({
            packages: [
              { manifest: pkg('com.acme.alpha', 'crm', {}, { objects: [account], ...bodies[type] }) },
              { manifest: pkg('com.acme.beta', 'crm', {}, { ...bodies[type] }) },
            ],
          });
        } catch (e) {
          err = e as Refusal;
        }
        expect([err?.code, err?.status], `${type}: ${err?.message}`).toEqual(['NAMESPACE_CONFLICT', 422]);
        expect(err?.message).toContain('com.acme.alpha');
        expect(err?.message).toContain('com.acme.beta');
        expect(kernel.getService<ObjectQL>('objectql').registry.getPackage('com.acme.beta'), type).toBeUndefined();
      } finally {
        await kernel.shutdown();
      }
    }
  });
});
