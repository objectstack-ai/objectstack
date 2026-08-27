// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7019] The dispatcher's `/meta` PUT demands the `manage_metadata` authoring
 * capability (ADR-0066 D1) — the SECOND TRANSPORT for the operation #6603
 * gated on the REST side.
 *
 * ## Why a second file for "the same" gate
 *
 * #6603 gated `PUT /api/v1/meta/:type/:name` in `packages/rest`. This is a
 * different door into the same `protocol.saveMetaItem`: the runtime
 * dispatcher's own `/meta` branch, which serves the cloud runtime. Until this
 * gate, closing the REST one moved the hole rather than shutting it — a caller
 * refused there was accepted here, for every metadata type.
 *
 * ## The two independent reasons, both pinned below
 *
 *  1. **The ADR-0106 read/write asymmetry.** This dispatcher masks object
 *     schemas on the way OUT (`resolveObjectSchemaMaskPosture` /
 *     `applyObjectSchemaMask` in `meta.ts`) — a caller is served a schema with
 *     the fields they may not read removed WHOLE. Sending that document back
 *     used to persist it verbatim, deleting exactly the fields the caller was
 *     never allowed to see, with nothing in the exchange saying so.
 *  2. **The older, mask-independent hole:** any authenticated session could
 *     clobber any metadata item through this transport.
 *
 * ## What the refusal cases assert
 *
 * `status` AND `code` (the ADR-0112 envelope), plus — the point — that
 * `saveMetaItem` was **never entered**. A gate that refuses *after* the write
 * has landed would still be the bug and would still pass a status-only
 * assertion, so the spy is the load-bearing assertion here, not decoration.
 *
 * Note the code differs from the REST twin's `FORBIDDEN` on purpose: this
 * transport builds its body through `deps.error(msg, 403)`, whose code is
 * derived from the status by `standardErrorCodeForHttpStatus` — the same
 * `PERMISSION_DENIED` the `_migrate-stored` gate next door in `meta.ts`
 * answers. Copying that file's own precedent is deliberate; unifying the two
 * spellings would be a contract change, and is not this card's business.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

/** An object schema carrying a field a restricted caller would never be served. */
const STORED_SCHEMA = {
    name: 'account',
    label: 'Account',
    fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        salary_grade: { type: 'text' },
    },
};

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * A dispatcher over a protocol backed by a REAL in-memory store, so a refused
 * write can be checked against the STORE rather than only against the answer.
 */
function boot() {
    const stored: Record<string, any> = { account: copy(STORED_SCHEMA) };

    const saveMetaItem = vi.fn(async ({ name, item }: any) => {
        stored[name] = copy(item);
        return { success: true, name };
    });

    const protocol = { saveMetaItem };
    const kernel = {
        context: { getService: (n: string) => (n === 'protocol' ? protocol : null) },
    } as any;

    return {
        dispatcher: new HttpDispatcher(kernel),
        saveMetaItem,
        /** Field names currently in the STORE — not in any response. */
        storedFields: () => Object.keys(stored.account.fields ?? {}).sort(),
        storedLabel: () => stored.account.label,
    };
}

const ctx = (executionContext: any): any => ({
    request: {}, environmentId: 'platform', executionContext,
});

const ALL_FIELDS = ['id', 'name', 'salary_grade'];

