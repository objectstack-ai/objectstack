// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5599 — the producer half of the identity precondition, pinned where the
 * producer lives.
 *
 * `ViewMetadataSchema`'s precondition asks "did the AUTHOR send something that
 * is a view?". It cannot ask that directly, because `saveMetaItem` normalizes
 * before it validates: by the time the schema sees the body,
 * {@link normalizeViewMetadata} has already stamped keys onto it. The schema
 * therefore discounts a fixed set — `VIEW_WRITE_PATH_IDENTITY_KEYS` — when
 * judging evidence.
 *
 * That makes the two files a matched pair with no compiler link between them:
 * the day this function learns to stamp a fifth key, that key silently becomes
 * "evidence the author sent a view" over in `packages/spec`, and `{ nope: 1 }`
 * starts passing the gate again — the exact defect #5599 closed, reopened by an
 * edit that looks entirely reasonable and touches neither the schema nor this
 * test's subject.
 *
 * So the pin is behavioural, not a copy of the list: it feeds the normalizer the
 * emptiest possible body together with a maximal baseline, and asserts that
 * everything it stamps is discounted. A new stamped key fails here, in the file
 * that introduced it, with the remedy named.
 */
import { describe, expect, it } from 'vitest';
import { VIEW_WRITE_PATH_IDENTITY_KEYS } from '@objectstack/spec/ui';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { normalizeViewMetadata } from './protocol.js';

/** A registry entry carrying every identity field `viewIdentityPatch` inherits. */
const baseline = {
    name: 'showcase_task.default',
    object: 'showcase_task',
    viewKind: 'list',
    label: 'All Tasks',
    scope: 'package',
    config: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns: ['title'] },
};

describe('#5599 the write path stamps only keys the spec discounts as identity', () => {
    it('every key stamped onto an empty body is in VIEW_WRITE_PATH_IDENTITY_KEYS', () => {
        const stamped = normalizeViewMetadata('view', {}, 'showcase_task.default', baseline) as Record<string, unknown>;
        const unaccounted = Object.keys(stamped).filter((k) => !VIEW_WRITE_PATH_IDENTITY_KEYS.has(k));
        expect(
            unaccounted,
            'normalizeViewMetadata stamped a key the #5599 identity precondition does not discount. '
            + 'That key now counts as evidence that the author sent a view, which re-opens #5599. '
            + 'Add it to VIEW_WRITE_PATH_IDENTITY_KEYS in packages/spec/src/ui/view.zod.ts.',
        ).toEqual([]);
    });

    it('…and with no baseline it stamps only `name`', () => {
        const stamped = normalizeViewMetadata('view', {}, 'adhoc.view', undefined) as Record<string, unknown>;
        expect(Object.keys(stamped)).toEqual(['name']);
        expect(VIEW_WRITE_PATH_IDENTITY_KEYS.has('name')).toBe(true);
    });

    it('the normalized garbage body is REJECTED — the two halves compose', () => {
        // This is the end-to-end statement of the fix, at the seam: the body the
        // schema actually receives for the issue's headline input, in both the
        // baseline and no-baseline cases.
        const schema = getMetadataTypeSchema('view')!;
        for (const withBaseline of [undefined, baseline]) {
            const normalized = normalizeViewMetadata('view', { nope: 1 }, 'garbage_view', withBaseline);
            expect(schema.safeParse(normalized).success).toBe(false);
        }
    });

    it('…while a real personalization PUT survives the same seam', () => {
        const schema = getMetadataTypeSchema('view')!;
        const personalization = {
            type: 'grid',
            data: { provider: 'object', object: 'showcase_task' },
            columns: ['title'],
            sort: [{ field: 'estimate_hours', order: 'desc' }],
        };
        const normalized = normalizeViewMetadata('view', personalization, 'showcase_task.default', baseline);
        expect(schema.safeParse(normalized).success).toBe(true);
    });
});
