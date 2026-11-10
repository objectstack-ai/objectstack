// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateObjectNamespacePrefix,
  deriveNamespaceFromPackageId,
  findNamespaceObjectNameClashes,
  namespacedHoldersMeet,
} from './namespace-prefix';

describe('validateObjectNamespacePrefix', () => {
  it('returns null for a compliant prefixed name', () => {
    expect(validateObjectNamespacePrefix('todo_task', 'todo')).toBeNull();
  });

  it('flags a missing prefix and suggests the fix', () => {
    const err = validateObjectNamespacePrefix('task', 'todo');
    expect(err).toMatch(/missing the package namespace prefix/);
    expect(err).toMatch(/Rename it to 'todo_task'/);
  });

  it('flags the legacy double-underscore FQN form', () => {
    const err = validateObjectNamespacePrefix('todo__task', 'todo');
    expect(err).toMatch(/legacy FQN form/);
    expect(err).toMatch(/Rename it to 'todo_task'/);
  });

  it('always allows sys_-prefixed names', () => {
    expect(validateObjectNamespacePrefix('sys_user', 'todo')).toBeNull();
  });

  it('skips the check when namespace is absent', () => {
    expect(validateObjectNamespacePrefix('task', undefined)).toBeNull();
    expect(validateObjectNamespacePrefix('task', '')).toBeNull();
  });

  it('skips the check when object name is absent', () => {
    expect(validateObjectNamespacePrefix(undefined, 'todo')).toBeNull();
  });
});

describe('deriveNamespaceFromPackageId', () => {
  it('derives from the last dot-segment of a reverse-DNS id', () => {
    expect(deriveNamespaceFromPackageId('com.example.leave')).toBe('leave');
    expect(deriveNamespaceFromPackageId('com.example.showcase')).toBe('showcase');
    expect(deriveNamespaceFromPackageId('app.objectstack.hotcrm')).toBe('hotcrm');
  });

  it('handles a bare single-segment id', () => {
    expect(deriveNamespaceFromPackageId('myapp')).toBe('myapp');
  });

  it('sanitizes hyphens and mixed case to the namespace charset', () => {
    expect(deriveNamespaceFromPackageId('com.acme.Field-Service')).toBe('field_service');
  });

  it('returns null when nothing valid can be derived', () => {
    expect(deriveNamespaceFromPackageId('')).toBeNull();
    expect(deriveNamespaceFromPackageId(undefined)).toBeNull();
    expect(deriveNamespaceFromPackageId('com.example.x')).toBeNull(); // single char < 2
    expect(deriveNamespaceFromPackageId('com.example.123')).toBeNull(); // must start with a letter
  });
});

describe('findNamespaceObjectNameClashes (ADR-0150 D6, Q3 — child K)', () => {
  it('finds nothing when every namespace and object name differ', () => {
    expect(findNamespaceObjectNameClashes(
      { namespaces: [{ namespace: 'crm' }], objects: [{ name: 'crm_lead', namespace: 'crm' }] },
      { namespaces: [{ namespace: 'hr' }], objects: [{ name: 'hr_leave', namespace: 'hr' }] },
    )).toEqual([]);
  });

  it('refuses an incoming namespace equal to an installed object name, naming both', () => {
    const [clash, ...rest] = findNamespaceObjectNameClashes(
      { namespaces: [{ namespace: 'crm_lead', packageId: 'com.acme.leads' }] },
      { objects: [{ name: 'crm_lead', namespace: 'crm', packageId: 'com.acme.crm' }] },
    );
    expect(rest).toEqual([]);
    expect(clash.kind).toBe('namespace-equals-object');
    expect(clash.namespace).toBe('crm_lead');
    expect(clash.objectName).toBe('crm_lead');
    expect(clash.message).toContain("Namespace 'crm_lead' of package 'com.acme.leads'");
    expect(clash.message).toContain("the object 'crm_lead' of package 'com.acme.crm'");
  });

  it('refuses an incoming object name equal to an installed namespace (the other direction)', () => {
    const clashes = findNamespaceObjectNameClashes(
      { objects: [{ name: 'crm_lead', namespace: 'crm' }] },
      { namespaces: [{ namespace: 'crm_lead', packageId: 'com.acme.leads' }] },
    );
    expect(clashes).toHaveLength(1);
    expect(clashes[0].message).toMatch(/^The object 'crm_lead' of namespace 'crm' equals the installed namespace 'crm_lead' of package 'com.acme.leads'/);
  });

  it('judges an incoming stack against itself once, and an environment object too', () => {
    const clashes = findNamespaceObjectNameClashes({
      namespaces: [{ namespace: 'tasks' }],
      objects: [{ name: 'tasks' }],
    });
    expect(clashes).toHaveLength(1);
    expect(clashes[0].message).toContain("the environment object 'tasks'");
  });

  it('refuses an object short-named `custom`, which the paired package\'s namespace would equal', () => {
    const clashes = findNamespaceObjectNameClashes({ objects: [{ name: 'crm_custom', namespace: 'crm' }] });
    expect(clashes).toEqual([expect.objectContaining({
      kind: 'object-short-named-custom',
      namespace: 'crm_custom',
      objectName: 'crm_custom',
    })]);
    expect(clashes[0].message).toContain("is short-named 'custom'");
    expect(findNamespaceObjectNameClashes({ objects: [{ name: 'crm_custom_field', namespace: 'crm' }] })).toEqual([]);
  });

  it('leaves a clash between two installed holders to whoever admitted them', () => {
    expect(findNamespaceObjectNameClashes({}, {
      namespaces: [{ namespace: 'crm_lead' }],
      objects: [{ name: 'crm_lead', namespace: 'crm' }],
    })).toEqual([]);
  });
});

describe('namespacedHoldersMeet — two package holders of one name, by namespace (ADR-0150 D2/D9)', () => {
  it('two different declared namespaces do not meet; one namespace, or a missing one, meets', () => {
    expect(namespacedHoldersMeet('alpha', 'beta')).toBe(false);
    expect(namespacedHoldersMeet('alpha', 'alpha')).toBe(true);
    expect(namespacedHoldersMeet('sys', 'sys')).toBe(true);
    expect(namespacedHoldersMeet(undefined, 'beta')).toBe(true);
    expect(namespacedHoldersMeet('alpha', undefined)).toBe(true);
    expect(namespacedHoldersMeet('', 'beta')).toBe(true);
    expect(namespacedHoldersMeet(undefined, undefined)).toBe(true);
  });
});
