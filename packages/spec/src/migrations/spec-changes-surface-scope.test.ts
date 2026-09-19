// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The aggregate record's export arrays must say which range they cover (#18978).
 *
 * `added`/`removed` are not registry-derived: a release-time api-surface diff
 * fills them by comparing the artifact being published against the previously
 * PUBLISHED one, so they span ONE RELEASE. Under a record keyed `from: 10,
 * to: 17` that was indistinguishable from the whole major-boundary delta — and
 * the `@objectstack/spec@17.4.0` Release asset really carried 225 added / 51
 * removed, every entry `since: 17`, while `perMajor[16 → 17].added` sat at `0`.
 *
 * The three things pinned here, in the order they matter:
 *
 * 1. a scoped diff carries the version pair, and the pair is what a consumer
 *    reads to tell a minor's slice from a major's;
 * 2. an UNSCOPED non-empty diff is refused by {@link surfaceScopeProblem} — and
 *    is still ACCEPTED by {@link SpecChangesSchema}, deliberately, because a
 *    previously published manifest carries exactly that shape and a schema that
 *    refused it would narrow what an already-shipped artifact parses as;
 * 3. the records that are honest today stay byte-identical: a `perMajor` record
 *    and the committed registry-only aggregate carry no new key at all.
 */

import { describe, expect, it } from 'vitest';

import { PROTOCOL_MAJOR } from '../kernel/protocol-version.js';
import { MIGRATION_SUPPORT_FLOOR } from './registry.js';
import {
  composeReleaseChanges,
  composeSpecChanges,
  SpecChangesSchema,
  SpecSurfaceScopeSchema,
  surfaceScopeProblem,
} from './spec-changes.js';

/** One release's worth of export diff, the shape the publish lane supplies. */
const ONE_RELEASE_SLICE = {
  added: [
    { surface: './api: AnalyticsEndpoint (const)', since: PROTOCOL_MAJOR },
    { surface: './api: ApiEndpoint (const)', since: PROTOCOL_MAJOR },
  ],
  removed: [{ surface: './integration: ConnectorErrorCategory (type)', removedIn: PROTOCOL_MAJOR }],
};
const SCOPE = { fromVersion: '17.3.0', toVersion: '17.4.0' };

describe('aggregate export arrays declare the range they really cover (#18978)', () => {
  it('carries the published-version pair the diff was taken between', () => {
    const aggregate = composeSpecChanges(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR, {
      ...ONE_RELEASE_SLICE,
      scope: SCOPE,
    });

    // The record is still keyed by MAJOR — that half is unchanged — and the
    // arrays now name the release pair, so the two resolutions are separable.
    expect(aggregate.from).toBe(MIGRATION_SUPPORT_FLOOR);
    expect(aggregate.to).toBe(PROTOCOL_MAJOR);
    expect(aggregate.surfaceScope).toEqual(SCOPE);
    expect(SpecSurfaceScopeSchema.safeParse(aggregate.surfaceScope).success).toBe(true);

    const parsed = SpecChangesSchema.safeParse(aggregate);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.surfaceScope).toEqual(SCOPE);
  });

  it('refuses a non-empty export diff that names no range', () => {
    const unscoped = composeSpecChanges(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR, ONE_RELEASE_SLICE);
    expect(unscoped.surfaceScope).toBeUndefined();

    const problem = surfaceScopeProblem(unscoped);
    expect(problem).not.toBeNull();
    // The refusal must name both counts and the range it would be misread as —
    // a bare "missing surfaceScope" leaves the reader to rediscover why.
    expect(problem).toContain('2 added');
    expect(problem).toContain('1 removed');
    expect(problem).toContain(`${MIGRATION_SUPPORT_FLOOR} → ${PROTOCOL_MAJOR}`);
    expect(problem).toContain('surfaceScope');
  });

  it('is refused by the producer and still ACCEPTED by the schema', () => {
    // Not a contradiction, and the one thing that keeps this additive: every
    // manifest published before this field exists carries an unscoped diff, so
    // the published schema must keep parsing it. The refusal lives at the
    // producer and at the publish gate, never in the accept set.
    const unscoped = composeSpecChanges(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR, ONE_RELEASE_SLICE);
    expect(surfaceScopeProblem(unscoped)).not.toBeNull();
    expect(SpecChangesSchema.safeParse(unscoped).success).toBe(true);
  });

  it('passes a scoped diff and an empty one alike', () => {
    expect(
      surfaceScopeProblem(
        composeSpecChanges(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR, { ...ONE_RELEASE_SLICE, scope: SCOPE }),
      ),
    ).toBeNull();
    expect(surfaceScopeProblem(composeSpecChanges(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR))).toBeNull();
  });
});

describe('preserved truth — the records that are honest today are untouched', () => {
  it('a registry-only record carries no surfaceScope KEY at all', () => {
    const aggregate = composeSpecChanges(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR);
    // `in`, not `=== undefined`: the committed artifact is compared byte-for-byte
    // by `check:spec-changes`, so a present-but-null key would be a diff.
    expect('surfaceScope' in aggregate).toBe(false);
    expect(Object.keys(aggregate).sort()).toEqual(['added', 'converted', 'from', 'migrated', 'removed', 'to']);
    expect(aggregate.added).toEqual([]);
    expect(aggregate.removed).toEqual([]);
  });

  it('every perMajor record keeps its exact shape and its counts', () => {
    for (let major = MIGRATION_SUPPORT_FLOOR + 1; major <= PROTOCOL_MAJOR; major++) {
      const record = composeSpecChanges(major - 1, major);
      expect('surfaceScope' in record).toBe(false);
      expect(record.added).toEqual([]);
      expect(record.removed).toEqual([]);
      expect(SpecChangesSchema.safeParse(record).success).toBe(true);
    }
  });

  it('the per-release section is unchanged — same six keys, no scope on it', () => {
    const current = composeSpecChanges(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR);
    const section = composeReleaseChanges(
      '17.3.0',
      '17.4.0',
      current,
      { conversionIds: current.converted.map((c) => c.conversionId), migrationIds: [] },
      { added: ['./api: ApiEndpoint (const)'], removed: [] },
    );
    expect(Object.keys(section).sort()).toEqual([
      'added',
      'converted',
      'fromVersion',
      'migrated',
      'removed',
      'toVersion',
    ]);
    // Its attribution already lives on the section, which is why its entries
    // are bare `{ surface }` — the aggregate now says the same thing its own way.
    expect(section.added).toEqual([{ surface: './api: ApiEndpoint (const)' }]);
    expect(section.fromVersion).toBe('17.3.0');
    expect(section.toVersion).toBe('17.4.0');
  });
});
