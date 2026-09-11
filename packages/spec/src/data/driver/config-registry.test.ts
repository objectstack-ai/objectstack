// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { DatasourceSchema } from '../datasource.zod';
import {
  BUILTIN_DRIVER_IDS,
  type BuiltinDriverId,
  DATABASE_DRIVER_SELECTION_ALIASES,
  DATABASE_DRIVER_SELECTION_IDS,
  DRIVER_CONFIG_SCHEMAS,
  DRIVER_ID_ALIASES,
  driverHasLocalDefault,
  getDriverConfigJsonSchemaById,
  getDriverConfigSchema,
  resolveDatabaseDriverId,
  resolveDriverId,
  validateDriverConfig,
} from './config-registry.zod';

describe('driver config registry', () => {
  it('ships a schema and a JSON-Schema projection for every canonical id', () => {
    for (const id of BUILTIN_DRIVER_IDS) {
      expect(DRIVER_CONFIG_SCHEMAS[id], id).toBeTruthy();
      const json = getDriverConfigJsonSchemaById(id) as { type?: string; properties?: object };
      expect(json.type, id).toBe('object');
      expect(json.properties, id).toBeTruthy();
    }
  });

  it('memoizes each projection so the form and the gate share one object', () => {
    expect(getDriverConfigJsonSchemaById('postgres')).toBe(getDriverConfigJsonSchemaById('postgres'));
  });

  it('resolves every alias onto a canonical id that has a contract', () => {
    for (const [alias, canonical] of Object.entries(DRIVER_ID_ALIASES)) {
      expect(resolveDriverId(alias), alias).toBe(canonical);
      expect(BUILTIN_DRIVER_IDS).toContain(canonical);
    }
  });

  it('resolves case- and whitespace-insensitively', () => {
    expect(resolveDriverId('  PostgreSQL ')).toBe('postgres');
    // `mongodb`, not `mongo`, since #6345 renamed the canonical id.
    expect(resolveDriverId('MongoDB')).toBe('mongodb');
    expect(resolveDriverId(' Mongo ')).toBe('mongodb');
  });

  /**
   * The distinction the whole gate rests on: "nothing to check against" is not
   * the same answer as "checked and clean", and a caller that conflates them
   * reintroduces the silence #4410 removed.
   */
  it('reports an unknown driver as unknown rather than as valid', () => {
    expect(resolveDriverId('com.vendor.snowflake')).toBeUndefined();
    expect(getDriverConfigSchema('com.vendor.snowflake')).toBeUndefined();
    expect(validateDriverConfig('com.vendor.snowflake', { whatever: 1 })).toEqual({ known: false });
  });

  it('validates a known driver and returns path-relative issues', () => {
    const result = validateDriverConfig('pg', { database: 'app', hostname: 'db.internal' });

    expect(result.known).toBe(true);
    expect(result).toHaveProperty('issues');
    const issues = (result as { issues: Array<{ path: unknown[]; message: string }> }).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('`hostname` → `host`');
  });
});

