// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12982 — the helpers behind Setup's declared sharing rules
 * (`sharing-rule-catalog.ts`): the declaration-only catalog table, the clone's
 * suggested name, the record a clone writes, and the one-rule projection read.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  cloneRecordOf,
  declarationOnlyAuthoredObject,
  readSharingRuleProjection,
  suggestCloneName,
} from './sharing-rule-catalog';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('declarationOnlyAuthoredObject', () => {
  it('names the object an environment authors sharing rules as, and nothing for another type', () => {
    expect(declarationOnlyAuthoredObject('sharing_rule')).toBe('sys_sharing_rule');
    expect(declarationOnlyAuthoredObject('permission')).toBeUndefined();
  });
});

describe('suggestCloneName', () => {
  it('never offers a declared name', () => {
    expect(suggestCloneName('a_rule', ['a_rule'])).toBe('a_rule_copy');
    expect(suggestCloneName('a_rule', ['a_rule', 'a_rule_copy', 'a_rule_copy_2'])).toBe('a_rule_copy_3');
  });
});

describe('cloneRecordOf', () => {
  const declaration = {
    name: 'share_x',
    description: 'Notes',
    object: 'obj_from_declaration',
    accessLevel: 'read',
    sharedWith: { type: 'team', value: 'team_a' },
  };

  it("takes the runtime half from the server's projection, never compiling the CEL", () => {
    const record = cloneRecordOf(
      declaration,
      {
        name: 'share_x',
        object_name: 'showcase_contact',
        criteria: { status: 'new' },
        recipient_type: 'position',
        recipient_id: 'manager',
        access_level: 'edit',
      },
      { name: 'share_x_copy', label: 'Copy' },
    );
    expect(record).toEqual({
      name: 'share_x_copy',
      label: 'Copy',
      description: 'Notes',
      object_name: 'showcase_contact',
      criteria_json: '{"status":"new"}',
      recipient_type: 'position',
      recipient_id: 'manager',
      access_level: 'edit',
    });
  });

  it('without a projection: the declaration fills what it can, and no criteria are invented', () => {
    const record = cloneRecordOf(declaration, null, { name: 'share_x_copy', label: 'Copy' });
    expect(record).not.toHaveProperty('criteria_json');
    expect(record).toMatchObject({
      object_name: 'obj_from_declaration',
      recipient_type: 'team',
      recipient_id: 'team_a',
      access_level: 'read',
    });
  });
});

describe('readSharingRuleProjection', () => {
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
    );

  it('reads one rule by name', async () => {
    answer(200, { name: 'share_x', object_name: 'o', criteria: { a: 1 } });
    await expect(readSharingRuleProjection('share_x')).resolves.toMatchObject({ criteria: { a: 1 } });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v1/sharing/rules/share_x');
  });

  it('answers null for the 404 the service gives a switched-off rule', async () => {
    answer(404, { code: 'RULE_NOT_FOUND' });
    await expect(readSharingRuleProjection('share_x')).resolves.toBeNull();
  });

  it("rejects any other refusal with the server's sentence", async () => {
    answer(403, { code: 'PERMISSION_DENIED', error: 'Managing sharing rules requires an administrator.' });
    await expect(readSharingRuleProjection('share_x')).rejects.toThrow(/requires an administrator/);
  });
});