describe('#7019 — dispatcher PUT /meta/:type/:name: the capability gate', () => {
    it('refuses a caller holding no capabilities, and NOTHING is written', async () => {
        const stack = boot();

        const res = await stack.dispatcher.handleMetadata(
            '/object/account',
            ctx({ userId: 'u_portal', systemPermissions: [] }),
            'PUT',
            { name: 'account', label: 'clobbered', fields: { id: { type: 'text' } } },
        );

        // The envelope, not just "it failed" — ADR-0112 wants both halves.
        expect(res.response?.status).toBe(403);
        expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');

        // THE POINT: the write never happened. A 403 issued after the store was
        // already overwritten would satisfy the two assertions above.
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
        expect(stack.storedFields()).toEqual(ALL_FIELDS);
        expect(stack.storedLabel()).toBe('Account');
    });

    it('[#12195] refuses the ENCODED spelling too — one name, one gate', async () => {
        // This drove `/lead/views/all_leads`, the compound arity that folded
        // the trailing segments into `views/all_leads`. That arity is retired
        // (#12176 stage 3); the same name is addressed percent-encoded, which
        // keeps the path at two segments and reaches the same `saveMetaItem`.
        //
        // The point of the case is unchanged: ONE gate covers every name shape.
        // A gate that only covered names without a slash would be no gate at
        // all for a pre-grammar residue row.
        const stack = boot();

        const res = await stack.dispatcher.handleMetadata(
            '/lead/views%2Fall_leads',
            ctx({ userId: 'u_portal', systemPermissions: [] }),
            'PUT',
            { density: 'compact' },
        );

        expect(res.response?.status).toBe(403);
        expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
    });

    it('fires BEFORE the protocol is resolved, so 403-vs-501 leaks no kernel capability', async () => {
        // A kernel with NO protocol service at all: an authorized caller would
        // get the 501 "Save not supported" fallback here. An unauthorized one
        // must not be able to tell the two kernels apart.
        const kernel = { context: { getService: () => null } } as any;

        const res = await new HttpDispatcher(kernel).handleMetadata(
            '/object/account',
            ctx({ userId: 'u_portal', systemPermissions: [] }),
            'PUT',
            { label: 'x' },
        );

        expect(res.response?.status).toBe(403);
        expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
    });

    it('holding an unrelated capability is not enough', async () => {
        const stack = boot();

        const res = await stack.dispatcher.handleMetadata(
            '/object/account',
            ctx({ userId: 'u_admin', systemPermissions: ['setup.access', 'studio.access'] }),
            'PUT',
            { label: 'x' },
        );

        expect(res.response?.status).toBe(403);
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
    });

    it('allows a caller holding `manage_metadata`', async () => {
        const stack = boot();

        const res = await stack.dispatcher.handleMetadata(
            '/object/account',
            ctx({ userId: 'u_author', systemPermissions: ['manage_metadata'] }),
            'PUT',
            { name: 'account', label: 'Account (renamed)', fields: copy(STORED_SCHEMA.fields) },
        );

        expect(res.response?.status).toBe(200);
        expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
        expect(stack.storedLabel()).toBe('Account (renamed)');
    });

    it('engine self-invocation (`isSystem`) bypasses, matching every other capability gate', async () => {
        const stack = boot();

        const res = await stack.dispatcher.handleMetadata(
            '/object/account',
            ctx({ isSystem: true }),
            'PUT',
            { name: 'account', label: 'Account', fields: copy(STORED_SCHEMA.fields) },
        );

        expect(res.response?.status).toBe(200);
        expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
    });

    it('an anonymous caller never reaches this gate — 401 from the domain gate', async () => {
        // The anonymous-deny gate (#3963) runs first, so this gate is the second
        // layer rather than the only one.
        const stack = boot();

        const res = await stack.dispatcher.handleMetadata('/object/account', ctx({}), 'PUT', { label: 'x' });

        expect(res.response?.status).toBe(401);
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
    });

    it('the MetadataService fallback is gated too — the refusal precedes both writers', async () => {
        // When the protocol has no `saveMetaItem` the handler falls back to
        // `metadata.saveItem`. That is a second writer behind the same door, so
        // the gate must sit in front of the branch, not inside one arm of it.
        const saveItem = vi.fn().mockResolvedValue({ success: true });
        const kernel = {
            context: {
                getService: (n: string) => (n === 'metadata' ? { saveItem } : n === 'protocol' ? {} : null),
            },
        } as any;

        const res = await new HttpDispatcher(kernel).handleMetadata(
            '/object/account',
            ctx({ userId: 'u_portal', systemPermissions: [] }),
            'PUT',
            { label: 'x' },
        );

        expect(res.response?.status).toBe(403);
        expect(saveItem).not.toHaveBeenCalled();
    });

    it('holding `manage_org_presentation` alone is not enough for an OBJECT save — tier-B stays walled', async () => {
        // The org-scoped presentation capability (#12702) reaches ONLY types
        // whose registry entry declares `allowOrgOverride: true`; `object`
        // does not, so this caller is exactly as refused as a capability-less
        // one — full matrix in the #12702 describe below.
        const stack = boot();

        const res = await stack.dispatcher.handleMetadata(
            '/object/account',
            ctx({ userId: 'u_orgadmin', systemPermissions: ['manage_org_presentation'] }),
            'PUT',
            { label: 'clobbered' },
        );

        expect(res.response?.status).toBe(403);
        expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
        expect(stack.storedLabel()).toBe('Account');
    });

    it('leaves the READ path alone — a capability-less caller can still GET', async () => {
        // This card gates WRITES. The read side has its own posture (ADR-0106
        // masking); turning this into a blanket `/meta` gate would be a
        // different, unruled change.
        const getMetaItem = vi.fn().mockResolvedValue({ type: 'object', name: 'account', item: copy(STORED_SCHEMA) });
        const kernel = {
            context: { getService: (n: string) => (n === 'protocol' ? { getMetaItem } : null) },
        } as any;

        const res = await new HttpDispatcher(kernel).handleMetadata(
            '/object/account',
            ctx({ userId: 'u_portal', systemPermissions: [] }),
            'GET',
        );

        expect(res.response?.status).not.toBe(403);
    });
});

