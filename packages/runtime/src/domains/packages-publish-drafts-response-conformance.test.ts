// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9406 — route-side conformance: the payload `POST /packages/:id/publish-drafts`
 * actually serves must parse through `PublishPackageDraftsResponseSchema` with
 * NOTHING stripped.
 *
 * The batch door differs from the single-item publish door (#7294) in exactly
 * one structural way: the REST layer does NOT hand the protocol's return to
 * the wire verbatim. `handlePackages` mutates the object before responding —
 * it back-fills `seedApplied` for custom protocols that do not self-apply
 * (#8443) and attaches the ADR-0045 receipts `unhiddenApps` / `unhideError`
 * (#5242/#8516) and the announce receipt `rebindError` (#8516) — and then
 * wraps it in the dispatcher's `{ success, data }` envelope. So the declared
 * schema names the **`data` payload** (the same payload-level convention the
 * ledger records for `DiscoverySchema`), and only a gate that drives the REAL
 * route can certify the route-attached keys. This file is that gate — it is
 * the coverage the ledger's `responseSchema` field is forbidden to be written
 * without (`route-ledger.ts` header), and the reason the
 * `POST /packages/:id/publish-drafts` row may carry
 * `responseSchema: 'PublishPackageDraftsResponseSchema'`.
 *
 * The protocol producer's own half of the face (counts, elements, advisories,
 * in-batch seed/materialize aggregates, opaque `probes`) is pinned against the
 * real `ObjectStackProtocolImplementation` in
 * `packages/objectql/src/publish-package-drafts-response-conformance.test.ts`;
 * here the protocol is a double and the flip loop, the announce, the seed
 * back-fill and the response assembly under test are shipping code — the same
 * split `packages-flip-announce-disclosure.test.ts` (#8516) uses, whose
 * harness this file borrows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublishPackageDraftsResponseSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from '../http-dispatcher.js';

/**
 * [#7033 / #7023] `/packages` demands `manage_metadata` on every
 * state-changing route — without a caller these cases would stop at the 401.
 */
const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/** Keys the wire payload carried that the schema refused to carry through. */
function strippedKeys(raw: Record<string, unknown>): string[] {
    const parsed = PublishPackageDraftsResponseSchema.parse(raw) as Record<string, unknown>;
    return Object.keys(raw).filter((k) => !(k in parsed));
}

/**
 * A protocol double whose `publishPackageDrafts` answers the real producer's
 * happy shape (measured in the objectql conformance suite), plus the app reads
 * and writes the ADR-0045 flip loop makes. Opt-in failure injections reach the
 * three route-attached keys.
 */
function makeDoor(opts: {
    /** The batch result the protocol double answers. */
    result?: Record<string, unknown>;
    /** Omit `getMetaItem` so the route-level seed back-fill reports its no-counter failure shape. */
    failSaveMetaItem?: boolean;
    failTrigger?: boolean;
    apps?: Array<Record<string, unknown>>;
} = {}) {
    const result = opts.result ?? {
        success: true, publishedCount: 1, failedCount: 0,
        published: [{ type: 'flow', name: 'nightly_rollup', version: 'sha256:aa11' }], failed: [],
        probes: { issues: [], checked: { seeds: 0, views: 0, widgets: 0 } },
        commitId: 'cmt_01',
    };
    const publishPackageDrafts = vi.fn().mockImplementation(async () =>
        JSON.parse(JSON.stringify(result)));
    const apps = opts.apps ?? [
        { name: 'crm', label: 'CRM', _unpublished: true },
        { name: 'ops', label: 'Ops', _unpublished: true },
    ];
    const getMetaItems = vi.fn().mockImplementation(async () => ({ items: apps.map((a) => ({ ...a })) }));
    const saveMetaItem = vi.fn().mockImplementation(async () => {
        if (opts.failSaveMetaItem) throw new Error('SQLITE_ERROR: no such table: sys_metadata');
        return { ok: true };
    });
    const trigger = vi.fn().mockImplementation(async () => {
        if (opts.failTrigger) throw new Error('TypeError: internal subscriber crash');
    });
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') {
                // Deliberately NO `getMetaItem`: the route-level seed
                // back-fill demands it and reports "required services
                // unavailable" without counters — the measured union arm that
                // makes the schema's counters optional.
                return Promise.resolve({ publishPackageDrafts, getMetaItems, saveMetaItem });
            }
            if (name === 'objectql') {
                return Promise.resolve({
                    insert: vi.fn(), find: vi.fn(), update: vi.fn(),
                    registry: { getAllPackages: vi.fn().mockReturnValue([]) },
                });
            }
            if (name === 'metadata') return Promise.resolve({ getObject: vi.fn() });
            return null;
        },
        context: { getService: () => null, trigger },
    };
    return { dispatcher: new HttpDispatcher(kernel), publishPackageDrafts, saveMetaItem, trigger };
}

