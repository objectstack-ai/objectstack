// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `SemanticMigration.relevantWhen` — the structured, stack-derived question
 * that is the ONE way a semantic entry leaves `os migrate meta`'s default list
 * (ADR-0087 D3, "never silence"; ⛔ never prose-matching `surface`).
 *
 * Four kinds of pin, kept apart:
 *
 * - ENUMERATION: exactly which entries carry a question, and which keys each
 *   names. Adding, widening or narrowing one is therefore a reviewed edit of
 *   the table below, never a side effect of an entry file.
 * - SHAPE: every question is a closed, structured member of
 *   `SemanticRelevance` naming real top-level stack keys.
 * - EVALUATION: the three-valued answer, and that only `absent` — a positive
 *   proof — names anything; whatever the evaluation cannot read is `unknown`.
 * - CHAIN: `applyMetaMigrations` reports every entry of every hop crossed in
 *   `todos`, whatever the stack holds, and `absentTodos` is a SUBSET of it —
 *   the same objects, in chain order — holding only proven-absent entries.
 */

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS } from '../conversions/registry.js';
import { STACK_DEFINITION_KEYS } from '../stack.zod.js';
import { applyMetaMigrations, semanticRelevanceVerdict, semanticTodoAbsent } from './chain.js';
import { MIGRATIONS_BY_MAJOR, MIGRATION_MAJORS, MIGRATION_SUPPORT_FLOOR } from './registry.js';
import type { MigrationTodo, SemanticRelevance } from './types.js';

/**
 * The first batch: the entries whose surface lives ONLY under the named
 * top-level stack keys — no runtime request body, no code door (a direct
 * caller of an exported evaluator or compiler) — and whose acceptance criteria
 * send the author to no stored row and no runtime door. `major:id` → the keys
 * its question names.
 */
const EXPECTED_RELEVANCE: Readonly<Record<string, readonly string[]>> = {
  '17:dashboard-widget-compareto-offset': ['dashboards'],
  '17:declarative-apis-endpoints-live': ['apis'],
  '17:job-retry-policy-constraints-tightened': ['jobs'],
  '17:sharing-rule-recipient-reconcile': ['sharingRules'],
  '17:tool-requires-confirmation-retired': ['tools'],
  '18:agent-memory-store-retired-and-limits-required': ['agents'],
  '18:agent-structured-output-refused-members-retired': ['agents'],
  '18:analytics-cube-public-default-visible-enforced': ['analyticsCubes'],
  '18:analytics-cube-single-granularity-default-enforced': ['analyticsCubes'],
  '18:api-endpoint-cache-ttl-unit-in-key': ['apis'],
  '18:chart-config-aria-retired': ['dashboards', 'reports', 'pages'],
  '18:cube-join-sql-and-relationship-retired': ['analyticsCubes'],
  '18:cube-member-inner-name-retired': ['analyticsCubes'],
  '18:cube-member-sql-expression-retired': ['analyticsCubes'],
  '18:cube-metric-expression-types-retired': ['analyticsCubes'],
  '18:cube-metric-filters-retired': ['analyticsCubes'],
  '18:cube-refresh-key-retired': ['analyticsCubes'],
  '18:dashboard-header-modal-target-page-only': ['dashboards'],
  '18:dashboard-refresh-interval-unit-in-key': ['dashboards'],
  '18:dataset-measure-aggregate-field-type-refused': ['datasets'],
  '18:dataset-measure-selecting-aggregate-field-type-refused': ['datasets'],
  '18:hook-timeout-unit-in-key': ['hooks'],
  '18:job-timeout-unit-in-key': ['jobs'],
  '18:mapping-lookup-params-retired': ['mappings'],
  '18:permission-restore-purge-bits-retired': ['permissions'],
};

/** The keys the evaluation reads as carriers of other definitions, never as a family. */
const CARRIER_KEYS = ['manifest', 'packages', 'plugins', 'devPlugins', 'tiers'];

/** Every registered entry, with the major whose step carries it. */
const ENTRIES = MIGRATION_MAJORS.flatMap((major) =>
  MIGRATIONS_BY_MAJOR[major]!.semantic.map((entry) => ({ major, entry })),
);

const cubes = (keys: readonly string[]): SemanticRelevance =>
  ({ kind: 'stack-declares', keys }) as unknown as SemanticRelevance;

