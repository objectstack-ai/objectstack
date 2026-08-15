// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8747 — `auditMetaItem` declared `organizationId?: string | null`, never read
// it, and carried a comment describing the org filter it would have built:
//
//   "Org-scoped lookup: include rows for the specific org AND env-wide
//    (organization_id IS NULL) rows so the editor sees both tenant overlays
//    and env-level package writes."
//
// The `where` underneath was exactly `{ type, name }`. Measured consequence: one
// read returned three organizations' rows, disclosing another tenant's `actor`,
// `note` and `lock_state` through a GA endpoint that carries no capability gate.
//
// This file pins the QUERY SHAPE, next to the code that builds it. The
// behavioural half — that the shape actually SELECTS the right rows through a
// real SQL driver, in both directions — is pinned by
// `packages/runtime/src/audit-meta-item-org-scope.integration.test.ts`, which
// needs a real driver this package does not depend on. Neither half is
// sufficient alone: a shape assertion cannot tell a correct filter from one
// that hides everything, and a row assertion cannot tell which spelling
// produced it.
//
// The test names below restate the comment's two claims deliberately. That is
// the "comment now describes behaviour that exists" pin the ruling asks for:
// each claim is an assertion, so the comment cannot drift back into
// over-claiming without a red test.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** A `find` that records its options and returns nothing. */
function makeProtocol() {
    const find = vi.fn(async () => []);
    const engine = { registry: { getObject: () => undefined }, find };
    return { p: new ObjectStackProtocolImplementation(engine as any), find };
}

/** The options the protocol handed to `engine.find` on its first call. */
const whereFrom = (find: any) => find.mock.calls[0][1].where;

const ORG = 'org_alpha';

describe('#8747 auditMetaItem builds the org scope its comment describes', () => {
    it('claim 1 + 2: rows for the specific org AND env-wide (organization_id IS NULL) rows', async () => {
        const { p, find } = makeProtocol();
        await p.auditMetaItem({ type: 'views', name: 'shared_grid', organizationId: ORG });

        const where = whereFrom(find);
        // Both limbs, in one `$or`. The env-wide limb is not optional: the REST
        // `PUT /meta` door writes rows with `organization_id: null`, so an
        // equality-only filter would blank the audit tab on those deployments.
        expect(where.$or).toEqual([
            { organization_id: ORG },
            { organization_id: null },
        ]);
    });

    it('does not ALSO constrain organization_id at the top level (which would AND away the env-wide limb)', async () => {
        const { p, find } = makeProtocol();
        await p.auditMetaItem({ type: 'views', name: 'shared_grid', organizationId: ORG });

        // A top-level `organization_id` alongside the `$or` would re-narrow the
        // query to the equality and silently undo the env-wide half — the exact
        // "looks scoped, hides everything" shape this card warns about.
        expect(whereFrom(find)).not.toHaveProperty('organization_id');
    });

    it('still keys on (type, name), with the plural folded to singular', async () => {
        const { p, find } = makeProtocol();
        await p.auditMetaItem({ type: 'views', name: 'shared_grid', organizationId: ORG });

        const where = whereFrom(find);
        expect(where.type).toBe('view');
        expect(where.name).toBe('shared_grid');
    });

    it('an OMITTED organizationId is fail-closed: env-wide rows only, never unscoped', async () => {
        const { p, find } = makeProtocol();
        // This is the exact call the production route made before the fix.
        await p.auditMetaItem({ type: 'views', name: 'shared_grid' });

        const where = whereFrom(find);
        expect(where.organization_id).toBe(null);
        // The absence of `$or` here is the point: there is no organization to
        // widen to, so the read must not widen at all.
        expect(where).not.toHaveProperty('$or');
    });

    it('an explicit null organizationId reads env-wide, identically to omitting it', async () => {
        const { p, find } = makeProtocol();
        await p.auditMetaItem({ type: 'views', name: 'shared_grid', organizationId: null });

        const where = whereFrom(find);
        expect(where.organization_id).toBe(null);
        expect(where).not.toHaveProperty('$or');
    });

    it('the parameter is READ — no call shape leaves the query without an organization term', async () => {
        // The defect in one assertion: `organizationId` was inert, so every
        // spelling produced the same unscoped `where`. Each spelling must now
        // constrain `organization_id` one way or the other.
        for (const request of [
            { type: 'views', name: 'shared_grid' },
            { type: 'views', name: 'shared_grid', organizationId: null },
            { type: 'views', name: 'shared_grid', organizationId: ORG },
            { type: 'view', name: 'shared_grid', organizationId: ORG, limit: 5 },
        ] as any[]) {
            const { p, find } = makeProtocol();
            await p.auditMetaItem(request);
            const where = whereFrom(find);
            const scoped = where.$or !== undefined || 'organization_id' in where;
            expect(scoped, `unscoped where for ${JSON.stringify(request)}`).toBe(true);
        }
    });
});

describe('#8747 the comment and the code cannot drift apart again', () => {
    it('the method that claims an org-scoped lookup is the method that builds one', () => {
        const source = readFileSync(new URL('./protocol.ts', import.meta.url), 'utf8');
        const start = source.indexOf('async auditMetaItem(');
        expect(start, 'auditMetaItem not found').toBeGreaterThan(-1);
        // Slice to the end of the method — the next sibling member declaration.
        const rest = source.slice(start);
        const end = rest.indexOf('\n    async ', 1);
        const body = end === -1 ? rest : rest.slice(0, end);

        // The comment makes two claims. Both must be backed by code IN THE SAME
        // METHOD. This is what went wrong: the prose survived, the query did
        // not, and nothing failed.
        expect(body).toContain('organization_id IS NULL');
        expect(body).toContain('$or');
        expect(body).toContain('request.organizationId');
    });
});