/**
 * [#12702] `manage_org_presentation` — the org-scoped presentation capability
 * on THIS transport. A subset key beside `manage_metadata`: admitted ONLY for
 * a type whose registry entry declares `allowOrgOverride: true` AND a session
 * with an active organization, and the admitted write is threaded to exactly
 * that organization — the same single resolution feeding authorization and
 * scope. Both directions pinned: the tier-A admission (with the threaded
 * organization asserted, not assumed) and the tier-B / env-wide refusals.
 */
describe('#12702 — dispatcher PUT: `manage_org_presentation`, org-scoped tier-A admission', () => {
    /**
     * The `boot()` double above, plus an auth service whose session carries an
     * active organization — the value `deps.resolveActiveOrganizationId` reads,
     * which the gate and the write threading now share.
     */
    function bootOrg(activeOrganizationId?: string) {
        const saveMetaItem = vi.fn(async ({ type, name }: any) => ({ success: true, type, name }));
        const protocol = { saveMetaItem };
        const auth = activeOrganizationId === undefined ? null : {
            api: { getSession: async () => ({ session: { activeOrganizationId } }) },
        };
        const kernel = {
            context: {
                getService: (n: string) => (n === 'protocol' ? protocol : n === 'auth' ? auth : null),
            },
        } as any;
        return { dispatcher: new HttpDispatcher(kernel), saveMetaItem };
    }

    const HOLDER = { userId: 'u_orgadmin', systemPermissions: ['manage_org_presentation'] };

    it('admits an org-scoped tier-A save, threaded to the caller\'s OWN organization', async () => {
        const stack = bootOrg('org_a');

        const res = await stack.dispatcher.handleMetadata(
            '/view/org_grid', ctx(HOLDER), 'PUT', { name: 'org_grid', label: 'Org Grid' },
        );

        expect(res.response?.status).toBe(200);
        expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
        // The threading IS the wall: the only organization an admitted write
        // can carry is the caller's own active one.
        expect(stack.saveMetaItem.mock.calls[0][0]).toMatchObject({
            type: 'view', name: 'org_grid', organizationId: 'org_a',
        });
    });

    it('[#10340] the URL-only spelling is folded BEFORE the verdict — `email_templates` is tier-A here too', async () => {
        const stack = bootOrg('org_a');

        const res = await stack.dispatcher.handleMetadata(
            '/email_templates/welcome', ctx(HOLDER), 'PUT', { name: 'welcome', subject: 'Hi' },
        );

        expect(res.response?.status).toBe(200);
        // The request type stays the RAW segment (the protocol folds it
        // itself); only the verdict and the scope argument read the fold.
        expect(stack.saveMetaItem.mock.calls[0][0]).toMatchObject({
            type: 'email_templates', name: 'welcome', organizationId: 'org_a',
        });
    });

    it.each([
        ['object', '/object/account'],
        ['flow', '/flow/order_followup'],
    ])('refuses the SAME holder a tier-B `%s` write — org active or not, nothing is written', async (_t, path) => {
        const stack = bootOrg('org_a');

        const res = await stack.dispatcher.handleMetadata(
            path, ctx(HOLDER), 'PUT', { label: 'x' },
        );

        expect(res.response?.status).toBe(403);
        expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
    });

    it('refuses the SAME holder a tier-A write when the session has NO active organization — env-wide is walled', async () => {
        const stack = bootOrg(undefined);

        const res = await stack.dispatcher.handleMetadata(
            '/view/org_grid', ctx(HOLDER), 'PUT', { name: 'org_grid', label: 'Org Grid' },
        );

        expect(res.response?.status).toBe(403);
        expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        // The message names the sanctioned path and the scope fact — never the
        // caller's own grants (#7450).
        expect(String(res.response?.body?.error?.message ?? '')).toContain('active organization');
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
    });

    it('a foreign organization is not expressible: a body-smuggled organization_id does not move the threading', async () => {
        const stack = bootOrg('org_a');

        const res = await stack.dispatcher.handleMetadata(
            '/view/org_grid', ctx(HOLDER), 'PUT',
            { name: 'org_grid', label: 'Org Grid', organization_id: 'org_b', organizationId: 'org_b' },
        );

        expect(res.response?.status).toBe(200);
        // `item` is data, never a channel (the request is built field by
        // field): the write still carries the CALLER's organization.
        expect(stack.saveMetaItem.mock.calls[0][0]).toMatchObject({ organizationId: 'org_a' });
    });

    it('control: `manage_metadata` with no active organization still saves a view env-wide, as today', async () => {
        const stack = bootOrg(undefined);

        const res = await stack.dispatcher.handleMetadata(
            '/view/org_grid',
            ctx({ userId: 'u_author', systemPermissions: ['manage_metadata'] }),
            'PUT',
            { name: 'org_grid', label: 'Org Grid' },
        );

        expect(res.response?.status).toBe(200);
        expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
        expect(stack.saveMetaItem.mock.calls[0][0].organizationId).toBeUndefined();
    });
});
