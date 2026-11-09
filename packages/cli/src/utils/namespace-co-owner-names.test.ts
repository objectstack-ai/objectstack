// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2, child N] `findNamespaceNameRefusals` — the WALK `os validate`
 * and `os build` run the package door's namespace name predicate over.
 *
 * The predicate and its sentence are `@objectstack/objectql`'s
 * (`namespaceNameConflicts`, `namespaceNameConflictMessage`), the pair the
 * package door throws the answer of; its own file pins them. What this module
 * owns, and what is pinned here, is which packages it hands that predicate and
 * in which order — the boot's: an artifact's `packages[]` bodies, in
 * dependency order, each against the bodies before it.
 *
 * Every row's message is asserted EQUAL to the predicate's sentence for the
 * same conflicts — never re-spelled.
 */

import { describe, expect, it } from 'vitest';
import {
  NAMESPACE_CONFLICT_CODE,
  NAMESPACE_UNIQUE_TYPES,
  namespaceNameConflictMessage,
  type NamespaceUniqueType,
} from '@objectstack/objectql';
import { findNamespaceNameRefusals } from './namespace-co-owner-names.js';

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

/**
 * A spec-valid item of each type: the walk reads packages through
 * `resolveArtifactPackageOrder`, which parses every entry as the boot does.
 */
const item = (type: NamespaceUniqueType, name: string): Record<string, unknown> => {
  switch (type) {
    case 'sharing_rule':
      return { name, label: name, type: 'criteria', object: 'crm_account', sharedWith: { type: 'team', value: 'sales' }, condition: 'true', accessLevel: 'read' };
    case 'assignment_rule':
      return { name, label: name, object: 'crm_account', entries: [{ name: 'e1', assignTo: { type: 'queue', value: 'triage' } }] };
    case 'hook':
      return { name, label: name, object: 'crm_account', events: ['beforeInsert'], body: { language: 'js', source: 'return;' } };
    case 'job':
      return { name, label: name, schedule: { type: 'cron', expression: '0 * * * *' }, handler: 'noop' };
    case 'page':
      return { name, label: name, type: 'app', regions: [] };
    case 'dashboard':
      return { name, label: name, widgets: [] };
    case 'report':
      return { name, label: name, dataset: 'ds', values: ['total'] };
    case 'book':
      return { name, label: name, groups: [] };
    case 'analytics_cube':
      return { name, title: name, sql: 'select 1', measures: {}, dimensions: {} };
    case 'tool':
      return { name, label: name, description: 'A tool', parameters: {} };
    default:
      return { name, label: name };
  }
};

const body = (id: string, ns: string | undefined, decl: Partial<Record<NamespaceUniqueType, string[]>> = {}, extra: Record<string, unknown> = {}) => {
  const out: Record<string, unknown> = { id, name: id.split('.').pop(), version: '1.0.0', type: 'app', ...(ns ? { namespace: ns } : {}), ...extra };
  for (const [type, names] of Object.entries(decl) as Array<[NamespaceUniqueType, string[]]>) {
    out[COLLECTION[type]] = names.map((name) => item(type, name));
  }
  return out;
};

const artifact = (...bodies: Array<Record<string, unknown>>) => ({ packages: bodies.map((manifest) => ({ manifest })) });

describe.each(NAMESPACE_UNIQUE_TYPES)('%s — os validate refuses an artifact whose packages share a name inside one namespace', (type) => {
  it('one row for the second package, naming both holders, in the package door\'s words', () => {
    const rows = findNamespaceNameRefusals(artifact(
      body('com.acme.alpha', 'crm', { [type]: ['shared_item'] }),
      body('com.acme.beta', 'crm', { [type]: ['shared_item', 'beta_only'] }),
    ));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect([row.packageId, row.code, row.httpStatus]).toEqual(['com.acme.beta', NAMESPACE_CONFLICT_CODE, 422]);
    expect(row.conflicts).toEqual([
      { namespace: 'crm', type, name: 'shared_item', incomingPackageId: 'com.acme.beta', existingPackageIds: ['com.acme.alpha'] },
    ]);
    expect(row.message).toBe(namespaceNameConflictMessage(row.conflicts));
    expect(row.message).toContain('"com.acme.alpha"');
    expect(row.message).toContain('"com.acme.beta"');
  });

  it('CONTROL — the same name in two different namespaces is not refused', () => {
    expect(findNamespaceNameRefusals(artifact(
      body('com.acme.alpha', 'crm', { [type]: ['shared_item'] }),
      body('com.other.hr', 'hr', { [type]: ['shared_item'] }),
    ))).toEqual([]);
  });
});

describe('the walk', () => {
  it('a stack with no `packages[]` is one package: never refused here', () => {
    expect(findNamespaceNameRefusals({
      manifest: { id: 'com.acme.alpha', name: 'alpha', version: '1.0.0', type: 'app', namespace: 'crm' },
      pages: [item('page', 'home'), item('page', 'home')],
    })).toEqual([]);
  });

  it('CONTROL — the same name across two types, and one package declaring a name twice, are not refused', () => {
    expect(findNamespaceNameRefusals(artifact(
      body('com.acme.alpha', 'crm', { page: ['home', 'home'] }),
      body('com.acme.beta', 'crm', { dashboard: ['home'] }),
    ))).toEqual([]);
  });

  it('CONTROL — a shareable platform namespace is not judged', () => {
    expect(findNamespaceNameRefusals(artifact(
      body('com.platform.one', 'sys', { page: ['home'] }),
      body('com.platform.two', 'sys', { page: ['home'] }),
    ))).toEqual([]);
  });

  it('every refused package is reported, and a refused one still counts as a holder for the packages after it', () => {
    const rows = findNamespaceNameRefusals(artifact(
      body('com.acme.alpha', 'crm', { report: ['pipeline'] }),
      body('com.acme.beta', 'crm', { report: ['pipeline'] }),
      body('com.acme.gamma', 'crm', { report: ['pipeline'] }),
    ));
    expect(rows.map((r) => [r.packageId, r.conflicts[0].existingPackageIds])).toEqual([
      ['com.acme.beta', ['com.acme.alpha']],
      ['com.acme.gamma', ['com.acme.alpha', 'com.acme.beta']],
    ]);
  });

  it('walks in the boot\'s dependency order, not the array\'s: the dependent is the one refused', () => {
    const rows = findNamespaceNameRefusals(artifact(
      body('com.acme.billing', 'crm', { queue: ['triage'] }, { dependencies: { 'com.acme.core': '^1.0.0' } }),
      body('com.acme.core', 'crm', { queue: ['triage'] }),
    ));
    expect(rows.map((r) => [r.packageId, r.conflicts[0].existingPackageIds])).toEqual([
      ['com.acme.billing', ['com.acme.core']],
    ]);
  });
});
