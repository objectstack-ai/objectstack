// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Two of `os doctor`'s config checks read a lookup field's target through a
// truthiness gate — `if (field?.type === 'lookup' && field?.reference)` — and
// then put the value straight into a graph node (`detectCircularDependencies`)
// or a name set (`findUnusedObjects`). An object- or array-valued `reference`
// passes truthiness, so a non-string entered both, where it matches no object
// name and renders as `[object Object]` in a cycle message.
//
// `collectViewObjectRefs`, twenty lines away in the same file, already narrowed
// its carrier with `typeof … === 'string'`; these two now read it through the
// same arbiter the rest of the platform uses. Unreadability is REPORTED rather
// than skipped, because both checks publish a positive verdict — "no circular
// references detected", "defined but not referenced" — that an edge nobody
// could read cannot support.

import { describe, it, expect } from 'vitest';
import { detectCircularDependencies, findUnusedObjects } from '../src/commands/doctor';

/** An `ObjectSchema` literal where the target NAME belongs. */
const UNREADABLE = { name: 'crm_account', fields: {} };

const obj = (name: string, fields: Record<string, unknown>) => ({ name, label: name, fields });

describe('doctor.detectCircularDependencies — an unreadable `reference` carrier', () => {
  it('never puts a non-string into the dependency graph, and says so', () => {
    const issues = detectCircularDependencies([
      obj('crm_contact', { account: { type: 'lookup', reference: UNREADABLE } }),
      obj('crm_account', {}),
    ]);
    expect(issues.join('\n')).not.toContain('[object Object]');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('crm_contact');
    expect(issues[0]).toContain('account');
    expect(issues[0]).toContain('doctor.detectCircularDependencies');
  });

  it('still detects a cycle built from readable targets', () => {
    const issues = detectCircularDependencies([
      obj('crm_contact', { account: { type: 'lookup', reference: 'crm_account' } }),
      obj('crm_account', { primary_contact: { type: 'lookup', reference: 'crm_contact' } }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('Circular dependency');
  });

  it('stays silent for a lookup that legitimately names no target', () => {
    expect(detectCircularDependencies([obj('crm_contact', { account: { type: 'lookup' } })])).toEqual([]);
  });
});

describe('doctor.findUnusedObjects — an unreadable `reference` carrier', () => {
  const config = (reference: unknown) => ({
    objects: [
      obj('crm_contact', { account: { type: 'lookup', reference } }),
      obj('crm_account', { title: { type: 'text' } }),
    ],
    views: [{ list: { type: 'grid', data: { provider: 'object', object: 'crm_contact' } } }],
  });

  it('reports the unreadable carrier rather than letting it distort the verdict', () => {
    const found = findUnusedObjects(config(UNREADABLE));
    expect(found.join('\n')).not.toContain('[object Object]');
    // The carrier finding is present, and names the field that carries it.
    expect(found.some(m => m.includes('crm_contact') && m.includes('account') && m.includes('unreadable')))
      .toBe(true);
    expect(found.some(m => m.includes('doctor.findUnusedObjects'))).toBe(true);
  });

  it('still counts a readable lookup target as a reference', () => {
    // `crm_account` is referenced ONLY by the lookup, so this is the control
    // that separates "narrowed" from "this path was closed".
    expect(findUnusedObjects(config('crm_account'))).toEqual([]);
  });
});
