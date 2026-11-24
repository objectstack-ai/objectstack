// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32958] The `object-storage-sync-refused` notice reads true on every door
 * that raises it.
 *
 * One builder ({@link objectStorageSyncRefusedNotice}) serves the save door,
 * `publishMetaItem` and `publishPackageDrafts` (through `runPublishSideEffects`),
 * `rollbackMetaItem` and `revertCommit`. Its text used to speak of "this save"
 * and tell a caller of rollback or revert to "publish the object again". It
 * now names no door, and its hint names only the remedies that work from each
 * of them: a restart, or the next live write of the object.
 *
 * The door half (the revert door's advisory is this builder's value, whole)
 * is pinned beside its existing case in
 * `protocol.revert-commit-honest-outcome.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { OBJECT_STORAGE_SYNC_REFUSED, objectStorageSyncRefusedNotice } from './protocol-registry-hydration.js';
// The source reaches `@objectstack/lint` only through a dynamic import; paid
// here at module scope so the first load lands during collection, not inside a
// clocked window (`pnpm check:test-source-alias`).
import '@objectstack/lint';

describe('[#32958] the storage-sync-refused notice names no door', () => {
    const notice = objectStorageSyncRefusedNotice('ticket', new Error('the datasource is read-only'));
    const text = `${notice.message}\n${notice.hint}`;

    it('speaks of no save and no publish, so a rollback, revert or publish answer reads true', () => {
        expect(notice.rule).toBe(OBJECT_STORAGE_SYNC_REFUSED);
        expect(text).not.toMatch(/\bsave/i);
        expect(text).not.toMatch(/\bpublish/i);
    });

    it('CONTROL: it still says what failed and names the remedies (restart, the next live write)', () => {
        expect(notice.severity).toBe('warning');
        expect(notice.message).toContain("object 'ticket'");
        expect(notice.message).toContain('its storage was NOT created or altered');
        expect(notice.hint).toContain('restarting the server');
        expect(notice.hint).toContain('next live write of this object');
    });
});
