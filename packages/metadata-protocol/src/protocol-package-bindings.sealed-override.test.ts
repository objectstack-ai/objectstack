// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29613] The two closed type lists the row-served override path rests on:
 * the sealed types whose declared `.custom` override the reads serve from its
 * row ({@link servesSealedOverrideRow}), and the types whose such row stays out
 * of the registry's bare slot ({@link declinesBorrowedEnvelope}). Every type of
 * the first is in the second, so no override loses its bare entry before its
 * row is served, and none keeps a bare entry wearing the base's envelope after.
 *
 * The readings themselves (every reader, per type, with and without a
 * metadata service) are pinned in `@objectstack/objectql`'s
 * `protocol-custom-override-sealed-row-served.test.ts`, over the real registry.
 */
import { describe, expect, it } from 'vitest';
import { declinesBorrowedEnvelope, servesSealedOverrideRow } from './protocol-package-bindings.js';

const ROW_SERVED = ['page', 'app', 'dataset', 'doc', 'book'] as const;
/** The base's code artifact the hydrator's lookup falls back to for a pair's row. */
const BASE_ARTIFACT = { _packageId: 'com.example.showcase' };

describe('[#29613] the sealed row-served override types', () => {
    it.each(ROW_SERVED)('%s: its declared override is served from its row, and its row takes no borrowed envelope', (type) => {
        expect(servesSealedOverrideRow(type)).toBe(true);
        expect(declinesBorrowedEnvelope(type, 'com.example.showcase.custom', BASE_ARTIFACT)).toBe(true);
    });

    it('folds a plural spelling to the canonical type', () => {
        expect(servesSealedOverrideRow('pages')).toBe(true);
        expect(servesSealedOverrideRow('apps')).toBe(true);
    });

    it.each(['mapping', 'action', 'flow', 'object', 'permission', 'view', 'dashboard', 'report', 'email_template'])(
        '%s: not a sealed row-served override type',
        (type) => {
            expect(servesSealedOverrideRow(type)).toBe(false);
        },
    );

    it.each(ROW_SERVED)('%s: the #4624 case keeps its bare entry (a row of the package that ships the artifact)', (type) => {
        expect(declinesBorrowedEnvelope(type, 'com.example.showcase', BASE_ARTIFACT)).toBe(false);
        expect(declinesBorrowedEnvelope(type, null, BASE_ARTIFACT)).toBe(false);
    });
});
