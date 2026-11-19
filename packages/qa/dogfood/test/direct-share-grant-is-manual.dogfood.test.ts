// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0111 D7] A share a non-system caller grants is always a MANUAL share,
// pinned at the direct-grant door of the booted showcase:
// `POST /api/v1/data/:object/:id/shares`.
//
// The door forwards the caller's `source` / `sourceId` to `SharingService.grant`,
// and the service refuses, on its non-system path, an input whose `source` is
// present and is not `'manual'` and an input that carries any `sourceId`: 400
// `VALIDATION_FAILED`, nothing written. The service-level pins (every refused
// shape, nothing read, the system-path controls) live beside the service in
// `plugin-sharing/src/sharing-service.test.ts`; this file holds the composed
// door — the real REST route, the real service, the real engine — because only
// the booted runtime has all three.
//
// Controls: no source and an explicit 'manual' are granted (and the manual
// share revokes); the system context still writes a rule share with its
// sourceId, and that share's revoke through the door is still CONFLICT. The
// generic data door on `sys_record_share` itself is pinned as refused too.

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import type { ISharingService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { getSharedShowcase } from './shared-showcase.js';

const OBJECT = 'showcase_private_note';
const SYS = { isSystem: true } as const;
const idOf = (b: any) => b?.id ?? b?.record?.id;

describe('[ADR-0111 D7] a share granted directly by a non-system caller is always a manual share', () => {
  let stack: VerifyStack;
  let ql: any;
  let sharing: ISharingService;
  let ownerToken: string;
  let recipientId: string;
  let organizationId: string | undefined;

  const sharesOn = async (recordId: string) =>
    ql.find('sys_record_share', { where: { object_name: OBJECT, record_id: recordId }, context: SYS });

  const newNote = async (title: string): Promise<string> => {
    const res = await stack.apiAs(ownerToken, 'POST', `/data/${OBJECT}`, { title });
    expect(res.status, await res.clone().text()).toBe(201);
    return String(idOf(await res.json()));
  };

  const grant = (recordId: string, extra: Record<string, unknown>) =>
    stack.apiAs(ownerToken, 'POST', `/data/${OBJECT}/${recordId}/shares`, {
      recipientId, accessLevel: 'read', ...extra,
    });

  beforeAll(async () => {
    stack = await getSharedShowcase();
    ql = await stack.kernel.getServiceAsync('objectql');
    sharing = stack.kernel.getService<ISharingService>('sharing');
    ownerToken = await stack.signUp('dsm-owner@verify.test');
    await stack.signUp('dsm-recipient@verify.test');
    const user = await ql.findOne('sys_user', { where: { email: 'dsm-recipient@verify.test' }, context: SYS });
    recipientId = String(user?.id);
  }, 120_000);

  const refused: Array<[string, Record<string, unknown>]> = [
    ["source 'rule' with a sourceId", { source: 'rule', sourceId: 'srule_dsm' }],
    ["source 'team'", { source: 'team' }],
    ['an unknown source string', { source: 'bogus' }],
    ['a sourceId with no source', { sourceId: 'srule_dsm' }],
    ['a snake_case source_id with no source', { source_id: 'srule_dsm' }],
    ["a sourceId with source 'manual'", { source: 'manual', sourceId: 'srule_dsm' }],
  ];

  for (const [label, extra] of refused) {
    it(`refuses ${label}: 400 VALIDATION_FAILED, no share written`, async () => {
      const recordId = await newNote(`dsm refused ${label}`);
      const res = await grant(recordId, extra);
      const body = await res.json() as { error?: { code?: string } };
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(body.error?.code).toBe('VALIDATION_FAILED');
      expect(await sharesOn(recordId)).toHaveLength(0);
    });
  }

  it('CONTROL: no source is granted as a manual share, and the owner revokes it', async () => {
    const recordId = await newNote('dsm control no source');
    const res = await grant(recordId, {});
    expect(res.status, await res.clone().text()).toBe(201);
    const share = await res.json() as { id: string; source: string };
    expect(share.source).toBe('manual');
    const rows = await sharesOn(recordId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'manual', recipient_id: recipientId });
    organizationId = rows[0].organization_id ?? undefined;

    const revoke = await stack.apiAs(ownerToken, 'DELETE', `/data/${OBJECT}/${recordId}/shares/${share.id}`);
    expect(revoke.status, await revoke.clone().text()).toBe(204);
    expect(await sharesOn(recordId)).toHaveLength(0);
  });

  it("CONTROL: an explicit 'manual' source is granted as a manual share", async () => {
    const recordId = await newNote('dsm control manual');
    const res = await grant(recordId, { source: 'manual' });
    expect(res.status, await res.clone().text()).toBe(201);
    const rows = await sharesOn(recordId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'manual', source_id: null });
  });

  it('CONTROL: the system context still writes a rule share, and its revoke through the door is still CONFLICT', async () => {
    const recordId = await newNote('dsm control system rule share');
    const share = await sharing.grant(
      { object: OBJECT, recordId, recipientId, accessLevel: 'read', source: 'rule', sourceId: 'srule_dsm' },
      { ...SYS, ...(organizationId ? { tenantId: organizationId } : {}) } as ExecutionContext,
    );
    const rows = await sharesOn(recordId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'rule', source_id: 'srule_dsm' });

    const revoke = await stack.apiAs(ownerToken, 'DELETE', `/data/${OBJECT}/${recordId}/shares/${share.id}`);
    const body = await revoke.json() as { error?: { code?: string } };
    expect(revoke.status, JSON.stringify(body)).toBe(409);
    expect(body.error?.code).toBe('CONFLICT');
    expect(await sharesOn(recordId)).toHaveLength(1);
  });

  it('the generic data door on sys_record_share refuses the caller\'s create and writes no share row', async () => {
    const recordId = await newNote('dsm generic door');
    const res = await stack.apiAs(ownerToken, 'POST', '/data/sys_record_share', {
      object_name: OBJECT, record_id: recordId, recipient_type: 'user', recipient_id: recipientId,
      access_level: 'read', source: 'rule', source_id: 'srule_dsm',
    });
    const text = await res.text();
    // `enable.apiMethods` on `sys_record_share` grants no create (ADR-0103).
    expect(res.status, text).toBe(405);
    expect(text).toContain('OBJECT_API_METHOD_NOT_ALLOWED');
    expect(await sharesOn(recordId)).toHaveLength(0);
  });
});
