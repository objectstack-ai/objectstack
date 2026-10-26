// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import {
  composeReleaseChanges,
  composeSpecChanges,
  SpecChangesSchema,
  SpecReleaseChangesSchema,
} from './spec-changes.js';

const CONVERSION_IDS = new Set(ALL_CONVERSIONS.map((c) => c.id));
const CONVERSION_TO_MAJOR = new Map(ALL_CONVERSIONS.map((c) => [c.id, c.toMajor] as const));

/**
 * Ruling B (ADR-0087 D3; the contract is `SemanticMigration` in `./types.ts`):
 * every retirement family carries ONE D3 entry, even when a lossless D2
 * conversion also repairs its data — D2 carries the mechanical repair only.
 * Protocol 17 shipped before the rule and was not back-filled, so the pin
 * below binds from protocol 18 on.
 */
const D3_PER_FAMILY_FROM_MAJOR = 18;

const SEMANTIC_ENTRIES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'entries/semantic');

/**
 * The full text — leading comment AND literal — of every `semantic/` entry
 * file registered under `major`, keyed by filename. The files, not the parsed
 * objects: an entry may name its family's conversion in the comment the
 * generator carries into `registry.ts` rather than in a field, and the
 * generator writes the region from exactly these files on every build (the
 * registry is never committed, so there is no second copy to drift).
 */
function semanticEntrySources(major: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(SEMANTIC_ENTRIES_DIR).sort()) {
    if (name.startsWith(`${major}.`) && name.endsWith('.ts')) {
      out.set(name, readFileSync(resolve(SEMANTIC_ENTRIES_DIR, name), 'utf8'));
    }
  }
  return out;
}

/** The entry files of `major` that name conversion `id` as a whole id, not as a prefix of a longer one. */
function entriesNaming(sources: Map<string, string>, id: string): string[] {
  const whole = new RegExp(`(?<![a-z0-9-])${id.replaceAll('-', '\\-')}(?![a-z0-9-])`);
  return [...sources].filter(([, text]) => whole.test(text)).map(([name]) => name);
}

