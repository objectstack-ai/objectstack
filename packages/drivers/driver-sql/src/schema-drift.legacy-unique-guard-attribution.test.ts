// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  buildIndexName,
  isOrganizationScopedUnique,
  isUniqueScopeDeclared,
  legacyUniqueReplacements,
  normalizeDeclaredIndex,
} from '../src/index.js';

/**
 * #8557 — per-guard ATTRIBUTION for `legacyUniqueReplacements`.
 *
 * ## What this file adds, and what it deliberately does not touch
 *
 * The object-level suites already pin what this arm must not claim
 * (`sql-driver-declared-index-organization-respelling.test.ts` section 5, and the
 * `*-organization-unique` suites). Those tests stay exactly as they are — they
 * are BROADER than any single guard, which is the whole point: they prove the
 * outcome, not which line produces it. Nothing here replaces them.
 *
 * What #8468 measured, three single-guard ablations each predicted first:
 * removing the explicitly-named-index guard went RED, as predicted. Removing
 * the ADR-0120 S6 name-identity guard, and admitting a declared bare `true`
 * through the scope filter, both left the suite fully GREEN — including the two
 * tests whose names say they cover exactly those cases. Two of the three
 * predictions were wrong; that is what this file exists to answer.
 *
 * This file supplies the missing half — ATTRIBUTION. One input per guard,
 * constructed so that only that guard can reject it, so that deleting a guard
 * turns exactly one test red and the test's name says which line went.
 *
 * ## Why every case comes in a PAIR
 *
 * A test that asserts `[]` proves nothing on its own: an input rejected by an
 * EARLIER guard also returns `[]`, so the assertion would pass while never
 * reaching the guard it is named for — the green-pin-narrower-than-its-name
 * pattern. Each case therefore carries a `twin`: the same input with the ONE
 * property that guard reads changed, which must produce exactly one
 * replacement. The twin is the reachability witness. If a future refactor makes
 * an earlier guard swallow the whole input class, the twin goes red and says so.
 *
 * ## Three guards here are NOT individually attributable, and that is a result
 *
 * Section B collects guards for which no isolating input can exist — not
 * because the test is hard to write, but because another guard rejects a
 * SUPERSET of their inputs. Deleting one of them is behaviour-preserving for
 * every possible argument, so no test can pin it, and a test claiming to
 * would be lying. For those, what is pinned instead is the FACT THE DOMINATION
 * RESTS ON, so that the day the domination breaks — the day the guard becomes
 * load-bearing alone — something goes red.
 *
 * ## The inventory, so completeness is checkable
 *
 * Every early-exit in `legacyUniqueReplacements`, in source order, and the case
 * that speaks for it. A guard added to that function and not to this table is
 * an unattributed guard — the state this file was written to end.
 *
 *   guard                                        pinned by
 *   ────────────────────────────────────────────────────────────────────
 *   !tenantField                                 B, dominated (and by tsc)
 *   !physicalColumns.has(tenantField)            A
 *   !isUniqueScopeDeclared(field?.unique)        B, dominated
 *   !isOrganizationScopedUnique(field.unique)    A
 *   name === tenantField                         A
 *   !physicalColumns.has(name)                   A
 *   legacyNames.length === 0                     A
 *   idx?.unique !== 'organization'               A (bare `true` in B)
 *   idx.name is a non-empty string               A
 *   listed.length === 0                          B, dominated
 *   !listed.every(physicalColumns.has)           A
 *   !replacement                                 B, dominated
 *   legacyName === replacement.name              B, dominated
 *   declaredNames.has(legacyName)                A
 */

const TABLE = 'sys_team';
const TENANT = 'organization_id';
const PHYSICAL = ['id', 'organization_id', 'name', 'code', 'user_id'];

type Args = Parameters<typeof legacyUniqueReplacements>[0];

/** `legacyUniqueReplacements` over a tenant-scoped `sys_team`, with per-case overrides. */
function replacements(overrides: Partial<Args> = {}) {
  return legacyUniqueReplacements({
    table: TABLE,
    fields: {},
    tenantField: TENANT,
    physicalColumns: new Set(PHYSICAL),
    declaredIndexes: [],
    ...overrides,
  });
}