describe('DatasourceSchema × driver config (#4410)', () => {
  const base = { name: 'warehouse', driver: 'postgres' };

  /**
   * The reported bug, verbatim: the correct key is `host`, `hostname` was
   * accepted in silence, and the datasource then connected to localhost while
   * reporting success — which for an AI author is indistinguishable from having
   * configured it.
   */
  it('rejects a misspelled connection key inside config, pathed at the key', () => {
    const result = DatasourceSchema.safeParse({
      ...base,
      config: { hostname: 'db.internal', database: 'analytics' },
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['config']);
    expect(result.error!.issues[0]!.message).toContain('`hostname` → `host`');
  });

  it('accepts the corrected config', () => {
    const result = DatasourceSchema.safeParse({
      ...base,
      config: { host: 'db.internal', database: 'analytics' },
    });

    expect(result.success).toBe(true);
  });

  it('leaves a plugin-contributed driver`s config alone', () => {
    const result = DatasourceSchema.safeParse({
      name: 'warehouse',
      driver: 'com.vendor.snowflake',
      config: { account: 'xy12345', warehouse: 'COMPUTE_WH' },
    });

    expect(result.success).toBe(true);
  });

  it('validates every driver id alias the same way', () => {
    for (const alias of ['pg', 'postgresql', 'POSTGRES']) {
      const result = DatasourceSchema.safeParse({
        name: 'warehouse',
        driver: alias,
        config: { hostname: 'db.internal', database: 'analytics' },
      });
      expect(result.success, alias).toBe(false);
    }
  });

  /**
   * #4410 extended this gate over `readReplicas` too. #4468 retired the key —
   * nothing ever opened a replica connection — so the parse must now REJECT the
   * slot rather than check what goes in it. Pinned here, next to the config
   * cases, because the two are easy to re-conflate: both are per-driver record
   * shapes, and only one of them has a consumer.
   */
  it('rejects readReplicas outright, with the retirement prescription', () => {
    const result = DatasourceSchema.safeParse({
      ...base,
      config: { host: 'db.internal', database: 'analytics' },
      readReplicas: [{ host: 'replica-1.internal', database: 'analytics' }],
    });

    expect(result.success).toBe(false);
    // A well-formed replica block: the rejection is about the key existing at
    // all, not about anything being wrong inside it.
    expect(result.error!.issues[0]!.message).toMatch(
      /`datasource\.readReplicas` was removed.*no query path separates reads from writes.*Delete the key/s,
    );
  });

  it('rejects a sqlite datasource whose filename is misspelled', () => {
    const result = DatasourceSchema.safeParse({
      name: 'local',
      driver: 'sqlite',
      config: { file: './data.db' },
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`file` → `filename`');
  });

  it('still reports the schemaMode/external coherence rule alongside a config problem', () => {
    const result = DatasourceSchema.safeParse({
      name: 'warehouse',
      driver: 'postgres',
      config: { hostname: 'db.internal', database: 'analytics' },
      schemaMode: 'external',
    });

    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('config');
    expect(paths).toContain('external');
  });
});

/**
 * `DATABASE_DRIVER_SELECTION_IDS` — the boot-flag face (#6969).
 *
 * These are PROPERTIES of the projection, not a restatement of it: re-deriving
 * the same `.filter()` here and asserting equality would only pin that the table
 * equals itself. What each case pins is a way the projection could be wrong, and
 * the first one is the way that actually matters — reading the CONFIG-CONTRACT
 * column instead of the SELECTION column silently widens every boot host's flag.
 */
describe('DATABASE_DRIVER_SELECTION_IDS — what a boot flag may offer (#6969)', () => {
  it('offers no contract-only spelling, whatever the derivation is rewritten to read', () => {
    // The wrong-column guard. `sqlite3` / `better-sqlite3` / `mariadb` /
    // `inmemory` resolve a config CONTRACT and are refused as a SELECTION, so a
    // projection built from `DRIVER_ID_ALIASES` (or from `resolveDriverId`) would
    // pass every other case in this file while widening `--database-driver` on
    // both hosts. Derived from the same two functions the hosts use, so a fifth
    // contract-only alias added to the table is covered the day it lands.
    const contractOnly = Object.keys(DRIVER_ID_ALIASES).filter(
      (alias) => resolveDriverId(alias) !== undefined && resolveDatabaseDriverId(alias) === undefined,
    );
    expect(contractOnly.length, 'the table must still HAVE contract-only aliases for this to test anything')
      .toBeGreaterThan(0);
    for (const alias of contractOnly) {
      expect(DATABASE_DRIVER_SELECTION_IDS, `${alias} must not be offered as a boot selection`)
        .not.toContain(alias);
    }
  });

  it('lists only canonical spellings — every entry resolves to itself', () => {
    expect(DATABASE_DRIVER_SELECTION_IDS.length).toBeGreaterThan(0);
    for (const id of DATABASE_DRIVER_SELECTION_IDS) {
      expect(resolveDatabaseDriverId(id), id).toBe(id);
    }
    expect(new Set(DATABASE_DRIVER_SELECTION_IDS).size).toBe(DATABASE_DRIVER_SELECTION_IDS.length);
  });

  it('withholds no driver a boot host can select', () => {
    // The other direction: every selection alias collapses onto a canonical id,
    // and every one of those ids is offered. An id reachable through
    // `OS_DATABASE_DRIVER=pg` but missing from the flag is #6860 exactly.
    const canonicalFromAliases = new Set(
      DATABASE_DRIVER_SELECTION_ALIASES.map((alias) => resolveDatabaseDriverId(alias)),
    );
    expect(canonicalFromAliases).toEqual(new Set(DATABASE_DRIVER_SELECTION_IDS));
  });

  it('is the selectable subset of the ids the platform ships a contract for', () => {
    // Equal contents today, different questions (see the export's docstring):
    // nothing shipped is currently withheld from the flag, and this states that
    // out loud so the day one IS withheld, the change is deliberate and visible
    // here rather than inferred from a diff.
    expect([...DATABASE_DRIVER_SELECTION_IDS].sort()).toEqual([...BUILTIN_DRIVER_IDS].sort());
  });

  it('is frozen, so a consumer cannot mutate the vocabulary it was handed', () => {
    expect(Object.isFrozen(DATABASE_DRIVER_SELECTION_IDS)).toBe(true);
  });
});
/**
 * The OFF-VOCABULARY population — the one the pins above cannot reach (#16903).
 *
 * ⚠ Every existing case in this file iterates `BUILTIN_DRIVER_IDS`,
 * `DRIVER_ID_ALIASES` or a hand-written canonical spelling: exactly the
 * population that behaves. They were all green while
 * `getDriverConfigJsonSchemaById('constructor')` returned `{}` — an EMPTY JSON
 * Schema that accepts every config it is asked to judge — and while
 * `resolveDriverId('constructor')` returned the `Object` FUNCTION out of a
 * signature that says `BuiltinDriverId | undefined`. A pin over canonical ids
 * alone would be green before and after the guard and would prove nothing, so
 * the population is the point of this describe.
 */
describe('driver lookups — an OFF-vocabulary id is refused, never answered with a non-schema (#16903)', () => {
  /**
   * The consumer that actually reaches these, spelled as the cast it is.
   * `getDriverConfigJsonSchemaById` and both resolvers are published
   * (`packages/spec/api-surface/data.json`), so "unreachable in-repo" is not
   * "unreachable": a plain-JS consumer arrives with zero type checking, and for
   * the resolvers the id can also arrive from `OS_DATABASE_DRIVER` or from
   * authored `datasource.driver` metadata — which is exactly where
   * `constructor` and `toString` show up.
   */
  const untypedJsonSchema = (id: string): unknown => getDriverConfigJsonSchemaById(id as BuiltinDriverId);

  /**
   * Words that resolve an INHERITED member, grouped by what the bare lookup did
   * with each before the own-property guard. Measured against the built
   * artifact (`dist/data/index.mjs`) on the Node 22 baseline (v22.22.2).
   */
  const PROTOTYPE_RESOLVABLE_CALLABLE = [
    // Returned a truthy NON-schema — the silent wrong answers, and the reason
    // this is a bug rather than a tidy-up. `constructor` ran `Object()` and gave
    // `{}`; `toString` gave the STRING '[object Object]'; `valueOf` gave the
    // registry object itself.
    'constructor',
    'toString',
    'valueOf',
    // Returned a `boolean` (each called with no argument, receiver = the
    // registry) where the signature promises an object — which is why a
    // truthiness assertion alone cannot catch this family either.
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
  ];

  /**
   * Words with no own key AND nothing callable behind them: `__proto__`
   * resolved `Object.prototype`, the rest resolved `undefined`. Both spellings
   * already threw a `TypeError` off a non-callable, so these are the CONTROLS —
   * the guard must not invent a new failure for input that already failed.
   */
  const ALREADY_THREW = ['__proto__', 'nope', '', 'com.vendor.snowflake'];

  const OFF_VOCABULARY = [...PROTOTYPE_RESOLVABLE_CALLABLE, ...ALREADY_THREW];

  it('holds this population HONEST — every word above is outside the vocabulary', () => {
    // Without this, a spelling promoted into the table would leave every pin
    // below asserting a refusal for a LEGAL id, and they would go on passing
    // while meaning the opposite of what they say.
    for (const word of OFF_VOCABULARY) {
      expect(BUILTIN_DRIVER_IDS as readonly string[], word).not.toContain(word);
      expect(Object.prototype.hasOwnProperty.call(DRIVER_ID_ALIASES, word), word).toBe(false);
    }
  });

  it('throws for an id naming a callable Object.prototype member, instead of returning a non-schema', () => {
    for (const id of PROTOTYPE_RESOLVABLE_CALLABLE) {
      expect(() => untypedJsonSchema(id), id).toThrow(TypeError);
    }
  });

  it('still throws for a plainly absent id, exactly as it always did', () => {
    // The control: `__proto__` and an unknown word threw a `TypeError` before
    // the guard too. The guard is a narrowing, so this assertion must be green
    // on both sides of it — if it moves, the change did more than close a hole.
    for (const id of ALREADY_THREW) {
      expect(() => untypedJsonSchema(id), id).toThrow(TypeError);
    }
  });

  it('names the offending id and the legal vocabulary in every refusal', () => {
    // A bare `.toThrow()` is not a refusal assertion here: two of these words
    // already threw. What distinguishes a REFUSAL from the old incidental
    // `… is not a function` is that the message names the subject and what was
    // expected instead.
    for (const id of OFF_VOCABULARY) {
      let message = '';
      try {
        untypedJsonSchema(id);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, id).toContain('getDriverConfigJsonSchemaById');
      expect(message, id).toContain(JSON.stringify(id));
      for (const canonical of BUILTIN_DRIVER_IDS) {
        expect(message, `${id} → ${canonical}`).toContain(canonical);
      }
    }
  });

  it('still answers every canonical id with its own JSON Schema, unmoved', () => {
    // The narrowing must stop at the vocabulary edge: the guard refuses more and
    // accepts nothing new, so every in-vocabulary answer is byte-identical.
    for (const id of BUILTIN_DRIVER_IDS) {
      const json = getDriverConfigJsonSchemaById(id) as { type?: string; properties?: object };
      expect(json.type, id).toBe('object');
      expect(json.properties, id).toBeTruthy();
    }
    // …and the memoised identity survives the guard.
    expect(getDriverConfigJsonSchemaById('postgres')).toBe(getDriverConfigJsonSchemaById('postgres'));
  });

  it('resolves an off-vocabulary spelling to `undefined`, never to a truthy non-id', () => {
    // `resolveDriverId('constructor')` returned the `Object` FUNCTION and
    // `resolveDriverId('__proto__')` returned `Object.prototype` — both truthy,
    // neither a `BuiltinDriverId`, out of a signature that admits only
    // `BuiltinDriverId | undefined`.
    for (const word of OFF_VOCABULARY) {
      expect(resolveDriverId(word), word).toBeUndefined();
      expect(resolveDatabaseDriverId(word), word).toBeUndefined();
    }
  });

  it('answers `true` for an off-vocabulary driver in driverHasLocalDefault, never `undefined`', () => {
    // The declared return is `boolean` and the doc promises `true` for an id the
    // table does not know. A truthy non-id from `resolveDriverId` used to index
    // `DRIVER_LOCAL_DEFAULT` to `undefined`, so `constructor` and `__proto__`
    // came back `undefined` out of a function declared `boolean`.
    for (const word of OFF_VOCABULARY) {
      expect(typeof driverHasLocalDefault(word), word).toBe('boolean');
      expect(driverHasLocalDefault(word), word).toBe(true);
    }
  });

  it('still answers every canonical id from the vocabulary table, unmoved', () => {
    // The other side of the same edge, for the resolvers.
    for (const id of BUILTIN_DRIVER_IDS) {
      expect(resolveDriverId(id), id).toBe(id);
      expect(resolveDatabaseDriverId(id), id).toBe(id);
    }
    expect(resolveDriverId('  PostgreSQL ')).toBe('postgres');
    expect(resolveDriverId('sqlite3')).toBe('sqlite');
    expect(resolveDatabaseDriverId('sqlite3')).toBeUndefined();
  });
});
