// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { defineStack } from '@objectstack/spec';
import { runAuthoringRules, splitBySeverity } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';
import { SECURITY_OWD_UNSET, SYNCED_OBJECT_WAY_OUT, validateSecurityPosture } from './validate-security-posture.js';
import {
  SECURITY_SYNCED_PRIVATE_UNREADABLE,
  validateSyncedPrivateReadability,
} from './validate-synced-private-readability.js';

/** A synced object: the shape ADR-0153 D4 gives a pull target. */
function synced(overrides: Record<string, unknown> = {}) {
  return {
    name: 'erp_order_copy',
    label: 'ERP order copy',
    managedBy: 'synced',
    sharingModel: 'private',
    fields: { order_no: { type: 'text', label: 'Order no' } },
    ...overrides,
  };
}

/** A criteria sharing rule on `object`, granting `read` to a team unless the override says otherwise. */
function rule(object: string, overrides: Record<string, unknown> = {}) {
  return {
    name: `share_${object}`,
    type: 'criteria',
    object,
    condition: 'record.order_no != ""',
    sharedWith: { type: 'team', value: 'sales' },
    ...overrides,
  };
}

function rulesOf(stack: Record<string, unknown>): string[] {
  return validateSyncedPrivateReadability(stack).map((f) => f.rule);
}

describe('security-synced-private-unreadable (ADR-0153 D4)', () => {
  it('warns on a private synced object that no sharing rule grants read on, with the D4 fix-it', () => {
    const findings = validateSyncedPrivateReadability({ objects: [synced()] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      rule: SECURITY_SYNCED_PRIVATE_UNREADABLE,
      where: 'object "erp_order_copy"',
      path: 'objects[0].sharingModel',
    });
    // The two remedies, in the wording `security-owd-unset` gives a synced object.
    expect(findings[0].hint).toBe(SYNCED_OBJECT_WAY_OUT);
  });

  it('is silent when a sharing rule grants read on the object', () => {
    expect(rulesOf({ objects: [synced()], sharingRules: [rule('erp_order_copy')] })).toEqual([]);
    // `edit` is read and write; an absent level is the schema default, `read`.
    expect(rulesOf({ objects: [synced()], sharingRules: [rule('erp_order_copy', { accessLevel: 'edit' })] })).toEqual([]);
    expect(rulesOf({ objects: [synced()], sharingRules: [rule('erp_order_copy', { accessLevel: 'read' })] })).toEqual([]);
    // Any recipient counts.
    expect(
      rulesOf({
        objects: [synced()],
        sharingRules: [rule('erp_order_copy', { sharedWith: { type: 'unit_and_subordinates', value: 'hq' } })],
      }),
    ).toEqual([]);
  });

  it('still warns when the only rule is inactive: the runtime skips it', () => {
    expect(
      rulesOf({ objects: [synced()], sharingRules: [rule('erp_order_copy', { active: false })] }),
    ).toEqual([SECURITY_SYNCED_PRIVATE_UNREADABLE]);
  });

  it('still warns when the only read-granting rule is on another object', () => {
    expect(
      rulesOf({
        objects: [synced(), synced({ name: 'erp_invoice_copy' })],
        sharingRules: [rule('erp_invoice_copy')],
      }),
    ).toEqual([SECURITY_SYNCED_PRIVATE_UNREADABLE]);
    expect(
      validateSyncedPrivateReadability({
        objects: [synced(), synced({ name: 'erp_invoice_copy' })],
        sharingRules: [rule('erp_invoice_copy')],
      })[0].where,
    ).toBe('object "erp_order_copy"');
  });

  it('is silent on a model that does not scope reads by owner', () => {
    expect(rulesOf({ objects: [synced({ sharingModel: 'public_read' })] })).toEqual([]);
    expect(rulesOf({ objects: [synced({ sharingModel: 'public_read_write' })] })).toEqual([]);
  });

  it('is silent on a private object that is not synced', () => {
    expect(rulesOf({ objects: [synced({ managedBy: undefined })] })).toEqual([]);
    expect(rulesOf({ objects: [synced({ managedBy: 'config' })] })).toEqual([]);
  });

  // One finding, not two: an unset model on a synced object is already the
  // `security-owd-unset` error, whose fix line is the same two remedies.
  it('leaves an unset sharingModel to security-owd-unset', () => {
    const stack = { objects: [synced({ sharingModel: undefined })] };
    expect(rulesOf(stack)).toEqual([]);
    const owd = validateSecurityPosture(stack).filter((f) => f.rule === SECURITY_OWD_UNSET);
    expect(owd).toHaveLength(1);
    expect(owd[0].hint).toBe(SYNCED_OBJECT_WAY_OUT);
  });

  it('has an os explain entry', () => {
    expect(explainRule(SECURITY_SYNCED_PRIVATE_UNREADABLE)?.rule).toBe(SECURITY_SYNCED_PRIVATE_UNREADABLE);
  });

  // Through the registry, on a stack `defineStack` accepts: the warning is an
  // advisory, never an error, and a read-granting rule clears it.
  it('runs as an advisory on a parsed stack', () => {
    const manifest = { id: 'com.example.sync', name: 'Sync', version: '1.0.0', type: 'app' };
    const bare = defineStack({ manifest, objects: [synced()] } as never) as unknown as Record<string, unknown>;
    const { errors, advisories } = splitBySeverity(runAuthoringRules('validate', { normalized: bare, parsed: bare }));
    expect(errors.filter((f) => f.rule === SECURITY_SYNCED_PRIVATE_UNREADABLE)).toEqual([]);
    expect(advisories.filter((f) => f.rule === SECURITY_SYNCED_PRIVATE_UNREADABLE).map((f) => f.where)).toEqual([
      'object "erp_order_copy"',
    ]);

    const shared = defineStack({
      manifest,
      objects: [synced()],
      sharingRules: [rule('erp_order_copy')],
    } as never) as unknown as Record<string, unknown>;
    const all = runAuthoringRules('validate', { normalized: shared, parsed: shared });
    expect(all.filter((f) => f.rule === SECURITY_SYNCED_PRIVATE_UNREADABLE)).toEqual([]);
  });
});