describe('which entries carry a relevance question (ENUMERATION)', () => {
  it('is exactly the reviewed table — no entry gains, loses or changes one silently', () => {
    const actual: Record<string, readonly string[]> = {};
    for (const { major, entry } of ENTRIES) {
      if (entry.relevantWhen) actual[`${major}:${entry.id}`] = entry.relevantWhen.keys;
    }
    expect(actual).toEqual(EXPECTED_RELEVANCE);
  });

  it('is 25 entries: 5 of protocol 17 and 20 of protocol 18', () => {
    const keys = Object.keys(EXPECTED_RELEVANCE);
    expect(keys).toHaveLength(25);
    expect(keys.filter((k) => k.startsWith('17:'))).toHaveLength(5);
    expect(keys.filter((k) => k.startsWith('18:'))).toHaveLength(20);
  });

  it('the table names only registered entries (anti-vacuity for the comparison above)', () => {
    const registered = new Set(ENTRIES.map(({ major, entry }) => `${major}:${entry.id}`));
    expect(Object.keys(EXPECTED_RELEVANCE).filter((k) => !registered.has(k))).toEqual([]);
    expect(Object.keys(EXPECTED_RELEVANCE).length).toBeGreaterThan(0);
  });
});

describe('every relevance question is a closed, structured question over top-level stack keys (SHAPE)', () => {
  const declared = new Set<string>(STACK_DEFINITION_KEYS);
  const questions = ENTRIES.filter(({ entry }) => entry.relevantWhen);

  it('names one or more distinct keys the stack definition declares, and no carrier key', () => {
    expect(declared.size).toBeGreaterThan(CARRIER_KEYS.length);
    for (const { major, entry } of questions) {
      const q = entry.relevantWhen!;
      const label = `protocol ${major}: ${entry.id}`;
      expect(q.kind, label).toBe('stack-declares');
      expect(q.keys.length, label).toBeGreaterThan(0);
      expect(new Set(q.keys).size, `${label}: duplicate key`).toBe(q.keys.length);
      for (const key of q.keys) {
        expect(declared.has(key), `${label}: \`${key}\` is not a stack key`).toBe(true);
        expect(CARRIER_KEYS.includes(key), `${label}: \`${key}\` is a carrier, not a family`).toBe(false);
      }
    }
  });

  it('carries no free text — the question is its two structured fields and nothing else', () => {
    for (const { entry } of questions) {
      expect(Object.keys(entry.relevantWhen!).sort()).toEqual(['keys', 'kind']);
    }
  });

  it('an entry that judges a conversion is listed on that conversion\'s own fixture', () => {
    // The applied edit is a proof the surface is there; the question must not
    // contradict it on the fixture the conversion is tested with.
    let checked = 0;
    for (const { major, entry } of questions) {
      for (const id of entry.conversionIds ?? []) {
        const conversion = ALL_CONVERSIONS.find((c) => c.id === id)!;
        const result = applyMetaMigrations(
          structuredClone(conversion.fixture.before) as Record<string, unknown>,
          MIGRATION_SUPPORT_FLOOR,
          major,
        );
        expect(result.todos.some((t) => t.id === entry.id), `${entry.id} reported on ${id}'s fixture`).toBe(true);
        expect(result.absentTodos.some((t) => t.id === entry.id), `${entry.id} not named absent on ${id}'s fixture`)
          .toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('the answer is three-valued, and only a positive proof is `absent` (EVALUATION)', () => {
  const q = cubes(['analyticsCubes']);

  it('a key that is missing, or an empty array or map, is absent', () => {
    expect(semanticRelevanceVerdict(q, [{}])).toBe('absent');
    expect(semanticRelevanceVerdict(q, [{ objects: [{ name: 'a' }] }])).toBe('absent');
    expect(semanticRelevanceVerdict(q, [{ analyticsCubes: [] }])).toBe('absent');
    expect(semanticRelevanceVerdict(q, [{ analyticsCubes: {} }])).toBe('absent');
  });

  it('a non-empty array or map — the authored map form included — is present', () => {
    expect(semanticRelevanceVerdict(q, [{ analyticsCubes: [{ name: 'c' }] }])).toBe('present');
    expect(semanticRelevanceVerdict(q, [{ analyticsCubes: { c: { sql: 't' } } }])).toBe('present');
  });

  it('any one of several keys being present is present', () => {
    const two = cubes(['permissions', 'sharingRules']);
    expect(semanticRelevanceVerdict(two, [{ sharingRules: [{ name: 'r' }] }])).toBe('present');
    expect(semanticRelevanceVerdict(two, [{ permissions: [], sharingRules: [] }])).toBe('absent');
  });

  it('a value the question cannot read is unknown, never absent', () => {
    expect(semanticRelevanceVerdict(q, [{ analyticsCubes: () => [] }])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [{ analyticsCubes: null }])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [{ analyticsCubes: 'cubes' }])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [{ analyticsCubes: Promise.resolve([]) }])).toBe('unknown');
    const throwing = Object.defineProperty({}, 'analyticsCubes', {
      enumerable: true,
      get() {
        throw new Error('computed key');
      },
    });
    expect(semanticRelevanceVerdict(q, [throwing])).toBe('unknown');
  });

  it('a stack that is not a plain object, or no stack at all, is unknown', () => {
    class Bundle {}
    expect(semanticRelevanceVerdict(q, [new Bundle()])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [undefined])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [[]])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [])).toBe('unknown');
  });

  it('a listed plugin makes every key unknown, since it can register metadata the stack does not show', () => {
    class SomePlugin {}
    expect(semanticRelevanceVerdict(q, [{ plugins: [new SomePlugin()] }])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [{ plugins: ['@acme/crm'] }])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [{ devPlugins: ['@acme/dev'] }])).toBe('unknown');
    // …but a key the stack visibly declares is still present.
    expect(semanticRelevanceVerdict(q, [{ plugins: [new SomePlugin()], analyticsCubes: [{}] }])).toBe('present');
    // An empty plugin list proves nothing is contributed.
    expect(semanticRelevanceVerdict(q, [{ plugins: [], devPlugins: [] }])).toBe('absent');
  });

  it('a declared `tiers` preset makes every key unknown too, since a tier loads platform plugins', () => {
    expect(semanticRelevanceVerdict(q, [{ tiers: ['ai'] }])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [{ tiers: ['core', 'ui'], objects: [{ name: 'a' }] }])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [{ tiers: () => ['ai'] }])).toBe('unknown');
    // …a key the stack visibly declares is still present, and an empty list loads nothing.
    expect(semanticRelevanceVerdict(q, [{ tiers: ['ai'], analyticsCubes: [{}] }])).toBe('present');
    expect(semanticRelevanceVerdict(q, [{ tiers: [] }])).toBe('absent');
  });

  it('an assembled package body counts like the top level, and an unreadable one is unknown', () => {
    const body = (manifest: unknown) => ({ packages: [{ manifest: { id: 'p', objects: [{}] } }, { manifest }] });
    expect(semanticRelevanceVerdict(q, [body({ id: 'q', analyticsCubes: [{ name: 'c' }] })])).toBe('present');
    expect(semanticRelevanceVerdict(q, [body({ id: 'q' })])).toBe('absent');
    expect(semanticRelevanceVerdict(q, [{ packages: [{ manifest: 'com.example.q' }] }])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [{ packages: ['com.example.q'] }])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [{ packages: { q: {} } }])).toBe('unknown');
  });

  it('over several checkpoints: present anywhere is present, and absent needs every one', () => {
    const withCubes = { analyticsCubes: [{ name: 'c' }] };
    expect(semanticRelevanceVerdict(q, [withCubes, {}])).toBe('present');
    expect(semanticRelevanceVerdict(q, [{}, withCubes])).toBe('present');
    expect(semanticRelevanceVerdict(q, [{}, { analyticsCubes: () => [] }])).toBe('unknown');
    expect(semanticRelevanceVerdict(q, [{}, {}])).toBe('absent');
  });

  it('an entry that judges an applied conversion stays listed whatever its question answers', () => {
    const todo: MigrationTodo = {
      id: 'synthetic-judge',
      surface: 'analyticsCubes[].x',
      replacement: 'y',
      reason: 'r',
      acceptanceCriteria: 'a',
      conversionIds: ['some-conversion'],
      relevantWhen: cubes(['analyticsCubes']),
      toMajor: 18,
    };
    expect(semanticTodoAbsent(todo, [{}], new Set())).toBe(true);
    expect(semanticTodoAbsent(todo, [{}], new Set(['some-conversion']))).toBe(false);
    expect(semanticTodoAbsent({ ...todo, relevantWhen: undefined }, [{}], new Set())).toBe(false);
  });
});

