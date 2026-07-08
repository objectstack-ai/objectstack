// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validateObjectNamespacePrefix, deriveNamespaceFromPackageId } from './namespace-prefix';

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
