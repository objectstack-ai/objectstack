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

  // ─── Rules that only bind with MORE THAN ONE entry (#4703) ──────────────
  // The table shipped with a single entry, so nothing exercised how two
  // entries interact. #4703 is the first change to add two at once.

  it('accepts several independent renames in one build', () => {
    expect(
      checkRenameTable(new Set(['integration/NewA', 'data/NewB', 'shared/Untouched']), {
        'integration/OldA': 'integration/NewA',
        'data/OldB': 'data/NewB',
      }),
    ).toEqual([]);
  });

  it('rejects two sources claiming ONE target — that is a merge, not two renames', () => {
    // Why this must be fatal: `build-schemas.ts` carries the snapshot into a
    // map keyed by the NEW key, so `A:foo` and `B:foo` collapse onto `X:foo`
    // and the surviving entry's RETIRED state is whichever was carried last.
    // A key that was live under one def and tombstoned under the other reads
    // as already-retired, and check (b) — live → retired needs a registered
    // ADR-0087 conversion — never fires. The table would then be explaining a
    // key leaving the contract, the one thing it may not do.
    const problems = checkRenameTable(new Set(['integration/X']), {
      'integration/A': 'integration/X',
      'integration/B': 'integration/X',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('already claimed by integration/A');
  });

  it('rejects a chained rename, and says it is a chain rather than a typo', () => {
    // A → B → C. The pre-existing "target not emitted" rule already made this
    // red (B is gone), but named it a misspelling — which invites the wrong
    // repair. The carry is a single pass, so a chain is unsupported outright.
    const problems = checkRenameTable(new Set(['integration/C']), {
      'integration/A': 'integration/B',
      'integration/B': 'integration/C',
    });
    expect(problems.some((p) => p.includes('is itself renamed away'))).toBe(true);
  });

  it('does not mistake the BASE of an extend for a rename source', () => {
    // #4703's shape: `integration/ConnectorFieldMapping` is
    // `shared/FieldMapping.extend(…)`. The base is still emitted under its own
    // name — it is neither source nor target — and the target's key set is a
    // superset of the base's, so no carried key can go missing.
    expect(
      checkRenameTable(new Set(['shared/FieldMapping', 'integration/ConnectorFieldMapping']), {
        'integration/FieldMapping': 'integration/ConnectorFieldMapping',
      }),
    ).toEqual([]);
  });
});

describe('the committed RENAMED_DEFS table', () => {
  it('no longer carries the #4684 connector rate-limit rename — #4911 absorbed it', () => {
    // The #4684 rename (`integration/RateLimitConfig` →
    // `integration/ConnectorRateLimitConfig`) and the #4911 retirement of the
    // renamed def landed in the SAME unreleased major, so composed they are a
    // plain delete. Two independent reasons the entry must be gone:
    //   1. `checkRenameTable` rejects a target this build no longer emits —
    //      leaving it would fail `gen:schema` before either ratchet runs;
    //   2. a retirement must never ride this table (see the `automation/
    //      ConflictResolution` note in lib/renamed-defs.ts) — it is carried by
    //      the tombstone + D2 conversion + deliberate manifest deletion.
    // Re-adding it would claim the def still exists under a new name.
    expect(RENAMED_DEFS['integration/RateLimitConfig']).toBeUndefined();
    expect(Object.values(RENAMED_DEFS)).not.toContain('integration/ConnectorRateLimitConfig');
  });

  it('leaves the shared (inbound) declaration alone — only the connector side ever moved', () => {
    // ADR-0112 D9a renamed the CONNECTOR side so one name means one thing;
    // `shared/RateLimitConfig` is the incumbent, keeps its name and its keys,
    // and #4911 (which retired the connector side) did not touch it — the
    // inbound limiter is a real, enforced engine.
    expect(RENAMED_DEFS['shared/RateLimitConfig']).toBeUndefined();
  });

  it('records the #4703 tri-source FieldMapping renames — both of them', () => {
    expect(RENAMED_DEFS['integration/FieldMapping']).toBe(
      'integration/ConnectorFieldMapping',
    );
    expect(RENAMED_DEFS['data/FieldMapping']).toBe('data/ImportFieldMapping');
  });

  it('leaves the shared BASE alone — `shared/FieldMapping` keeps the bare name', () => {
    // `integration/ConnectorFieldMapping` (and `data/ExternalFieldMapping`,
    // until #8075 retired that family whole) `.extend()` it. Renaming the base
    // would move keys under other defs and change nothing about the collision,
    // which was between the two domain-specific sides and the base's own name.
    expect(RENAMED_DEFS['shared/FieldMapping']).toBeUndefined();
  });

  it('is well-formed: no self-renames, no two defs claiming one target', () => {
    const targets = Object.values(RENAMED_DEFS);
    for (const [from, to] of Object.entries(RENAMED_DEFS)) expect(from).not.toBe(to);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('is internally consistent by its own build-time rules', () => {
    // The three checks above are hand-written assertions about the committed
    // table; this one runs the REAL validator over it with a set of emitted
    // defs synthesised from the table itself. It is what catches a future
    // entry that is well-formed in isolation but interacts badly — a chain, or
    // a second source pointed at an existing target.
    const emitted = new Set(Object.values(RENAMED_DEFS));
    expect(checkRenameTable(emitted, RENAMED_DEFS)).toEqual([]);
  });
});