async function publishDrafts(opts: Parameters<typeof makeDoor>[0] = {}) {
    const door = makeDoor(opts);
    const result = await door.dispatcher.handlePackages(
        '/com.workspace/publish-drafts', 'POST', {}, {}, PKG_ADMIN(),
    );
    expect(result.response?.status).toBe(200);
    const body: any = (result.response as any)?.body;
    return { ...door, body, data: body?.data };
}

const spyLogs = () => ({
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
});
afterEach(() => vi.restoreAllMocks());

describe('publish-drafts wire payload conforms to PublishPackageDraftsResponseSchema (#9406)', () => {
    it('the schema names the data payload of the { success, data } envelope, and strips nothing', async () => {
        const { body, data } = await publishDrafts();

        // The envelope is the dispatcher's, not this contract's — the same
        // payload-level convention the ledger records for DiscoverySchema.
        expect(body.success).toBe(true);
        expect(data).toBeDefined();

        expect(strippedKeys(data)).toEqual([]);
        const parsed = PublishPackageDraftsResponseSchema.parse(data);
        expect(parsed.success).toBe(true);
        expect(parsed.published[0]!.version).toBe('sha256:aa11');
        // The route-attached ADR-0045 receipt is ON the wire and declared.
        expect(parsed.unhiddenApps).toEqual(['crm', 'ops']);
        // Opaque probes crossed the route untouched.
        expect(parsed.probes).toEqual({ issues: [], checked: { seeds: 0, views: 0, widgets: 0 } });
        expect(parsed.commitId).toBe('cmt_01');
    });

    it('a mid-flip failure serves the #5242 split report, and it conforms', async () => {
        spyLogs();
        const { data } = await publishDrafts({ failSaveMetaItem: true });

        expect(strippedKeys(data)).toEqual([]);
        const parsed = PublishPackageDraftsResponseSchema.parse(data);
        expect(parsed.unhideError).toBe('visibility flip failed');
        expect(parsed.unhiddenApps).toBeUndefined();
    });

    it('an announce failure serves rebindError, and it conforms', async () => {
        spyLogs();
        const { data } = await publishDrafts({ failTrigger: true });

        expect(strippedKeys(data)).toEqual([]);
        const parsed = PublishPackageDraftsResponseSchema.parse(data);
        expect(parsed.rebindError).toBe('metadata:reloaded announce failed');
        expect(parsed.unhiddenApps).toEqual(['crm', 'ops']);
    });

    it('the route-level seed back-fill\'s no-counter failure shape conforms — the measured union arm', async () => {
        spyLogs();
        const { data } = await publishDrafts({
            result: {
                success: true, publishedCount: 1, failedCount: 0,
                published: [{ type: 'seed', name: 'demo_rows', version: 'sha256:bb22' }], failed: [],
                // NO seedApplied: a custom protocol that does not self-apply.
                // The door back-fills it via `applyPublishedSeeds`, which — the
                // double having no `getMetaItem` — answers its early-failure
                // shape without counters. This is the producer arm that makes
                // `seedApplied.inserted`/`updated` optional in the schema.
            },
            apps: [],
        });

        expect(strippedKeys(data)).toEqual([]);
        const parsed = PublishPackageDraftsResponseSchema.parse(data);
        expect(parsed.seedApplied?.success).toBe(false);
        expect(typeof parsed.seedApplied?.error).toBe('string');
        expect(parsed.seedApplied?.inserted).toBeUndefined();
        expect(parsed.seedApplied?.updated).toBeUndefined();
    });

    it('byte-stability across the route: nothing on the serving path parses this schema, so declaring it moved no bytes', async () => {
        const { data } = await publishDrafts({ apps: [] });

        // An advisory-free, flip-free publish: the wire carries none of the
        // conditional keys, and the declared parse fabricates none of them —
        // the schema has no `.default()`, which is what "the declaration must
        // not change wire bytes" cashes out to on the consumer side.
        const wire = JSON.stringify(data);
        for (const key of ['advisories', 'unhiddenApps', 'unhideError', 'rebindError', 'seedApplied']) {
            expect(wire).not.toContain(key);
        }
        const parsed = PublishPackageDraftsResponseSchema.parse(data) as Record<string, unknown>;
        // Key SETS, not serialized equality: zod rebuilds objects in shape
        // order, so key order is not part of the claim — presence is.
        expect(Object.keys(parsed).sort()).toEqual(Object.keys(data).sort());
        expect(parsed).toEqual(data);
    });
});
