// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit pins for the def-rename carry-over table (#4684).
 *
 * `build-schemas.ts` is a top-level script — importing it runs a full schema
 * build — so the rules it enforces live in `lib/renamed-defs.ts` where they can
 * be exercised directly. These tests pin the *rules*; the wiring is pinned by
 * the gate itself, which the PR's sabotage runs exercised (drop one key from
 * the renamed def → red; leave the old def emitted → red; misspell the target
 * → red).
 *
 * The point of every assertion below is the same: a rename entry must be able
 * to explain a def key moving, and must NOT be able to explain a key going
 * away. That asymmetry is the whole reason the table is safe to add.
 */
import { describe, it, expect } from 'vitest';
import {
  RENAMED_DEFS,
  carryAuthorableKey,
  checkRenameTable,
} from './lib/renamed-defs';

describe('carryAuthorableKey', () => {
  const renames = { 'integration/Old': 'integration/New' } as const;

  it('moves a key to the renamed def, leaving the property name alone', () => {
    expect(carryAuthorableKey('integration/Old:windowSeconds', renames)).toBe(
      'integration/New:windowSeconds',
    );
  });

  it('leaves keys of undeclared defs untouched', () => {
    expect(carryAuthorableKey('shared/RateLimitConfig:windowMs', renames)).toBe(
      'shared/RateLimitConfig:windowMs',
    );
  });

  it('matches the def exactly — a prefix is not a rename', () => {
    // `integration/OldThing` merely starts with a renamed def's name. Rewriting
    // it would silently retarget an unrelated schema's keys.
    expect(carryAuthorableKey('integration/OldThing:x', renames)).toBe(
      'integration/OldThing:x',
    );
  });

  it('rewrites only the first separator, so a property containing ":" survives', () => {
    expect(carryAuthorableKey('integration/Old:a:b', renames)).toBe('integration/New:a:b');
  });

  it('returns a bare def key (no property) unchanged', () => {
    expect(carryAuthorableKey('integration/Old', renames)).toBe('integration/Old');
  });
});

describe('checkRenameTable', () => {
  const renames = { 'integration/Old': 'integration/New' } as const;

  it('accepts a rename the build actually performed', () => {
    expect(checkRenameTable(new Set(['integration/New']), renames)).toEqual([]);
  });

  it('rejects a rename whose source def is STILL emitted (a copy, not a rename)', () => {
    const problems = checkRenameTable(
      new Set(['integration/Old', 'integration/New']),
      renames,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('SOURCE def is still emitted');
  });

  it('rejects a rename whose target def does not exist (typo, or the def was deleted)', () => {
    const problems = checkRenameTable(new Set(['integration/Other']), renames);
    // Source absent + target absent → only the target complaint fires.
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('TARGET def is not emitted');
  });

  it('rejects a no-op entry', () => {
    const problems = checkRenameTable(new Set(['integration/Old']), {
      'integration/Old': 'integration/Old',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('source and target are the same def');
  });
});

describe('the committed RENAMED_DEFS table', () => {
  it('records the #4684 connector rate-limit rename', () => {
    expect(RENAMED_DEFS['integration/RateLimitConfig']).toBe(
      'integration/ConnectorRateLimitConfig',
    );
  });

  it('leaves the shared (inbound) declaration alone — only the connector side moved', () => {
    // ADR-0112 D9a renames the CONNECTOR side so one name means one thing;
    // `shared/RateLimitConfig` is the incumbent and keeps its name and its keys.
    expect(RENAMED_DEFS['shared/RateLimitConfig']).toBeUndefined();
  });

  it('is well-formed: no self-renames, no two defs claiming one target', () => {
    const targets = Object.values(RENAMED_DEFS);
    for (const [from, to] of Object.entries(RENAMED_DEFS)) expect(from).not.toBe(to);
    expect(new Set(targets).size).toBe(targets.length);
  });
});