describe('todos reports every entry; absentTodos names the proven-absent subset (CHAIN)', () => {
  const TO = Math.max(...MIGRATION_MAJORS);
  /** A stack that declares objects only — none of the first batch's keys. */
  const OBJECTS_ONLY = {
    manifest: { id: 'com.example.relevance', name: 'relevance', version: '1.0.0', type: 'app' },
    objects: [{ name: 'rel_thing', label: 'Thing', fields: { title: { type: 'text', label: 'Title' } } }],
  };

  function crossed(from: number, to: number): string[] {
    return MIGRATION_MAJORS.filter((m) => m > from && m <= to).flatMap((m) =>
      MIGRATIONS_BY_MAJOR[m]!.semantic.map((s) => `${m}:${s.id}`),
    );
  }
  const ids = (todos: readonly MigrationTodo[]) => todos.map((t) => `${t.toMajor}:${t.id}`);

  it('todos holds every crossed entry, in chain order, whatever the stack holds', () => {
    for (const stack of [structuredClone(OBJECTS_ONLY), {}]) {
      const result = applyMetaMigrations(stack, MIGRATION_SUPPORT_FLOOR, TO);
      expect(ids(result.todos)).toEqual(crossed(MIGRATION_SUPPORT_FLOOR, TO));
      expect(result.hops.flatMap((h) => ids(h.todos))).toEqual(ids(result.todos));
    }
  });

  it('on a stack declaring none of the batch\'s keys, absentTodos names exactly the questioned entries', () => {
    const result = applyMetaMigrations(structuredClone(OBJECTS_ONLY), MIGRATION_SUPPORT_FLOOR, TO);
    const expectedAbsent = crossed(MIGRATION_SUPPORT_FLOOR, TO).filter((k) => k in EXPECTED_RELEVANCE);
    expect(expectedAbsent.length).toBeGreaterThan(0);
    expect(ids(result.absentTodos)).toEqual(expectedAbsent);
    expect(result.hops.flatMap((h) => ids(h.absentTodos))).toEqual(ids(result.absentTodos));
  });

  it('absentTodos is a subset of todos — the same objects, in chain order — at chain and hop level', () => {
    const result = applyMetaMigrations(structuredClone(OBJECTS_ONLY), MIGRATION_SUPPORT_FLOOR, TO);
    expect(result.absentTodos.length).toBeGreaterThan(0);
    for (const t of result.absentTodos) expect(result.todos.includes(t), `${t.id} is the todos object`).toBe(true);
    const position = new Map(result.todos.map((t, i) => [t, i]));
    const at = result.absentTodos.map((t) => position.get(t)!);
    expect(at).toEqual(at.slice().sort((a, b) => a - b));
    for (const h of result.hops) {
      for (const t of h.absentTodos) expect(h.todos.includes(t), `hop ${h.toMajor}: ${t.id}`).toBe(true);
      expect(h.todos).toHaveLength(MIGRATIONS_BY_MAJOR[h.toMajor]!.semantic.length);
    }
  });

  it('a stack that declares the key names none of its entries absent', () => {
    const stack = { ...structuredClone(OBJECTS_ONLY), analyticsCubes: [{ name: 'rel_cube', title: 'Cube', sql: 'rel_thing' }] };
    const result = applyMetaMigrations(stack, MIGRATION_SUPPORT_FLOOR, TO);
    const cubeEntries = Object.entries(EXPECTED_RELEVANCE)
      .filter(([, keys]) => keys.includes('analyticsCubes'))
      .map(([k]) => k);
    expect(cubeEntries.length).toBeGreaterThan(0);
    for (const k of cubeEntries) expect(ids(result.todos), k).toContain(k);
    expect(ids(result.absentTodos).filter((k) => cubeEntries.includes(k))).toEqual([]);
  });

  it('a stack listing a plugin, or declaring a tier preset, proves nothing absent', () => {
    class LocalPlugin {}
    for (const extra of [{ plugins: [new LocalPlugin()] }, { tiers: ['core'] }]) {
      const result = applyMetaMigrations({ ...structuredClone(OBJECTS_ONLY), ...extra }, MIGRATION_SUPPORT_FLOOR, TO);
      expect(result.absentTodos).toEqual([]);
      expect(ids(result.todos)).toEqual(crossed(MIGRATION_SUPPORT_FLOOR, TO));
    }
  });

  it('an entry with no question is never named absent, even on an empty stack', () => {
    const result = applyMetaMigrations({}, MIGRATION_SUPPORT_FLOOR, TO);
    const unquestioned = crossed(MIGRATION_SUPPORT_FLOOR, TO).filter((k) => !(k in EXPECTED_RELEVANCE));
    expect(unquestioned.length).toBeGreaterThan(0);
    expect(ids(result.absentTodos).filter((k) => unquestioned.includes(k))).toEqual([]);
    expect(result.absentTodos.every((t) => t.relevantWhen)).toBe(true);
  });
});