/**
 * Assert a guard is the SOLE reason nothing is claimed.
 *
 * `rejected` must yield nothing; `twin` — the same input with only the property
 * this guard reads changed — must yield exactly one replacement. Both halves
 * are required: the first is the guard's job, the second proves the input
 * reaches it.
 */
function onlyThisGuardRejects(
  guard: string,
  consequence: string,
  rejected: Partial<Args>,
  twin: Partial<Args>,
) {
  expect(
    replacements(rejected),
    `${guard} let an input through. Consequence: ${consequence}`,
  ).toEqual([]);
  expect(
    replacements(twin),
    `the twin no longer reaches ${guard} — some EARLIER guard now rejects it, so the ` +
      'case above has stopped testing what its name says',
  ).toHaveLength(1);
}

describe('legacyUniqueReplacements — per-guard attribution (#8557)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // A. Guards an input can isolate: deleting one turns exactly one case red
  // ─────────────────────────────────────────────────────────────────────────

  describe('A. individually attributable guards', () => {
    it('`if (!physicalColumns.has(tenantField)) return []` — the tenant column itself was never materialized', () => {
      onlyThisGuardRejects(
        'the unmaterialized-tenant-column guard (schema-drift.ts, `physicalColumns.has(tenantField)`)',
        'the plan proposes a composite keyed on a column that does not exist; apply fails, ' +
          'and the legacy single-column unique is dropped with nothing to replace it',
        { fields: { name: { unique: 'organization' } }, physicalColumns: new Set(['id', 'name']) },
        {
          fields: { name: { unique: 'organization' } },
          physicalColumns: new Set(['id', 'name', TENANT]),
        },
      );
    });

    it('`if (!isOrganizationScopedUnique(field.unique)) continue` — an explicit `global` FIELD keeps its single-column index', () => {
      onlyThisGuardRejects(
        "the field-level 'global' scope guard (`isOrganizationScopedUnique`)",
        "a field the author explicitly scoped 'global' is re-scoped per organization behind " +
          'their back — the cross-organization uniqueness they asked for silently stops being enforced',
        { fields: { code: { unique: 'global' } } },
        { fields: { code: { unique: 'organization' } } },
      );
    });

    it('`if (name === tenantField …) continue` — a unique declared ON the tenant column', () => {
      onlyThisGuardRejects(
        'the unique-on-the-tenant-column guard (`name === tenantField`)',
        '`(organization_id, organization_id)` is proposed as the replacement key — not a ' +
          'constraint at all, and it replaces one that was',
        { fields: { [TENANT]: { unique: 'organization' } } },
        { fields: { name: { unique: 'organization' } } },
      );
    });

    it('`if (… !physicalColumns.has(name)) continue` — the FIELD has no column yet', () => {
      onlyThisGuardRejects(
        'the unmaterialized-field-column guard (`physicalColumns.has(name)`)',
        'drift is reported for an index the sync will never create, so `os migrate plan` ' +
          'never converges',
        { fields: { nickname: { unique: 'organization' } } },
        {
          fields: { nickname: { unique: 'organization' } },
          physicalColumns: new Set([...PHYSICAL, 'nickname']),
        },
      );
    });

    it('`if (legacyNames.length === 0) continue` — BOTH legacy spellings are currently declared (#3955, field arm)', () => {
      // `legacyUniqueIndexNames` offers two names; the declared set contains both,
      // so nothing is left to retire. The twin gives one of them back.
      //
      // Measured cross-arm note: this is the one case whose isolation is
      // single-guard only. Its fixture must declare indexes (that is how
      // `declaredNames` gets populated at all), and those declarations are the
      // realistic #3955 shape — an unnamed bare `true` alongside the knex-style
      // name. Ablate the bare-spelling filter, the S6 guard and `declaredNames`
      // TOGETHER and the DECLARED arm starts claiming that same fixture, so this
      // case reddens alongside the S6 ones. That is the three-guard combination
      // the #8557 measurement calls D3, not a defect in the isolation: removing
      // any ONE guard still turns exactly one case red. Spelling the fixture so
      // no multi-guard ablation could reach it would cost the realistic shape,
      // which is the more useful thing to keep.
      onlyThisGuardRejects(
        'the nothing-left-to-retire guard (`legacyNames.length === 0`)',
        'a `replace_unique_index` op with an EMPTY drop list — a create dressed up as a ' +
          'retirement, re-proposed on every plan',
        {
          fields: { name: { unique: 'organization' } },
          declaredIndexes: [
            { name: 'sys_team_name_unique', fields: ['name'], unique: true },
            { fields: ['name'], unique: true },
          ],
        },
        {
          fields: { name: { unique: 'organization' } },
          declaredIndexes: [{ fields: ['name'], unique: true }],
        },
      );
    });

    it("`if (idx?.unique !== 'organization') continue` — a NON-unique declared index is not a replacement candidate", () => {
      // Note the sub-case this guard also covers but which cannot be isolated:
      // a declared bare `true`. See section B.
      onlyThisGuardRejects(
        "the declared-index scope filter (`idx?.unique !== 'organization'`)",
        'a plain index is treated as a legacy unique: the plan proposes dropping ' +
          '`uniq_sys_team_name` and creating a NON-unique index in its place — a uniqueness ' +
          'constraint deleted by a step categorised `safe`',
        { declaredIndexes: [{ fields: ['name'] }] },
        { declaredIndexes: [{ fields: ['name'], unique: 'organization' }] },
      );
    });

    it("`if (typeof idx?.name === 'string' && idx.name.trim()) continue` — an EXPLICITLY NAMED index is a recreate, not a replacement", () => {
      onlyThisGuardRejects(
        'the explicitly-named-index guard (`idx.name`)',
        'the plan proposes dropping the very index `recreate_index` is rebuilding under that ' +
          'same name',
        {
          declaredIndexes: [
            { name: 'ix_team_name_per_org', fields: ['name'], unique: 'organization' },
          ],
        },
        { declaredIndexes: [{ fields: ['name'], unique: 'organization' }] },
      );
    });

    it('`if (!listed.every((c) => physicalColumns.has(c))) continue` — a declared index over an unmaterialized column', () => {
      onlyThisGuardRejects(
        'the declared-index physical-columns guard (`listed.every(physicalColumns.has)`)',
        'a drop is proposed for an index that cannot exist, against a replacement that cannot ' +
          'be created',
        { declaredIndexes: [{ fields: ['nickname'], unique: 'organization' }] },
        {
          declaredIndexes: [{ fields: ['nickname'], unique: 'organization' }],
          physicalColumns: new Set([...PHYSICAL, 'nickname']),
        },
      );
    });

    it('`if (declaredNames.has(legacyName)) continue` — metadata ALSO declares the global index under that name (#3955, declared arm)', () => {
      onlyThisGuardRejects(
        'the declared-index #3955 guard (`declaredNames.has(legacyName)`)',
        'the unbounded drop/create cycle: apply drops the declared global index, the next plan ' +
          'reports it missing and recreates it, the one after calls it legacy again',
        {
          declaredIndexes: [
            { fields: ['name'], unique: 'organization' },
            { fields: ['name'], unique: 'global' },
          ],
        },
        { declaredIndexes: [{ fields: ['name'], unique: 'organization' }] },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B. Guards no input can isolate — the domination is pinned instead
  // ─────────────────────────────────────────────────────────────────────────

  describe('B. structurally dominated guards — what is pinned is the domination', () => {
    it('`if (!tenantField) return []` cannot be attributed at runtime — the NEXT line rejects a superset, and tsc is what actually holds this one', () => {
      // Deleting this guard changes no return value for any argument: with
      // `tenantField` null the very next line asks `physicalColumns.has(null)`,
      // and a Set built from column names never holds a non-string, so the
      // function still returns [] by that route instead of this one.
      //
      // What deleting it DOES break is the type: the guard is the narrowing
      // that makes `tenantField` a `string` for `physicalColumns.has(tenantField)`
      // below. Remove it and `pnpm --filter @objectstack/driver-sql typecheck`
      // fails while every test stays green — so the pin on this line is tsc,
      // and a future author reading "no test covers it" should not conclude
      // "nothing covers it".
      expect(
        replacements({ tenantField: null, fields: { name: { unique: 'organization' } } }),
        'a tenant-less table has nothing mis-scoped to retire',
      ).toEqual([]);
      // The reachability witness: the same input is otherwise live, so the
      // assertion above is about tenancy and not about some other rejection.
      expect(replacements({ fields: { name: { unique: 'organization' } } })).toHaveLength(1);
    });

    /**
     * ADR-0120 S6, as shipped: a hand-written tenant composite that lists the
     * organization column, spelled `unique: true`. Transcribed from the object
     * definitions themselves — verified against
     * `packages/platform-objects/src/identity/sys-team.object.ts`
     * (`{ fields: ['name', 'organization_id'], unique: true }`),
     * `sys-business-unit.object.ts`
     * (`{ fields: ['code', 'organization_id'], unique: true }`) and
     * `sys-member.object.ts`
     * (`{ fields: ['organization_id', 'user_id'], unique: true }`) — note the
     * organization column lands last in two of them and first in the third, so
     * both key orders are exercised. If one of these is ever respelled, this
     * table is what tells the next author their protection changed shape.
     */
    const S6_OBJECTS = [
      { table: 'sys_team', fields: ['name', TENANT], physical: ['id', TENANT, 'name'] },
      { table: 'sys_business_unit', fields: ['code', TENANT], physical: ['id', TENANT, 'code'] },
      { table: 'sys_member', fields: [TENANT, 'user_id'], physical: ['id', TENANT, 'user_id'] },
    ] as const;

    it('the S6 composites on sys_team / sys_business_unit / sys_member are claimed by NOTHING, in either spelling', () => {
      for (const o of S6_OBJECTS) {
        const consequence =
          `the migration plan proposes DROPPING ${o.table}'s hand-written composite ` +
          `(${o.fields.join(', ')}) — the constraint that makes those values unique per ` +
          'organization. It is a shipped platform object and the spelling is valid indefinitely ' +
          '(ADR-0120 S6).';

        // As shipped today: bare `true`, organization column listed.
        expect(
          legacyUniqueReplacements({
            table: o.table,
            fields: {},
            tenantField: TENANT,
            physicalColumns: new Set(o.physical),
            declaredIndexes: [{ fields: [...o.fields], unique: true }],
          }),
          consequence,
        ).toEqual([]);

        // After the D5c advisory respelling an author may opt into — the shape
        // the `legacyName === replacement.name` guard was written for.
        expect(
          legacyUniqueReplacements({
            table: o.table,
            fields: {},
            tenantField: TENANT,
            physicalColumns: new Set(o.physical),
            declaredIndexes: [{ fields: [...o.fields], unique: 'organization' }],
          }),
          `${consequence} (respelled 'organization' form)`,
        ).toEqual([]);
      }
    });

    it("`if (legacyName === replacement.name) continue` cannot be attributed — `declaredNames` rejects a SUPERSET, so what is pinned is the name identity the domination rests on", () => {
      // Why no isolating input exists: `declaredNames` is built by calling
      // `normalizeDeclaredIndex` on every declared index, so `replacement.name`
      // is ALWAYS a member of it. Whenever `legacyName === replacement.name`
      // holds, `declaredNames.has(legacyName)` holds too — for every possible
      // argument. Deleting this guard is behaviour-preserving, which is what
      // ablation C2 of #8557 measured as "GREEN 17/17".
      //
      // The identity below is the load-bearing fact, and it is a tripwire in
      // BOTH directions: if a respelled S6 composite ever normalizes to a name
      // OTHER than the generated unique name for its listed columns, this guard
      // stops matching AND `declaredNames` stops covering it — the composite
      // loses both lines of defence in one step, silently.
      for (const o of S6_OBJECTS) {
        const listed = [...o.fields];
        const normalized = normalizeDeclaredIndex(
          o.table,
          { fields: listed, unique: 'organization' },
          TENANT,
        );
        expect(
          normalized?.name,
          `${o.table}: an S6 composite no longer normalizes to the generated unique name for ` +
            'its listed columns. Both guards that keep the replacement arm off this index read ' +
            'that identity, so BOTH have just stopped applying.',
        ).toBe(buildIndexName(o.table, listed, true));
        expect(
          normalized?.columns,
          `${o.table}: the organization column is listed, so nothing may be prepended to it`,
        ).toEqual(listed);
      }
    });

    it('a declared bare `true` is taken VERBATIM as global — the test-side half of the #8463 prose guard', () => {
      // #8463 (PR #8512) put this divergence in prose on `isOrganizationScopedUnique`:
      // a FIELD's bare `true` means per-organization, a DECLARED INDEX's bare
      // `true` is the positional spelling of 'global'. Routing the declared
      // branch through the field predicate is the REJECTED option 1 of #8323
      // (maintainer ruling 2026-08-13) — it would reinterpret every deployed
      // declared `unique: true` as organization-scoped.
      //
      // That prose had no attributing test. This is it — and it is a pin on
      // `normalizeDeclaredIndex`, not on the replacement arm's filter, because
      // the bare-spelling CASE is triple-guarded (the scope filter, then the
      // name identity above, then `declaredNames`): ablation C3 of #8557
      // measured that admitting bare `true` through the filter changes no
      // observable behaviour at all. The reachable failure is the reinterpretation.
      const normalized = normalizeDeclaredIndex(
        TABLE,
        { fields: ['name', 'code'], unique: true },
        TENANT,
      );
      expect(
        normalized?.columns,
        "a declared index's bare `true` has become organization-scoped — the rejected option 1 " +
          'of #8323: an unannounced index migration on every deployed database, landing before ' +
          '#5082 refuses the bare spelling',
      ).toEqual(['name', 'code']);
      expect(
        normalized?.nullSafeColumns,
        'a bare `true` declared index must carry no NULL-safe organization key part',
      ).toBeUndefined();
      expect(
        replacements({ declaredIndexes: [{ fields: ['name', 'code'], unique: true }] }),
        'the bare spelling is untouched until #5082 decides it (v18 D2)',
      ).toEqual([]);
    });

    it('`!isUniqueScopeDeclared(field?.unique)` cannot be attributed — `isOrganizationScopedUnique` rejects a superset', () => {
      // Every spelling the first predicate admits, the second one judges again,
      // and the second admits strictly fewer. So the first guard can never be
      // the sole reason a field is skipped. Pinned here as the containment
      // itself: the day a spelling is organization-scoped WITHOUT being a
      // declared unique scope, the first guard becomes load-bearing.
      for (const spelling of [true, false, undefined, null, 'global', 'organization', 'nonsense']) {
        if (!isOrganizationScopedUnique(spelling)) continue;
        expect(
          isUniqueScopeDeclared(spelling),
          `\`${String(spelling)}\` is organization-scoped but not a declared unique scope — the ` +
            'two predicates have diverged and the scope-declared guard is now load-bearing on ' +
            'its own, with no test attributing it',
        ).toBe(true);
      }
    });

    it('an index declaring no usable fields is claimed by nothing — double-covered, not attributable', () => {
      // `listed.length === 0` and the `!replacement` null check are mutually
      // redundant: `normalizeDeclaredIndex` returns null ONLY for an empty
      // listed set, computed by the identical filter. Deleting either alone is
      // behaviour-preserving; deleting both throws. This case is the joint pin.
      expect(replacements({ declaredIndexes: [{ fields: [], unique: 'organization' }] })).toEqual(
        [],
      );
      expect(replacements({ declaredIndexes: [{ unique: 'organization' }] })).toEqual([]);
      expect(
        normalizeDeclaredIndex(TABLE, { fields: [], unique: 'organization' }, TENANT),
        'the null-replacement guard has exactly one trigger, and the empty-fields guard already ' +
          'rejects it',
      ).toBeNull();
    });
  });
});
