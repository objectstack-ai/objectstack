// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23120, ADR-0010 §3.5] The ADR-0045 visibility flip of
 * `POST /packages/:id/publish-drafts` re-saves each `_unpublished` app of the
 * package through `saveMetaItem`, and the body it re-saves is composed by the
 * server from the stored row the app read returned. That body drops the
 * `protection` block before it reaches the save door.
 *
 * The save door refuses a `protection` block on an environment-authored write
 * with `400 VALIDATION_ERROR`, and the flip states no `source`, so it is one.
 * A row stored before that refusal can still carry a block, and the flip used
 * to copy it through: the save was refused, the app stayed `_unpublished`, and
 * the publish answered 200 with the refusal under `unhideError` — a message the
 * publisher cannot act on. The block binds nothing (only the package loader
 * translates it into a lock, through `applyProtection`), so dropping it
 * changes no verdict.
 *
 * Pinned at the flip itself: the protocol is a double whose `getMetaItems`
 * answers the stored rows and whose `saveMetaItem` records the body it is
 * handed. The save door's own refusal is pinned where it lives
 * (`metadata-protocol`'s `protocol.save-door-protection.test.ts`). The
 * `protection` key is spelled here, so removing the drop turns this red.
 */

import { describe, expect, it, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PACKAGE_ID = 'com.workspace';

/** The block a row stored before the save door's refusal still carries. */
const LEGACY_BLOCK = { lock: 'full', reason: 'Stored before the metadata save door refused this block.' };

const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/**
 * The publish-drafts door over a protocol double holding `apps` as stored
 * rows. `seedApplied` is answered so the route's own seed fallback stays out
 * of the way: this file reads the flip and nothing else.
 */
function makeDoor(apps: Array<Record<string, unknown>>) {
    const publishPackageDrafts = vi.fn().mockResolvedValue({
        success: true, publishedCount: 0, failedCount: 0, published: [], failed: [],
        seedApplied: { success: true, inserted: 0 },
    });
    const getMetaItems = vi.fn().mockResolvedValue({ items: apps });
    const saveMetaItem = vi.fn().mockResolvedValue({ success: true });
    // The `/packages` domain answers 503 without a registry, so `objectql` is a
    // registry and nothing else: the flip reads and writes through the protocol.
    const services: Record<string, unknown> = {
        protocol: { publishPackageDrafts, getMetaItems, saveMetaItem },
        objectql: { registry: { getAllPackages: () => [] } },
    };
    const kernel: any = {
        getService: (name: string) => (name in services ? Promise.resolve(services[name]) : null),
        context: { getService: () => null, trigger: vi.fn() },
    };
    return { dispatcher: new HttpDispatcher(kernel), getMetaItems, saveMetaItem };
}

async function publishDrafts(apps: Array<Record<string, unknown>>) {
    const door = makeDoor(apps);
    const { response } = await door.dispatcher.handlePackages(
        `/${PACKAGE_ID}/publish-drafts`, 'POST', {}, {}, PKG_ADMIN(),
    );
    const saved = door.saveMetaItem.mock.calls.map(
        (call) => call[0] as { type: string; name: string; item: Record<string, unknown>; packageId?: unknown; source?: unknown },
    );
    return { response: response as any, saved, door };
}

describe('[#23120] the publish-drafts visibility flip re-saves no stored `protection` block', () => {
    it('an app whose stored row carries the block flips, and the body it re-saves carries none', async () => {
        const stored = { name: 'legacy_app', label: 'Legacy App', hidden: false, _unpublished: true, protection: LEGACY_BLOCK };
        const { response, saved } = await publishDrafts([stored]);

        expect(response?.status).toBe(200);
        const data = response?.body?.data ?? response?.body;
        expect(data?.unhiddenApps).toEqual(['legacy_app']);
        expect(data).not.toHaveProperty('unhideError');

        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ type: 'app', name: 'legacy_app', packageId: PACKAGE_ID });
        expect(saved[0]!.item).not.toHaveProperty('protection');
        // No server-stated `source`: the flip stays a write every gate judges.
        expect(saved[0]!.source).toBeUndefined();
        // Only the block went, and the gate flipped.
        const expected: Record<string, unknown> = { ...stored, _unpublished: false };
        delete expected.protection;
        expect(saved[0]!.item).toEqual(expected);
        // The row the read answered is not mutated: it may be a cached object.
        expect(stored.protection).toEqual(LEGACY_BLOCK);
    });

    it('control: an app with no block re-saves the same body it always did', async () => {
        const stored = { name: 'plain_app', label: 'Plain App', hidden: true, _unpublished: true };
        const { response, saved } = await publishDrafts([stored]);

        expect(response?.status).toBe(200);
        expect((response?.body?.data ?? response?.body)?.unhiddenApps).toEqual(['plain_app']);
        expect(saved).toHaveLength(1);
        expect(saved[0]!.item).toEqual({ ...stored, _unpublished: false });
    });
});