describe('migration chain (ADR-0087 D3)', () => {
  describe('registry integrity', () => {
    it('every step references only real conversion ids', () => {
      for (const step of Object.values(MIGRATIONS_BY_MAJOR)) {
        for (const id of step.conversionIds) {
          expect(CONVERSION_IDS.has(id)).toBe(true);
        }
      }
    });

    // `SemanticMigration.conversionIds` is the join between an applied edit and
    // the entry that judges it, keyed on `MigrationApplication.conversionId`.
    // An id the chain never replays at or before the entry's hop can never meet
    // an applied edit, so the link would silently pair nothing: a typo, a
    // conversion of a later major, or one whose step fell below the floor.
    it('every `conversionIds` link on a semantic entry names a registered conversion that its own step or an earlier one replays', () => {
      const dangling: string[] = [];
      let links = 0;
      for (const major of MIGRATION_MAJORS) {
        const replayed = new Set(
          MIGRATION_MAJORS.filter((m) => m <= major).flatMap((m) => MIGRATIONS_BY_MAJOR[m]!.conversionIds),
        );
        for (const s of MIGRATIONS_BY_MAJOR[major]!.semantic) {
          for (const id of s.conversionIds ?? []) {
            links++;
            if (!CONVERSION_IDS.has(id)) {
              dangling.push(`protocol ${major}: ${s.id} → ${id} (no registered conversion has this id)`);
            } else if (!replayed.has(id) && CONVERSION_TO_MAJOR.get(id)! > MIGRATION_SUPPORT_FLOOR) {
              // A conversion of a major AT or BELOW the floor has no step left
              // to replay it: its step aged out with the floor (ADR-0087
              // amendment, #25767) while the conversion row stays registered
              // for the stored-row door. Such a link pairs with the edit that
              // door applies, so it is not dangling.
              dangling.push(`protocol ${major}: ${s.id} → ${id} (registered, but no step at or below ${major} replays it)`);
            }
          }
        }
      }
      expect(
        dangling,
        `semantic entry link(s) that can pair with no applied edit: ${dangling.join(', ')}. `
          + 'Remedy: correct the id in the entry file under `entries/semantic/` to the D2 conversion whose '
          + 'applied edits the entry judges, one graduated into the entry\'s own step or an earlier one, '
          + 'then `gen:migration-registry`; or drop the id if the entry judges no edit of that conversion.',
      ).toEqual([]);
      // Anti-vacuity: at least one link exists, so the loop above read something.
      expect(links).toBeGreaterThan(0);
    });

    it('the decision-mode pair joins end to end: the chain carries the link onto the TODO, and it names the applied edits', () => {
      const JUDGE = 'flow-decision-edge-branching-first-match';
      const CONVERSION = 'flow-decision-mode-inclusive-explicit';
      const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION)!;
      expect(conversion.toMajor).toBe(18);

      const result = applyMetaMigrations(conversion.fixture.before, 17, 18);
      const todo = result.todos.find((t) => t.id === JUDGE);
      expect(todo?.conversionIds).toEqual([CONVERSION]);

      // The join a printer makes: the applied edits whose `conversionId` the TODO names.
      const judged = result.applied.filter((a) => todo!.conversionIds!.includes(a.conversionId));
      expect(judged.length).toBeGreaterThan(0);
      expect(new Set(judged.map((a) => a.conversionId))).toEqual(new Set([CONVERSION]));
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

    // The census pin for ruling B (#20201). A graduated conversion is one
    // retirement family's data repair, so from `D3_PER_FAMILY_FROM_MAJOR` on,
    // a step whose D3 list names none of a conversion is a family shipped with
    // its repair and without its judgment — the exact shape the pre-ruling
    // "lossless, so no semantic residue" reasoning produced. What this CANNOT
    // see, stated so a green run is not over-read: (1) whether the entry that
    // names a conversion is that family's OWN — a passing mention satisfies it,
    // so ownership was judged by reading, in the census; (2) a family retired
    // with no conversion at all — no machine-readable link joins a retired key
    // or def to its D3 entry, so those were paired by reading too.
    it('from protocol 18 on, every graduated D2 conversion is named by a D3 entry of its own step (ruling B)', () => {
      const checked = MIGRATION_MAJORS.filter((m) => m >= D3_PER_FAMILY_FROM_MAJOR);
      // Anti-vacuity: the major this rule was first measured on is in range.
      expect(checked).toContain(D3_PER_FAMILY_FROM_MAJOR);
      const unnamed: string[] = [];
      let pairs = 0;
      for (const m of checked) {
        const sources = semanticEntrySources(m);
        for (const id of MIGRATIONS_BY_MAJOR[m]!.conversionIds) {
          if (entriesNaming(sources, id).length === 0) unnamed.push(`protocol ${m}: ${id}`);
          else pairs++;
        }
      }
      expect(
        unnamed,
        `graduated D2 conversion(s) named by no D3 entry of their own step: ${unnamed.join(', ')}. `
          + 'Remedy: add a D3 `semantic` entry of that step — a file under `entries/semantic/` '
          + 'prefixed with its protocol major, then `gen:migration-registry` — whose text names the '
          + 'conversion id as a whole word and says what judgment the consumer still owes after D2 '
          + 'repaired the data (one D3 entry per retirement family, even when D2 is lossless).',
      ).toEqual([]);
      expect(pairs).toBeGreaterThan(0);
    });

    it('the census pin sees a family that has its entry, and not a prefix of a longer id', () => {
      // Control for the pin above: a pair that predates the census, so the
      // matcher is proven to find a family's entry by reading the files at all.
      const sources18 = semanticEntrySources(18);
      expect(entriesNaming(sources18, 'cube-join-sql-and-relationship-removed')).toContain(
        '18.cube-join-sql-and-relationship-retired.ts',
      );
      // Whole-id match: `record-chatter-position-vocabulary` is a prefix of its
      // D3 entry's own id, so only the entry's real citation of the conversion
      // may count, never its id line.
      expect(entriesNaming(sources18, 'record-chatter-position-vocabulary')).toContain(
        '18.record-chatter-position-vocabulary-converged.ts',
      );
      const idLineOnly = new Map([['x.ts', "id: 'record-chatter-position-vocabulary-converged'"]]);
      expect(entriesNaming(idLineOnly, 'record-chatter-position-vocabulary')).toEqual([]);
    });

    it('the support floor is at or below the earliest step', () => {
      expect(MIGRATION_SUPPORT_FLOOR).toBeLessThanOrEqual(MIGRATION_MAJORS[0]!);
    });

    // #19056 raised the floor 10 → 16 and retired `step11`–`step16` with it.
    // The assertion above is satisfied by a chain with NO step at all, so it
    // cannot see either half of what a floor move has to leave behind.
    it('no step survives at or below the floor — a step the chain cannot reach is dead code', () => {
      // `composeMigrationChain(from, to)` keeps `m > from`, so a step at or
      // below the floor is replayed by no supported `--from`, and CI stops
      // proving it still works while it keeps reading as a promise.
      expect(MIGRATION_MAJORS.filter((m) => m <= MIGRATION_SUPPORT_FLOOR)).toEqual([]);
    });

    it('`--from <floor>` is a usable command — the floor+1 hop exists', () => {
      // The other half: raising the floor to a major with no step above it
      // would leave `migrate meta --from <floor>` a no-op that reports success.
      const chain = composeMigrationChain(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR);
      expect(chain.length).toBeGreaterThan(0);
      expect(chain[0]!.toMajor).toBe(MIGRATION_SUPPORT_FLOOR + 1);
    });
  });

  // The D3 half of a node-level refusal, and the one class of entry whose
  // ABSENCE is invisible to every other gate in this family: `check:spec-changes`
  // and `check:upgrade-guide` pin the registry to its PROJECTIONS, so an entry
  // that was never written leaves them perfectly consistent. What made the gap
  // reachable is that the two D2 conversions below are deliberately partial —
  // they strip the props and leave the node, because deleting an authored page
  // node is a layout decision a mechanical conversion must not make — while
  // `RETIRED_PAGE_COMPONENT_TYPES` now refuses that same node BY NAME. Between
  // the two, a 17 → 18 replay ended `schemaValid: false` and `os migrate meta`
  // closed with "resolve the manual changes above" over a list that named
  // neither element. This block pins the instruction back into the list.
  describe('protocol-18 element:filter / element:form entry — the chain NAMES the bare node it leaves standing', () => {
    /** A page authored against 17, carrying both retired elements. */
    const authored = () => ({
      pages: [
        {
          name: 'order_board',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'element:filter', properties: { object: 'order', fields: ['status'] } },
                { type: 'element:form', properties: { object: 'order', fields: ['status'] } },
              ],
            },
          ],
        },
      ],
    });

    const entry = () =>
      MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === 'element-filter-and-form-node-refused');

    it('finds the entry (anti-vacuity: every assertion below reads through this `find`)', () => {
      expect(entry()).toBeDefined();
      expect(entry()!.surface).toMatch(/element:filter/);
      expect(entry()!.surface).toMatch(/element:form/);
    });

    it('the replay really does leave the bare nodes — the residue this TODO is about', () => {
      const result = applyMetaMigrations(authored(), 17, 18);
      const ids = new Set(result.applied.map((a) => a.conversionId));
      expect(ids.has('element-filter-removed')).toBe(true);
      expect(ids.has('element-form-removed')).toBe(true);

      // Both nodes survive the chain, stripped bare. If a conversion ever starts
      // deleting them this line fails, and this entry's premise is what should be
      // revisited — not this expectation.
      const components = (result.stack.pages as any[])[0].regions[0].components;
      expect(components.map((c: any) => c.type)).toEqual(['element:filter', 'element:form']);
      expect(components[0].properties).toEqual({});
      expect(components[1].properties).toEqual({});
    });

    it('a 17 → 18 run emits exactly one todo naming BOTH node types (ADR-0087 D3)', () => {
      const result = applyMetaMigrations(authored(), 17, 18);
      const naming = result.todos.filter(
        (t) => /element:filter/.test(t.surface) && /element:form/.test(t.surface),
      );
      expect(naming).toHaveLength(1);
      expect(naming[0]!.id).toBe('element-filter-and-form-node-refused');
      expect(naming[0]!.toMajor).toBe(18);
    });

    it('prescribes DELETING the node, and names each element\'s replacement', () => {
      // The two replacements are the ones `RETIRED_PAGE_COMPONENT_TYPES` already
      // sends an author to at the parse; pinned here so the two doors cannot
      // drift into prescribing different things.
      const r = entry()!.replacement;
      expect(r).toMatch(/Delete the component node/);
      expect(r).toMatch(/userFilters/);
      expect(r).toMatch(/object-form/);
    });

    it('⛔ does not prescribe an automatic delete — the conversions must not make it', () => {
      const text = `${entry()!.replacement} ${entry()!.reason}`;
      expect(text).toMatch(/layout/i);
      expect(text).not.toMatch(/the conversion (deletes|removes) the node/i);
    });

    it('the acceptance criterion is checkable, and names `os validate` (the card\'s bar)', () => {
      const a = entry()!.acceptanceCriteria;
      expect(a).toMatch(/os validate/);
      // Named at the node's own path, so a remaining node is reported
      // individually rather than as one page-level failure.
      expect(a).toMatch(/retiredComponentType/);
      // Regions, slots and nested containers — the three places the conversions
      // walk, and therefore the three places a bare node can be left.
      expect(a).toMatch(/slots/);
      expect(a).toMatch(/nested containers/);
    });
  });

  describe('composition (cross-major is the designed-for case)', () => {
    it('composes only the steps in (from, to]', () => {
      const chain = composeMigrationChain(MIGRATION_SUPPORT_FLOOR, MIGRATION_SUPPORT_FLOOR + 1);
      expect(chain.map((s) => s.toMajor)).toEqual([MIGRATION_SUPPORT_FLOOR + 1]);
    });

    it('a consumer already at current gets an empty chain', () => {
      expect(composeMigrationChain(PROTOCOL_MAJOR, PROTOCOL_MAJOR)).toHaveLength(0);
    });

    it('refuses a from-major below the support floor', () => {
      expect(() => applyMetaMigrations({}, MIGRATION_SUPPORT_FLOOR - 1)).toThrow(MigrationFloorError);
    });

    // The cost #19056 bought, pinned where it is paid: a consumer stopped at
    // any major the floor move dropped gets a refusal, not a silent no-op
    // chain. The refusal names the floor and the other path, which is the
    // whole prescription those consumers have.
    it('every major the floor move to 16 dropped is refused, by name', () => {
      for (const from of [10, 11, 12, 13, 14, 15]) {
        let thrown: unknown;
        try {
          applyMetaMigrations({}, from);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(MigrationFloorError);
        const err = thrown as MigrationFloorError;
        expect(err.fromMajor).toBe(from);
        expect(err.floor).toBe(MIGRATION_SUPPORT_FLOOR);
        expect(err.message).toContain(`support floor is ${MIGRATION_SUPPORT_FLOOR}`);
      }
    });
  });

  describe('replay — the chain applies the graduated mechanical transforms', () => {
    // These used to replay a 10.x stack through `step11`. #19056 raised the
    // floor to 16 and retired `step11`–`step16` with it, so the oldest hop the
    // chain still guarantees is FLOOR → FLOOR + 1 and the shapes are that
    // hop's. Written against the constant rather than the literal 16: the next
    // floor move should re-point this replay, not delete it.
    const OLDEST_HOP = MIGRATION_SUPPORT_FLOOR + 1;
    // Two protocol-17 shapes the oldest hop (17 → 18) rewrites: a job's
    // `timeout` (renamed to `timeoutMs`) and an object's `externalSharingModel`
    // (removed). The pair this used to drive (`execute` → `target`,
    // `conditionalRequired` → `requiredWhen`) rode the 16 → 17 step, which
    // aged out with the 16.x kits (#25767).
    const oldShape = () => ({
      jobs: [{
        name: 'nightly_health_sweep',
        schedule: { type: 'cron', expression: '0 1 * * *' },
        handler: 'sweepProjectHealth',
        timeout: 300000,
      }],
      objects: [
        { name: 'portal_case', label: 'Case', sharingModel: 'public_read', externalSharingModel: 'private' },
      ],
    });

    it('migrates the oldest supported major\'s shapes to canonical', () => {
      const result = applyMetaMigrations(oldShape(), MIGRATION_SUPPORT_FLOOR, OLDEST_HOP);

      const job = (result.stack.jobs as any[])[0];
      expect(job).not.toHaveProperty('timeout');
      expect(job.timeoutMs).toBe(300000);
      const object = (result.stack.objects as any[])[0];
      expect(object).not.toHaveProperty('externalSharingModel');
      expect(object.sharingModel).toBe('public_read');

      // Two mechanical rewrites, named — a count alone would survive one of
      // them being replaced by an unrelated conversion firing on this shape.
      expect([...new Set(result.applied.map((a) => a.conversionId))].sort()).toEqual([
        'job-timeout-to-timeout-ms',
        'object-external-sharing-model-removed',
      ]);
      // Semantic TODOs are advisory per-major and always surfaced for the hop,
      // whatever the stack contains.
      expect(result.todos.map((t) => t.id).sort()).toEqual(
        MIGRATIONS_BY_MAJOR[OLDEST_HOP]!.semantic.map((s) => s.id).sort(),
      );
      expect(result.todos.length).toBeGreaterThan(0);
      // `absentTodos` only NAMES a subset of them — the same objects, never a
      // removal (`semantic-relevance.test.ts` pins which entries can be named).
      for (const t of result.absentTodos) expect(result.todos).toContain(t);
      expect(result.absentTodos.filter((t) => !t.relevantWhen)).toEqual([]);
    });

    it('is immutable — the input stack is not mutated', () => {
      const stack = oldShape();
      const snapshot = structuredClone(stack);
      applyMetaMigrations(stack, MIGRATION_SUPPORT_FLOOR, OLDEST_HOP);
      expect(stack).toEqual(snapshot);
    });

    it('checkpoints each hop for per-hop verify / bisection', () => {
      const result = applyMetaMigrations(oldShape(), MIGRATION_SUPPORT_FLOOR, OLDEST_HOP);
      expect(result.hops).toHaveLength(1);
      expect(result.hops[0]!.toMajor).toBe(OLDEST_HOP);
      expect((result.hops[0]!.stack.jobs as any[])[0].timeoutMs).toBe(300000);
    });
  });

  describe('chain-replay from every conversion fixture (CI composability gate)', () => {
    // Each graduated conversion's old-shape fixture must reach canonical when
    // replayed through the full chain from the support floor — a composability
    // break is a release blocker (ADR-0087 D3), caught here, not by a consumer.
    //
    // Scoped to the conversions the chain can still REACH. `composeMigrationChain`
    // keeps `m > fromMajor`, so a conversion graduated at or below the floor has
    // no hop to replay through and its fixture would arrive unconverted — a red
    // that says nothing about composability. #19056 moved the floor 10 → 16 and
    // this is where that lands.
    const replayable = ALL_CONVERSIONS.filter((c) => c.toMajor > MIGRATION_SUPPORT_FLOOR);
    const belowFloor = ALL_CONVERSIONS.filter((c) => c.toMajor <= MIGRATION_SUPPORT_FLOOR);

    it('the gate has cases — anti-vacuity, since every case below reads through this filter', () => {
      expect(replayable.length).toBeGreaterThan(0);
      expect(replayable.length + belowFloor.length).toBe(ALL_CONVERSIONS.length);
    });

    it('a below-floor conversion is excluded for having no hop — it is NOT deregistered', () => {
      // D2 conversions are deliberately not floor-scoped: every rehydration
      // seam replays the FULL conversion chain over stored `sys_metadata`
      // rows, retired entries included (ADR-0087 addendum), so these keep
      // converting rows at rest long after the source-side chain stops
      // reaching them. What the floor removed is the D3 step that carried
      // them, which is exactly why they leave this gate and nothing else.
      for (const c of belowFloor) {
        expect(ALL_CONVERSIONS).toContain(c);
        expect(composeMigrationChain(MIGRATION_SUPPORT_FLOOR, c.toMajor)).toEqual([]);
      }
    });

    for (const conversion of replayable) {
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
  // The range is the SUPPORTED one. `composeSpecChanges` is a pure projection
  // with no floor check of its own, so a range below the floor still composes —
  // it just projects steps that no longer exist and quietly reports nothing.
  const HOP_FROM = MIGRATION_SUPPORT_FLOOR;
  const HOP_TO = MIGRATION_SUPPORT_FLOOR + 1;

  it('composes conversions + semantic migrations across the range', () => {
    const changes = composeSpecChanges(HOP_FROM, HOP_TO);
    expect(changes.from).toBe(HOP_FROM);
    expect(changes.to).toBe(HOP_TO);
    expect(changes.converted.map((c) => c.conversionId).sort()).toEqual(
      (CONVERSIONS_BY_MAJOR[HOP_TO] ?? []).map((c) => c.id).sort(),
    );
    expect(changes.migrated.map((m) => m.migrationId).sort()).toEqual(
      MIGRATIONS_BY_MAJOR[HOP_TO]!.semantic.map((s) => s.id).sort(),
    );
    // Anti-vacuity: both sides are read off the registry, so empty on both
    // sides would pass while projecting nothing at all.
    expect(changes.converted.length).toBeGreaterThan(0);
    expect(changes.migrated.length).toBeGreaterThan(0);
  });

  it('validates against its own schema', () => {
    const changes = composeSpecChanges(HOP_FROM, HOP_TO, {
      added: [{ surface: 'applyConversions (function)', since: HOP_TO }],
      removed: [{ surface: 'actionExecute (const)', removedIn: HOP_TO, replacement: 'action.target' }],
    });
    expect(SpecChangesSchema.safeParse(changes).success).toBe(true);
  });

  it('per-major manifests compose into one aggregate view', () => {
    // The fold over every supported major must match one direct aggregate.
    const direct = composeSpecChanges(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR);
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

describe('per-release section (ADR-0087 D4, package-version resolution)', () => {
  const aggregate = composeSpecChanges(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR);
  const allConversionIds = aggregate.converted.map((c) => c.conversionId);
  const allMigrationIds = aggregate.migrated.map((m) => m.migrationId);

  it('reports only the registry entries this release added', () => {
    // The previous release carried everything but the first conversion, so that
    // one — and nothing else — is new in this release.
    const [firstNew, ...alreadyPublished] = allConversionIds;
    const release = composeReleaseChanges(
      '17.3.0',
      '17.4.0',
      aggregate,
      { conversionIds: alreadyPublished, migrationIds: allMigrationIds },
      { added: [], removed: [] },
    );
    expect(release.converted.map((c) => c.conversionId)).toEqual([firstNew]);
    expect(release.migrated).toHaveLength(0);
    expect(SpecReleaseChangesSchema.safeParse(release).success).toBe(true);
  });

  it('carries the export delta the two artifacts show, sorted', () => {
    const release = composeReleaseChanges(
      '17.3.0',
      '17.4.0',
      aggregate,
      { conversionIds: allConversionIds, migrationIds: allMigrationIds },
      { added: ['./ui: Zed (const)', './ai: Alpha (const)'], removed: ['./integration: Gone (type)'] },
    );
    expect(release.added.map((a) => a.surface)).toEqual(['./ai: Alpha (const)', './ui: Zed (const)']);
    expect(release.removed.map((r) => r.surface)).toEqual(['./integration: Gone (type)']);
    expect(release.fromVersion).toBe('17.3.0');
    expect(release.toVersion).toBe('17.4.0');
  });

  it('a release that moved nothing is four empty arrays, not a missing section', () => {
    // The section is OMITTED when the delta cannot be computed; when it CAN be
    // and is empty, the emptiness is the answer and must survive the schema.
    const release = composeReleaseChanges(
      '17.4.0',
      '17.4.1',
      aggregate,
      { conversionIds: allConversionIds, migrationIds: allMigrationIds },
      { added: [], removed: [] },
    );
    expect(release.added).toHaveLength(0);
    expect(release.removed).toHaveLength(0);
    expect(release.converted).toHaveLength(0);
    expect(release.migrated).toHaveLength(0);
    expect(SpecReleaseChangesSchema.safeParse(release).success).toBe(true);
  });

  it('⛔ never re-attributes a release entry to a protocol MAJOR', () => {
    // The section's own from/to is the exact attribution; a `since: 17` beside
    // it would offer a coarser number in the one place a finer one is known —
    // the defect the section exists to close. The schema refuses the old shape.
    const release = composeReleaseChanges(
      '17.3.0',
      '17.4.0',
      aggregate,
      { conversionIds: allConversionIds, migrationIds: allMigrationIds },
      { added: ['./ai: Alpha (const)'], removed: [] },
    );
    expect(release.added[0]).toEqual({ surface: './ai: Alpha (const)' });
    expect(Object.keys(release.added[0])).not.toContain('since');
  });
});
