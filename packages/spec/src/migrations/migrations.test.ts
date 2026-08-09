// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from '../conversions/registry.js';
import { PROTOCOL_MAJOR } from '../kernel/protocol-version.js';
import {
  applyMetaMigrations,
  composeMigrationChain,
  MigrationFloorError,
} from './chain.js';
import {
  MIGRATIONS_BY_MAJOR,
  MIGRATION_MAJORS,
  MIGRATION_SUPPORT_FLOOR,
} from './registry.js';
import { composeSpecChanges, SpecChangesSchema } from './spec-changes.js';

const CONVERSION_IDS = new Set(ALL_CONVERSIONS.map((c) => c.id));

describe('migration chain (ADR-0087 D3)', () => {
  describe('registry integrity', () => {
    it('every step references only real conversion ids', () => {
      for (const step of Object.values(MIGRATIONS_BY_MAJOR)) {
        for (const id of step.conversionIds) {
          expect(CONVERSION_IDS.has(id)).toBe(true);
        }
      }
    });

    it('a graduated conversion belongs to the step for its own major', () => {
      for (const [majorStr, step] of Object.entries(MIGRATIONS_BY_MAJOR)) {
        const major = Number(majorStr);
        for (const id of step.conversionIds) {
          const conv = ALL_CONVERSIONS.find((c) => c.id === id)!;
          expect(conv.toMajor).toBe(major);
        }
      }
    });

    it('semantic migrations carry acceptance criteria (never silence)', () => {
      for (const step of Object.values(MIGRATIONS_BY_MAJOR)) {
        for (const s of step.semantic) {
          expect(s.acceptanceCriteria.length).toBeGreaterThan(0);
          expect(s.reason.length).toBeGreaterThan(0);
        }
      }
    });

    it('the support floor is at or below the earliest step', () => {
      expect(MIGRATION_SUPPORT_FLOOR).toBeLessThanOrEqual(MIGRATION_MAJORS[0]!);
    });
  });

  // The rationale is not decoration: `docs/protocol-upgrade-guide.md` is a pure
  // projection of it (ADR-0087 D4, `gen:upgrade-guide`), so this string IS the
  // page an author upgrading 16 → 17 reads. A stale present-tense claim here is
  // published advice, which is why it gets pinned like a prescription.
  describe('protocol-17 rationale — the app-area section states the CURRENT fact (#5337)', () => {
    const rationale17 = () => MIGRATIONS_BY_MAJOR[17]!.rationale;

    it('does not repeat the retired "the server does not walk `areas`" claim', () => {
      // #4722 (same 17.0.0 window) made `filterAppForUser` run the same
      // `filterNav` over every `areas[].navigation`. The sentence that survived
      // #4651 told an upgrading author to restructure their navigation tree for
      // a gate they can now write in place. Same pin as the schema-side
      // prescriptions carry since #5336 (`packages/spec/src/ui/app.test.ts`).
      expect(rationale17()).not.toMatch(/does not walk/i);
      // The rationale still QUOTES the retired boundary — naming what changed
      // is how a reader who remembers the old advice knows to drop it — so the
      // pin is on the tense, which is the whole defect: the claim may appear as
      // history ("was enforced by the shell only"), never as current fact.
      expect(rationale17()).not.toMatch(/is enforced by the shell only/i);
      expect(rationale17()).toMatch(/was CLOSED by #4722/);
    });

    it('names #4722 and the two trees an item gate is now enforced in', () => {
      const r = rationale17();
      expect(r).toMatch(/#4722/);
      expect(r).toMatch(/BOTH trees/);
      expect(r).toMatch(/areas\[\]\.navigation/);
    });

    it('does not read as reviving the area-LEVEL keys', () => {
      // The retirement verdict is untouched: what #4722 enforces are the ITEMS
      // inside an area, never a gate of the area's own. A rationale that merely
      // went quiet about `areas[]` would leave the reader with the old boundary;
      // one that over-corrects would read as an un-retirement.
      const r = rationale17();
      expect(r).toMatch(/stay retired/);
      expect(r).toMatch(/no gate of its own/);
    });

    it('keeps `visible` client-side only — the half #4722 did NOT change', () => {
      // The newly tempting false belief is "areas are gated now, so `visible`
      // is fine". `visible` (CEL) is still evaluated in the browser at every
      // level, so it hides an entry that has already been served.
      const r = rationale17();
      expect(r).toMatch(/client-side ONLY/);
      expect(r).toMatch(/`visible` \(CEL\)/);
      expect(r).toMatch(/never in `visible`/);
    });

    it('still carries the #4651 history the step exists to explain', () => {
      // The first half is a record of the state AT the retirement and of why
      // route B (remove) beat route A (enforce). Correcting the caveat must not
      // erase it — an upgrading author needs to know the keys were fail-open,
      // not merely unread.
      const r = rationale17();
      expect(r).toMatch(/#4651/);
      expect(r).toMatch(/FAIL-OPEN access gates/);
      expect(r).toMatch(/At the time of the retirement/);
      expect(r).toMatch(/must not invent an authorization mechanism/);
    });
  });

  // Same class as the block above, one field over. A `semantic` entry's `reason`
  // is projected verbatim into `docs/protocol-upgrade-guide.md` and
  // `spec-changes.json` (ADR-0087 D4), so a falsified premise recorded here is
  // PUBLISHED advice — not a code comment. This entry (#5015) explained its two
  // orphans by pointing one level up at #4610, and repeated #4610's stated
  // evidence: the `./ui` notification wrappers were "deleted for zero consumers".
  // objectui#3310 disproved that at 17.0.0-rc.1 — `packages/types/src/index.ts`
  // re-exported both names with `export … from '@objectstack/spec/ui'` and
  // `NotificationProtocol.ts` consumed them through the `@object-ui/types`
  // barrel, two hops an import-statement-level scan cannot see (the third miss
  // of that class, after #4667 / #4709). The RETIREMENT is untouched; only the
  // sentence that justified it moves.
  describe('protocol-17 #5015 entry — stops republishing #4610\'s falsified evidence (#5781)', () => {
    const entry = () =>
      MIGRATIONS_BY_MAJOR[17]!.semantic.find(
        (s) => s.id === 'ui-notification-action-embed-config-retired',
      );

    it('finds the entry, and it still explains the #4610 orphaning (anti-vacuity)', () => {
      expect(entry()).toBeDefined();
      expect(entry()!.reason).toMatch(/#4610/);
      expect(entry()!.reason).toMatch(/NotificationConfigSchema/);
    });

    it('never asserts the wrappers were deleted for having zero consumers', () => {
      // Pinned on the ASSERTION, not on the words: the entry may still name the
      // claim in order to correct it — going quiet about it would leave a reader
      // who remembers the old guide believing the old reason.
      expect(entry()!.reason).not.toMatch(/(deleted|removed) for (having )?zero consumers/i);
    });

    it('names the correction and keeps the removal itself standing', () => {
      const r = entry()!.reason;
      expect(r).toMatch(/falsified/);
      expect(r).toMatch(/#5781/);
      // ⛔ A correction to the evidence is not an un-retirement.
      expect(r).toMatch(/removal itself stands/);
    });
  });

  // Third of the same class, one field over again: `acceptanceCriteria` is the
  // "Done when" line `gen:upgrade-guide` projects verbatim, so a caveat that has
  // been overtaken by an enforcement is a published instruction to hand-audit a
  // mistake the engine now refuses on its own. #6746 (#6667) added
  // `AutomationEngine.refuseUndeclaredSuspension`
  // (`packages/services/service-automation/src/engine.ts`), called from
  // `executeNode` on every `result.suspend === true`, which made this entry's
  // "warned about by NEITHER channel — check those by hand" false in the
  // direction that costs a reader work. #6749 fixed the TSDoc half; this is the
  // registry channel it explicitly excluded (#6844).
  describe('protocol-17 #5561 entry — supportsPause is enforced now, so stop asking for a hand-audit (#6844)', () => {
    const entry = () =>
      MIGRATIONS_BY_MAJOR[17]!.semantic.find(
        (s) => s.id === 'action-descriptor-resume-authority-default-flip',
      );

    it('finds the entry, and it still states the resumeAuthority criterion (anti-vacuity)', () => {
      // Guards the whole block against passing because the entry vanished: every
      // negative below is vacuously true on `undefined`, and a `.find()` that
      // stops matching is exactly how that happens.
      expect(entry()).toBeDefined();
      expect(entry()!.acceptanceCriteria).toMatch(/resumeAuthority/);
      expect(entry()!.acceptanceCriteria).toMatch(/supportsPause/);
    });

    it('no longer tells the reader to hand-check the supportsPause mismatch', () => {
      // Pinned on the INSTRUCTION, not on wording: the entry may still name the
      // old gap in order to say it closed — going quiet would leave a reader who
      // remembers the published guide still doing the audit by hand.
      const a = entry()!.acceptanceCriteria;
      expect(a).not.toMatch(/check (those|them) by\s+hand/i);
      expect(a).not.toMatch(/is a declaration nothing\s+enforces/i);
      expect(a).not.toMatch(/warned about by NEITHER channel/i);
    });

    it('names the enforcing mechanism and that a `fault` edge cannot route it', () => {
      // Matched by idiom, not by sentence: the reader has to be able to FIND the
      // guard, which is what distinguishes this from a bare "it is enforced now".
      const a = entry()!.acceptanceCriteria;
      expect(a).toMatch(/refuseUndeclaredSuspension/);
      expect(a).toMatch(/#6667/);
      expect(a).toMatch(/guard-class/);
      expect(a).toMatch(/`fault` edge/);
    });

    it('does not over-correct into "nothing left to check"', () => {
      // The gate deliberately does NOT judge a descriptor-less executor
      // (engine.ts `refuseUndeclaredSuspension`, "What it does NOT judge →
      // Silence"; pinned by `supports-pause-runtime-enforcement.test.ts`'s
      // descriptor-less case). Claiming total coverage would be the same defect
      // as the old over-claim, pointing the other way.
      const a = entry()!.acceptanceCriteria;
      expect(a).toMatch(/NO descriptor/);
      expect(a).toMatch(/resume route/);
    });
  });

  describe('composition (cross-major is the designed-for case)', () => {
    it('composes only the steps in (from, to]', () => {
      const chain = composeMigrationChain(10, 11);
      expect(chain.map((s) => s.toMajor)).toEqual([11]);
    });

    it('a consumer already at current gets an empty chain', () => {
      expect(composeMigrationChain(PROTOCOL_MAJOR, PROTOCOL_MAJOR)).toHaveLength(0);
    });

    it('refuses a from-major below the support floor', () => {
      expect(() => applyMetaMigrations({}, MIGRATION_SUPPORT_FLOOR - 1)).toThrow(MigrationFloorError);
    });
  });

  describe('replay — the chain applies the graduated mechanical transforms', () => {
    it('migrates a 10.x stack with all three protocol-11 shapes to canonical', () => {
      const stack = {
        flows: [
          {
            name: 'f',
            nodes: [
              { id: 'a', type: 'http_request', config: { url: 'x' } },
              { id: 'b', type: 'delete_record', config: { objectName: 'lead', filters: { s: 1 } } },
            ],
          },
        ],
        pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }],
      };
      const result = applyMetaMigrations(stack, 10, 11);

      const flow = (result.stack.flows as any[])[0];
      expect(flow.nodes[0].type).toBe('http');
      expect(flow.nodes[1].config).toEqual({ objectName: 'lead', filter: { s: 1 } });
      expect((result.stack.pages as any[])[0].kind).toBe('html');

      // Three mechanical rewrites, no semantic TODOs triggered by these shapes
      // (semantic TODOs are advisory per-major, always surfaced for the hop).
      expect(result.applied).toHaveLength(3);
      expect(result.todos.map((t) => t.id).sort()).toEqual([
        'object-titleFormat-to-nameField',
        'rls-sql-predicate-to-cel',
      ]);
    });

    it('is immutable — the input stack is not mutated', () => {
      const stack = { pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }] };
      const snapshot = structuredClone(stack);
      applyMetaMigrations(stack, 10, 11);
      expect(stack).toEqual(snapshot);
    });

    it('checkpoints each hop for per-hop verify / bisection', () => {
      const stack = { pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }] };
      const result = applyMetaMigrations(stack, 10, 11);
      expect(result.hops).toHaveLength(1);
      expect(result.hops[0]!.toMajor).toBe(11);
      expect((result.hops[0]!.stack.pages as any[])[0].kind).toBe('html');
    });
  });

  describe('chain-replay from every conversion fixture (CI composability gate)', () => {
    // Each graduated conversion's old-shape fixture must reach canonical when
    // replayed through the full chain from the support floor — a composability
    // break is a release blocker (ADR-0087 D3), caught here, not by a consumer.
    for (const conversion of ALL_CONVERSIONS) {
      it(`${conversion.id}: fixture.before → fixture.after via the chain`, () => {
        const result = applyMetaMigrations(
          structuredClone(conversion.fixture.before),
          MIGRATION_SUPPORT_FLOOR,
          conversion.toMajor,
        );
        expect(result.stack).toEqual(conversion.fixture.after);
      });
    }
  });
});

