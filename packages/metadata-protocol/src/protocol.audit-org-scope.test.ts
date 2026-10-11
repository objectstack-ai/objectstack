// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8747 — `auditMetaItem` once declared an organization, never read it, and
// returned every organization's rows. The scope is BUILT in the method,
// unconditionally: nothing below it scopes the read.
//
// [ADR-0131 D6] The read is the environment's, for every caller: the
// `organizationId` request key retired with the per-organization overlay axis,
// so the scope is `organization_id IS NULL` and nothing else. A legacy
// organization-scoped audit row is reported at boot, never read.
//
// This file pins the QUERY SHAPE, next to the code that builds it. The
// behavioural half — that the shape SELECTS the right rows through a real SQL
// driver — is pinned by
// `packages/runtime/src/audit-meta-item-org-scope.integration.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** A `find` that records its options and returns nothing. */
function makeProtocol() {
    const find = vi.fn(async () => []);
    const engine = { registry: { getObject: () => undefined }, find };
    return { p: new ObjectStackProtocolImplementation(engine as any), find };
}

/** The options the protocol handed to `engine.find` on its first call. */
const whereFrom = (find: any) => find.mock.calls[0][1].where;

describe('#8747 · ADR-0131 D6 auditMetaItem reads the environment\'s audit trail only', () => {
    it('keys on (type, name), the plural folded to singular, and scopes organization_id IS NULL', async () => {
        const { p, find } = makeProtocol();
        await p.auditMetaItem({ type: 'views', name: 'shared_grid' });

        expect(whereFrom(find)).toEqual({ type: 'view', name: 'shared_grid', organization_id: null });
    });

    it('a caller still naming an organization changes nothing: the retired key is not read', async () => {
        for (const organizationId of ['org_alpha', null]) {
            const { p, find } = makeProtocol();
            await p.auditMetaItem({ type: 'views', name: 'shared_grid', organizationId } as any);
            const where = whereFrom(find);
            expect(where.organization_id, String(organizationId)).toBe(null);
            expect(where, String(organizationId)).not.toHaveProperty('$or');
        }
    });
});
