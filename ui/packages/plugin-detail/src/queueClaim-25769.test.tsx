/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Claim affordance on a record sitting in a queue (objectstack ADR-0142
 * D3/D4). The server is the only judge, so what is pinned here is that the
 * client asks it and reports its answer, never that it decides:
 *
 *  - the render condition: a record SITS in a queue only with no owner and a
 *    named queue; only then is the server asked;
 *  - the request: `POST /api/v1/security/explain` with `operation: 'transfer'`
 *    for THIS record, and the button only on a `queue_claim` rule that
 *    `admits` — any other answer, a refusal, or no answer leaves no button;
 *  - the write: `{ owner_id: <self> }` and nothing else, with a lost race's
 *    `409 CONCURRENT_UPDATE` reported as "taken", not as a generic failure.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import {
  recordSitsInQueue,
  queueClaimAdmitted,
  useQueueClaimOffered,
  claimQueuedRecord,
} from './queueClaim';

function me(userId: string): MePermissionsResponse {
  return {
    authenticated: true,
    userId,
    tenantId: 't1',
    roles: [],
    permissionSets: [],
    objects: { ticket: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    fields: {},
  };
}

function signedInAs(userId: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MePermissionsProvider initialPermissions={me(userId)}>{children}</MePermissionsProvider>
  );
}

/** An explain decision whose sharing layer reports the claim attribution. */
function decision(effect: 'admits' | 'neutral') {
  return {
    allowed: true,
    layers: [
      { layer: 'object', record: { rules: [] } },
      { layer: 'sharing', record: { rules: [{ kind: 'queue_claim', effect, queue: 'support_intake' }] } },
    ],
  };
}

function explainAnswering(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as any;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recordSitsInQueue — is there anything to ask about? (ADR-0142 D3)', () => {
  it('names the queue of an unowned record with a queue', () => {
    expect(recordSitsInQueue({ owner_id: null, queue: 'support_intake' })).toBe('support_intake');
    expect(recordSitsInQueue({ owner_id: '', queue: 'support_intake' })).toBe('support_intake');
    expect(recordSitsInQueue({ queue: 'support_intake' })).toBe('support_intake');
  });

  it('answers null for an owned record (its queue is only its home), and for no queue', () => {
    expect(recordSitsInQueue({ owner_id: 'u_1', queue: 'support_intake' })).toBeNull();
    expect(recordSitsInQueue({ owner_id: null, queue: null })).toBeNull();
    expect(recordSitsInQueue({ owner_id: null, queue: '' })).toBeNull();
    expect(recordSitsInQueue(null)).toBeNull();
  });
});

describe('queueClaimAdmitted — reads the server’s claim attribution, nothing else', () => {
  it('is true only on a queue_claim rule that admits', () => {
    expect(queueClaimAdmitted(decision('admits'))).toBe(true);
    expect(queueClaimAdmitted(decision('neutral'))).toBe(false);
  });

  it('does not read a visible transfer or a membership rule as a claim admission', () => {
    expect(queueClaimAdmitted({ allowed: true, record: { recordId: 'r1', visible: true } })).toBe(false);
    expect(queueClaimAdmitted({
      layers: [{ record: { rules: [{ kind: 'queue_membership', effect: 'admits' }] } }],
    })).toBe(false);
  });

  it('is false on a malformed answer', () => {
    expect(queueClaimAdmitted(null)).toBe(false);
    expect(queueClaimAdmitted({ layers: 'x' })).toBe(false);
    expect(queueClaimAdmitted({ layers: [null, { record: null }] })).toBe(false);
  });
});

describe('useQueueClaimOffered — the button renders only where the server admits the claim', () => {
  it('asks the explain engine about a transfer of THIS record, and offers on admits', async () => {
    const fetchSpy = explainAnswering(decision('admits'));
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useQueueClaimOffered('ticket', 'r1', true), { wrapper: signedInAs('u_me') });

    await waitFor(() => expect(result.current).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/v1/security/explain');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ object: 'ticket', operation: 'transfer', recordId: 'r1' });
  });

  it('offers nothing when the server does not admit the claim', async () => {
    const fetchSpy = explainAnswering(decision('neutral'));
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useQueueClaimOffered('ticket', 'r1', true), { wrapper: signedInAs('u_me') });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);
  });

  it('fails closed: a refused or failed probe leaves no button', async () => {
    const refused = explainAnswering(decision('admits'), false);
    vi.stubGlobal('fetch', refused);
    const a = renderHook(() => useQueueClaimOffered('ticket', 'r1', true), { wrapper: signedInAs('u_me') });
    await waitFor(() => expect(refused).toHaveBeenCalledTimes(1));
    expect(a.result.current).toBe(false);

    const broken = vi.fn(async () => { throw new Error('network'); }) as any;
    vi.stubGlobal('fetch', broken);
    const b = renderHook(() => useQueueClaimOffered('ticket', 'r2', true), { wrapper: signedInAs('u_me') });
    await waitFor(() => expect(broken).toHaveBeenCalledTimes(1));
    expect(b.result.current).toBe(false);
  });

  it('asks nothing for a record that sits in no queue, or with no known user', async () => {
    const fetchSpy = explainAnswering(decision('admits'));
    vi.stubGlobal('fetch', fetchSpy);
    const notSitting = renderHook(() => useQueueClaimOffered('ticket', 'r1', false), { wrapper: signedInAs('u_me') });
    const anonymous = renderHook(() => useQueueClaimOffered('ticket', 'r1', true));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(notSitting.result.current).toBe(false);
    expect(anonymous.result.current).toBe(false);
  });
});

describe('claimQueuedRecord — one write, the server’s answer reported as given (ADR-0142 D4)', () => {
  it('sends { owner_id: <self> } and nothing else through update', async () => {
    const writer = { update: vi.fn(async () => ({})) };
    await expect(claimQueuedRecord(writer, 'ticket', 'r1', 'u_me')).resolves.toEqual({ outcome: 'claimed' });
    expect(writer.update).toHaveBeenCalledWith('ticket', 'r1', { owner_id: 'u_me' });
  });

  it('reports a lost race (409 CONCURRENT_UPDATE) as taken', async () => {
    const lost = Object.assign(
      new Error('The record was taken: another user changed it first. Reload it to see who has it now.'),
      { name: 'ConcurrentUpdateError', code: 'CONCURRENT_UPDATE' },
    );
    const writer = { update: vi.fn(async () => { throw lost; }) };
    await expect(claimQueuedRecord(writer, 'ticket', 'r1', 'u_me')).resolves.toEqual({ outcome: 'taken' });
  });

  it('carries any other refusal through as refused, with its error', async () => {
    const denied = Object.assign(new Error('Forbidden'), { status: 403 });
    const writer = { update: vi.fn(async () => { throw denied; }) };
    await expect(claimQueuedRecord(writer, 'ticket', 'r1', 'u_me')).resolves.toEqual({ outcome: 'refused', error: denied });
  });
});