describe('spec-changes.json manifest (ADR-0087 D4)', () => {
  it('composes conversions + semantic migrations across the range', () => {
    const changes = composeSpecChanges(10, 11);
    expect(changes.from).toBe(10);
    expect(changes.to).toBe(11);
    expect(changes.converted.map((c) => c.conversionId).sort()).toEqual(
      (CONVERSIONS_BY_MAJOR[11] ?? []).map((c) => c.id).sort(),
    );
    expect(changes.migrated.map((m) => m.migrationId).sort()).toEqual([
      'object-titleFormat-to-nameField',
      'rls-sql-predicate-to-cel',
    ]);
  });

  it('validates against its own schema', () => {
    const changes = composeSpecChanges(10, 11, {
      added: [{ surface: 'applyConversions (function)', since: 11 }],
      removed: [{ surface: 'httpRequestNode (const)', removedIn: 11, replacement: 'http node' }],
    });
    expect(SpecChangesSchema.safeParse(changes).success).toBe(true);
  });

  it('per-major manifests compose into one aggregate view', () => {
    // Folding 10→11 (the only major with a step today) must match a direct 10→11.
    const direct = composeSpecChanges(10, PROTOCOL_MAJOR);
    const convertedIds = direct.converted.map((c) => c.conversionId);
    // Every conversion in range appears exactly once (no duplication across the fold).
    expect(new Set(convertedIds).size).toBe(convertedIds.length);
  });

  it('an empty range yields an empty manifest', () => {
    const changes = composeSpecChanges(PROTOCOL_MAJOR, PROTOCOL_MAJOR);
    expect(changes.converted).toHaveLength(0);
    expect(changes.migrated).toHaveLength(0);
    expect(SpecChangesSchema.safeParse(changes).success).toBe(true);
  });
});
