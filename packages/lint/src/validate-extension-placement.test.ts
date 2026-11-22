// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35901] `os validate` names an object extension's placement that will not
 * land as written, when the extended object is in the stack: not applied (the
 * object declares no tab list / groups), or an anchor it does not have.
 * Warnings only. Each finding row differs from the control by one key.
 */

import { describe, it, expect } from 'vitest';
import {
  EXTENSION_PLACEMENT_ANCHOR_MISSING,
  EXTENSION_PLACEMENT_NOT_APPLIED,
  validateExtensionPlacement,
} from './validate-extension-placement.js';
import { validateReferenceIntegrity } from './reference-integrity-suite.js';

const account = (extra: Record<string, unknown> = {}) => ({
  name: 'account',
  fields: {
    name: { type: 'text', group: 'basic' },
    industry: { type: 'text', group: 'basic' },
  },
  fieldGroups: [{ key: 'basic', label: 'Basic' }],
  relatedLists: ['opportunity'],
  ...extra,
});

const stackWith = (place: unknown[], target: Record<string, unknown> = account()) => ({
  objects: [target],
  objectExtensions: [{ extend: 'account', fields: { tax_id: { type: 'text' } }, place }],
});

const CONTROL = [
  { field: 'tax_id', group: 'basic', after: 'industry' },
  { group: { key: 'tax', label: 'Tax' }, after: 'basic' },
  { list: 'contract', after: 'opportunity' },
  { list: 'contract.account_id', before: 'sys_activity' },
];

const rules = (stack: Record<string, unknown>) => validateExtensionPlacement(stack).map((f) => `${f.rule}@${f.path}`);

describe('validateExtensionPlacement', () => {
  it('names nothing for placements whose anchors the object has (control)', () => {
    expect(validateExtensionPlacement(stackWith(CONTROL))).toEqual([]);
  });

  it('names a list placement on an object with no relatedLists, and its inert label / columns', () => {
    const findings = validateExtensionPlacement(stackWith([{ list: 'contract', label: 'Contracts' }], account({ relatedLists: undefined })));
    expect(findings.map((f) => f.rule)).toEqual([EXTENSION_PLACEMENT_NOT_APPLIED]);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain("declares no `relatedLists`");
    expect(findings[0].message).toContain('label / columns are not applied either');
    expect(findings[0].hint).toContain('relatedListTitle / relatedListColumns');
  });

  it('names group and field placements on an object with no fieldGroups, the field\'s after included', () => {
    const findings = validateExtensionPlacement(stackWith(CONTROL.slice(0, 2), account({ fieldGroups: undefined })));
    expect(findings.map((f) => f.rule)).toEqual([EXTENSION_PLACEMENT_NOT_APPLIED, EXTENSION_PLACEMENT_NOT_APPLIED]);
    expect(findings[0].message).toContain("field `tax_id` in group 'basic' after 'industry'");
  });

  it.each([
    ['a list anchor', { list: 'contract', after: 'invoice' }],
    ['a group anchor', { group: { key: 'tax', label: 'Tax' }, before: 'finance' }],
    ['a field anchor', { field: 'tax_id', group: 'basic', after: 'phone' }],
    ['a field\'s group', { field: 'tax_id', group: 'finance' }],
  ])('names %s the object does not have', (_label, entry) => {
    expect(rules(stackWith([entry]))).toEqual([`${EXTENSION_PLACEMENT_ANCHOR_MISSING}@objectExtensions[0].place[0]`]);
  });

  it('accepts an anchor another extension of the same object places', () => {
    const stack = {
      objects: [account()],
      objectExtensions: [
        { extend: 'account', fields: { tax_id: { type: 'text' } }, place: [{ group: { key: 'tax', label: 'Tax' } }] },
        { extend: 'account', fields: { vat: { type: 'text' } }, place: [{ field: 'vat', group: 'tax' }, { group: { key: 'audit', label: 'Audit' }, after: 'tax' }] },
      ],
    };
    expect(validateExtensionPlacement(stack)).toEqual([]);
  });

  it('judges a package body\'s extensions against the stack\'s objects, and skips a target outside the stack', () => {
    const inPackage = {
      objects: [account({ relatedLists: undefined })],
      packages: [{ manifest: { objectExtensions: [{ extend: 'account', place: [{ list: 'contract' }] }] } }],
    };
    expect(rules(inPackage)).toEqual([`${EXTENSION_PLACEMENT_NOT_APPLIED}@packages[0].manifest.objectExtensions[0].place[0]`]);
    expect(validateExtensionPlacement({ objects: [], objectExtensions: [{ extend: 'account', place: [{ list: 'contract' }] }] })).toEqual([]);
  });

  it('runs in the reference-integrity suite', () => {
    const findings = validateReferenceIntegrity(stackWith([{ list: 'contract', after: 'invoice' }]) as never);
    expect(findings.some((f) => f.rule === EXTENSION_PLACEMENT_ANCHOR_MISSING)).toBe(true);
  });
});
