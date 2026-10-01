// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Connector-attached sync RETIRED from the connector — `syncConfig` (the
 * `DataSyncConfig` block: `strategy`, `direction`, `realtimeSync`,
 * `timestampField`, `conflictResolution`, `batchSize`, `deleteMode`, `filters`)
 * and `fieldMappings` (the `ConnectorFieldMapping` list: `source`, `target`,
 * `defaultValue`, `dataType`, `required`, `syncMode`), fourteen keys no engine
 * ever executed. ADR-0049, ruled ENFORCE on the maintainer's criterion for a
 * declared-but-unenforced family — the mainstream has the capability — with the
 * definition MOVED to the target side, where the mainstream binds it: a
 * `mapping` whose `connectorSource` names the connector it pulls from, with a
 * `job` for the cadence (`data/mapping-connector-source.test.ts` pins that
 * binding). This file pins the connector half of the move.
 *
 * Bookkeeping shapes, pinned below:
 *   1. Two `retiredKey()` tombstones on the non-strict `ConnectorBaseSchema` (a
 *      bare deletion would be a SILENT STRIP, ADR-0104), carried by both
 *      published carriers — `ConnectorSchema` and
 *      `DeclarativeConnectorEntrySchema` — so the refusal reaches
 *      `registerConnector`, `stack.connectors[]` and the `/meta/connector`
 *      door. Four `RETIRED_KEYS_BY_MAJOR[18]` rows (two keys × two defs).
 *   2. `DataSyncConfig`, `SyncStrategy`, `ConnectorConflictResolution` and
 *      `ConnectorFieldMapping` leave whole (`RETIRED_DEFS_BY_MAJOR[18]`).
 *   3. The D2 conversion `connector-sync-keys-removed` strips both keys from
 *      `connectors[]` and stored rows — never writing a `mapping`.
 *   4. The family's D3 entry `connector-sync-keys-retired`.
 *
 * On the assertion set (the #13823 precedent): a schema refusal raises a
 * `ZodError` whose issues carry `code` and `path` but no ADR-0112 `status` —
 * that envelope belongs to the API error surface. So these pins assert the
 * strongest set this surface really has: refusal, the issue `code`, the `path`
 * naming WHICH key refused, and the prescription text (where the wording is
 * the contract, pin the wording).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ObjectStackSchema } from '../stack.zod';
import { EXPORT_ENTRY_POINTS, exportNamesOf, holdersOf } from '../../scripts/lib/export-origins-testkit';
import { ConnectorSchema, DeclarativeConnectorEntrySchema, type Connector } from './connector.zod';

/** A well-formed catalog descriptor — every required key, neither retired one. */
const WELL_FORMED = {
  name: 'erp_orders',
  label: 'ERP Orders',
  type: 'api',
} as const;

/** What an author could write under the two keys before the removal — the documented shape. */
const AUTHORED_SYNC = {
  strategy: 'incremental',
  direction: 'import',
  timestampField: 'updated_at',
  conflictResolution: 'latest_wins',
  batchSize: 500,
  deleteMode: 'soft_delete',
} as const;
const AUTHORED_FIELD_MAPPINGS = [
  { source: 'order_no', target: 'order_number', dataType: 'string', required: true, syncMode: 'read_only' },
] as const;

/** Each key's prescription: named, dated to the npm major. */
const PRESCRIPTION = {
  syncConfig: /^`connector\.syncConfig` was removed in @objectstack\/spec 17 \(ADR-0049/,
  fieldMappings: /^`connector\.fieldMappings` was removed in @objectstack\/spec 17 \(ADR-0049/,
} as const;

/**
 * What each prescription must send the author to — the target-side binding, as
 * ruled. `syncConfig` names the cadence owner too; `fieldMappings` names the
 * executed target-side field map.
 */
const POINTS_AT = {
  syncConfig: ['Delete the key', '`mapping`', '`connectorSource`', '`job`', '`rest` or `openapi`'],
  fieldMappings: ['Delete the key', '`mapping`', '`fieldMapping`', '`connectorSource`'],
} as const;

const MIGRATE_SENTENCE =
  /Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand\.$/;

const KEYS = ['syncConfig', 'fieldMappings'] as const;
const AUTHORED: Record<(typeof KEYS)[number], unknown> = {
  syncConfig: AUTHORED_SYNC,
  fieldMappings: AUTHORED_FIELD_MAPPINGS,
};

function issueAt(result: { success: boolean; error?: { issues: readonly { path: PropertyKey[]; code: string; message: string }[] } }, at: string) {
  expect(result.success, `the parse must refuse \`${at}\``).toBe(false);
  return result.error!.issues.find((i) => i.path.join('.') === at);
}

describe('connector sync retirement — the tombstones', () => {
  for (const key of KEYS) {
    it(`REJECTS an authored \`${key}\` at path \`${key}\`, carrying the prescription`, () => {
      const issue = issueAt(ConnectorSchema.safeParse({ ...WELL_FORMED, [key]: AUTHORED[key] }), key);
      expect(issue, `the refusal must name \`${key}\``).toBeDefined();
      // A `retiredKey()` tombstone raises `invalid_type` from its `z.never()` —
      // not `unrecognized_keys`, which would mean the key had simply vanished
      // from a strict shape.
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual([key]);
      expect(issue!.message).toMatch(PRESCRIPTION[key]);
      for (const target of POINTS_AT[key]) expect(issue!.message).toContain(target);
      expect(issue!.message).toMatch(MIGRATE_SENTENCE);
      // Customer-facing text carries the ADR, never a tracker number.
      expect(issue!.message).not.toMatch(/#\d{3,}/);
    });
  }

  it('the `syncConfig` prescription is honest about the binding it points at: pulled when a job drives it, scheduled by nothing yet', () => {
    // The pull executor reads the target-side binding (its ledger rows are
    // `live`), but nothing schedules a pull until the `job` stage lands (the
    // container keeps `authorWarn`), so a prescription that sent the author
    // there as if it ran on its own would be the defect this retirement
    // removes, moved one type over.
    const message = issueAt(ConnectorSchema.safeParse({ ...WELL_FORMED, syncConfig: {} }), 'syncConfig')!.message;
    expect(message).toContain('Its pull runs when a `job` drives it');
    expect(message).toContain('nothing schedules one yet');
  });

  it('refuses EVERY value — an empty block, an empty list, null and a scalar included', () => {
    for (const key of KEYS) {
      for (const value of [AUTHORED[key], {}, [], null, 'incremental']) {
        const issue = issueAt(ConnectorSchema.safeParse({ ...WELL_FORMED, [key]: value }), key);
        expect(issue, `${key}=${JSON.stringify(value)} must be refused AT the key`).toBeDefined();
        expect(issue!.message, `${key}=${JSON.stringify(value)} must carry the prescription`).toMatch(PRESCRIPTION[key]);
      }
    }
  });

  it('the second carrier, a provider-bound instance, the /meta door and `stack.connectors[]` all refuse them — with controls', () => {
    const door = getMetadataTypeSchema('connector');
    expect(door, 'no schema bound for `connector`').toBeDefined();
    const instance = { ...WELL_FORMED, provider: 'rest', providerConfig: { baseUrl: 'https://erp.example.com' } };
    for (const [label, base] of [['descriptor', WELL_FORMED], ['provider-bound instance', instance]] as const) {
      for (const key of KEYS) {
        const withKey = { ...base, [key]: AUTHORED[key] };
        const entry = issueAt(DeclarativeConnectorEntrySchema.safeParse(withKey), key);
        expect(entry, `entry refuses ${key} on a ${label}`).toBeDefined();
        expect(entry!.message).toMatch(PRESCRIPTION[key]);
        // The registry lookup is the real `PUT /meta/connector/:name` entry
        // point: a rebinding that pointed `connector` at some third shape would
        // pass the pin above and still accept the key in production.
        expect(door!.safeParse(withKey).success, `the /meta door refuses ${key} on a ${label}`).toBe(false);
        const stackIssue = issueAt(ObjectStackSchema.safeParse({ connectors: [withKey] }), `connectors.0.${key}`);
        expect(stackIssue, `the stack refusal must locate ${key} on a ${label}`).toBeDefined();
        expect(stackIssue!.message).toMatch(PRESCRIPTION[key]);
      }
      // CONTROL: the same three doors accept the same connector WITHOUT the
      // keys, so every refusal above is attributable to them alone.
      expect(DeclarativeConnectorEntrySchema.safeParse(base).success, `${label} control`).toBe(true);
      expect(door!.safeParse(base).success, `${label} /meta control`).toBe(true);
      expect(ObjectStackSchema.safeParse({ connectors: [base] }).success, `${label} stack control`).toBe(true);
    }
  });

  it('parses a well-formed connector and grows neither property', () => {
    const parsed = ConnectorSchema.parse({ ...WELL_FORMED });
    expect(parsed.name).toBe('erp_orders');
    // CONTROL: the live defaults still apply, so an empty reading below is the
    // retirement and not a schema that stopped emitting.
    expect(parsed.enabled).toBe(true);
    expect(parsed).not.toHaveProperty('syncConfig');
    expect(parsed).not.toHaveProperty('fieldMappings');
  });

  it('the walked shape keeps both keys — the ledger rows and the authorable-surface rows stay reachable', () => {
    for (const [label, schema] of [
      ['base', ConnectorSchema],
      ['entry', DeclarativeConnectorEntrySchema],
    ] as const) {
      const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
      expect(shape, `${label} must expose a read-through shape`).toBeDefined();
      for (const key of KEYS) expect(Object.keys(shape!), `${label} keeps ${key} walkable`).toContain(key);
      expect(Object.keys(shape!), `${label} keeps its live neighbour`).toContain('retryConfig');
    }
  });

  it('fails tsc at the authoring site: the input type of each key is `never`', () => {
    const connector: Connector = {
      ...WELL_FORMED,
      // @ts-expect-error — `syncConfig` is a retiredKey() tombstone: its input type is `never`.
      syncConfig: AUTHORED_SYNC,
      // @ts-expect-error — `fieldMappings` is a retiredKey() tombstone: its input type is `never`.
      fieldMappings: AUTHORED_FIELD_MAPPINGS,
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(ConnectorSchema.safeParse(connector).success).toBe(false);
  });
});

describe('connector sync retirement — the D2 conversion', () => {
  it('a STORED connector row carrying both keys is converted losslessly through the rehydration seam', () => {
    // The `PUT /meta/connector/:name` door persisted what it parsed, and both
    // keys parsed clean there; `applyConversionsToStoredItem` is live for the
    // `connector` type. Measured here rather than assumed.
    const stored: Record<string, unknown> = {
      ...WELL_FORMED,
      description: 'Orders from the ERP',
      requestTimeoutMs: 12000,
      syncConfig: AUTHORED_SYNC,
      fieldMappings: AUTHORED_FIELD_MAPPINGS,
    };
    const notices: { conversionId?: string; path?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('connector', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string }),
    }) as Record<string, unknown>;

    expect(notices.map((n) => n.conversionId)).toEqual(['connector-sync-keys-removed', 'connector-sync-keys-removed']);
    // LOSSLESS: the row that comes back is the stored row minus both keys, key
    // for key — neither had an effect to preserve, and nothing else moved.
    const { syncConfig: _sync, fieldMappings: _maps, ...rest } = stored;
    expect(rehydrated).toEqual(rest);
    // …and the result is exactly what the tombstoned door accepts.
    expect(DeclarativeConnectorEntrySchema.safeParse(rehydrated).success).toBe(true);
    // The input is never mutated (copy-on-write).
    expect(stored.syncConfig).toBe(AUTHORED_SYNC);
  });

  it('strips both keys from `connectors[]` — one attributed notice per key — never writes a mapping, and is idempotent', () => {
    const { stack, notices } = collectConversionNotices(
      {
        connectors: [
          { ...WELL_FORMED, syncConfig: AUTHORED_SYNC, fieldMappings: AUTHORED_FIELD_MAPPINGS },
          // Never authored either key: rides through untouched.
          { name: 'crm_catalog', label: 'CRM Catalog', type: 'saas' },
        ],
      },
      { includeRetired: true },
    );
    expect(stack).toEqual({
      connectors: [
        { ...WELL_FORMED },
        { name: 'crm_catalog', label: 'CRM Catalog', type: 'saas' },
      ],
    });
    expect(notices.map((n) => [n.conversionId, n.path, n.to])).toEqual([
      ['connector-sync-keys-removed', 'connectors[0].syncConfig', '(removed)'],
      ['connector-sync-keys-removed', 'connectors[0].fieldMappings', '(removed)'],
    ]);
    // Never turned into a mapping: a pulled mapping would START writes into a
    // table that never received them — the author's decision (the D3 entry).
    expect(stack).not.toHaveProperty('mappings');
    // Idempotence, measured: a second replay converts nothing and hands the
    // input back by reference (the copy-on-write contract).
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('the 2026-09-10 `schedule` deletion rides the container: a stored cadence leaves with `syncConfig`, unnamed', () => {
    // `syncConfig.schedule` was deleted outright by ruling, with no conversion
    // naming it (`cron-typed-positions-retirement.test.ts` pins that). A
    // source still holding one now loses it with the whole container, in the
    // container's own notice — the ruling on the KEY is untouched.
    const { stack, notices } = collectConversionNotices(
      { connectors: [{ ...WELL_FORMED, syncConfig: { strategy: 'full', schedule: '0 6 * * MON' } }] },
      { includeRetired: true },
    );
    expect(stack).toEqual({ connectors: [{ ...WELL_FORMED }] });
    expect(notices.map((n) => [n.conversionId, n.from])).toEqual([['connector-sync-keys-removed', 'syncConfig']]);
  });
});

describe('connector sync retirement — ADR-0087 registration', () => {
  it('declares both keys on both carrier defs and the four removed defs under major 18', () => {
    for (const def of ['integration/Connector', 'integration/DeclarativeConnectorEntry']) {
      for (const key of KEYS) {
        expect(RETIRED_KEYS_BY_MAJOR[18], `${def}:${key} must be declared`).toContain(`${def}:${key}`);
      }
    }
    for (const def of [
      'integration/DataSyncConfig',
      'integration/SyncStrategy',
      'integration/ConnectorConflictResolution',
      'integration/ConnectorFieldMapping',
    ]) {
      expect(RETIRED_DEFS_BY_MAJOR[18], `${def} must be declared`).toContain(def);
    }
    // The earlier `transform` retirement's key-grain row stays: its def left
    // whole, which is the steady state gate (b3) exempts — deleting the row
    // would erase the record that the key was ever retired.
    expect(RETIRED_KEYS_BY_MAJOR[17]).toContain('integration/ConnectorFieldMapping:transform');
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped, lossless strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain('connector-sync-keys-removed');
    const conversion = ALL_CONVERSIONS.find((c) => c.id === 'connector-sync-keys-removed');
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
    expect(conversion!.surface).toBe('connector.syncConfig / connector.fieldMappings');
  });

  it('carries ONE D3 entry for the family, naming its D2 conversion and the target-side binding', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === 'connector-sync-keys-retired');
    expect(entries, 'the family needs its own D3 entry (ruling B)').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain('`connector-sync-keys-removed`');
    expect(entry!.replacement).toContain('`connectorSource`');
    expect(entry!.replacement).toContain('`job`');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

describe('connector sync retirement — the defs leave every public entry', () => {
  const RETIRED_NAMES = [
    'DataSyncConfigSchema', 'DataSyncConfig', 'DataSyncConfigParsed',
    'SyncStrategySchema', 'SyncStrategy',
    'ConnectorConflictResolutionSchema', 'ConnectorConflictResolution',
    'ConnectorFieldMappingSchema', 'ConnectorFieldMapping', 'ConnectorFieldMappingParsed',
  ] as const;

  it('every retired name has ZERO holders on any public entry; the carriers survive', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    expect(EXPORT_ENTRY_POINTS).toContain('./integration');
    expect(exportNamesOf('./integration').length).toBeGreaterThan(20);
    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders`).toEqual([]);
    }
    const integrationNames = exportNamesOf('./integration');
    for (const name of ['ConnectorSchema', 'DeclarativeConnectorEntrySchema', 'RetryConfigSchema']) {
      expect(integrationNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
    // The shared base the connector side extended survives: it is not this
    // family's to retire.
    expect(exportNamesOf('./shared')).toContain('FieldMappingSchema');
  });

  it('the integration barrel resolves without the retired schemas', async () => {
    const integration = await import('./index');
    for (const name of ['DataSyncConfigSchema', 'SyncStrategySchema', 'ConnectorConflictResolutionSchema', 'ConnectorFieldMappingSchema']) {
      expect(integration).not.toHaveProperty(name);
    }
    expect(integration).toHaveProperty('ConnectorSchema');
  });
});

// ─── Tree-scoped absence, inside the radius already declared for this package ─
//
// What this leg guarantees. `tsc` is the primary sweeper — both keys are typed
// `never` and the retired exports are gone, so a TypeScript authoring site
// against the connector type fails to compile, and an untyped literal fails the
// parse. The residue is what neither ever reads: JSON, YAML, MD, MDX and
// untyped `.js` / `.mjs` / `.cjs`. This walk covers that residue across the
// five repo roots `scripts/cross-package-test-inputs.mjs` already declares for
// `@objectstack/spec#test` (the #15513 radius, mirrored in `turbo.json`), so a
// resurrection inside it puts this suite into `turbo ls --affected`. The
// bound, stated: `docs/**`, `.claude/**`, `.github/**` and the repo-root files
// are outside the walk.
//
// The matcher judges AUTHORING SHAPES, never a mention, and splits by what
// `tsc` already holds. In non-TS residue it judges the two keys in key position
// with the value shape they always had — `syncConfig` opening an object,
// `fieldMappings` opening an array (the `mapping` alias `fieldMappings:
// 'fieldMapping'` is a string, and stays legal). In every file, TS included, it
// judges the retired exported names imported from the spec package or used as
// a schema value. TS files are NOT judged on the keys: the refusal pins in this
// package author them on purpose, and a TS site that is not a pin is held by
// `tsc` or the parse.
describe('tree-scoped absence: nothing inside the declared radius still authors the family', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  const TS_EXT = new Set(['.ts', '.mts', '.cts']);
  /** Under `examples/` only the non-code extensions are scanned AND declared (the #15513 bound). */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const NAMES = 'DataSyncConfig|SyncStrategy|ConnectorConflictResolution|ConnectorFieldMapping';
  const NAME_AUTHORING = [
    // A retired name imported from the spec package.
    new RegExp(`import\\s+(type\\s+)?\\{[^}]*\\b(${NAMES})(Schema|Parsed)?\\b[^}]*\\}\\s*from\\s*['"]@objectstack/spec`, 'm'),
    // A retired schema used as a value.
    new RegExp(`\\b(${NAMES})Schema\\s*\\.\\s*(parse|safeParse|parseAsync|safeParseAsync|shape|extend|options)\\b|typeof\\s+(${NAMES})Schema\\b`, 'm'),
  ];
  const KEY_AUTHORING = [
    // `syncConfig` in key position, opening an object (TS-shaped / JSON / YAML flow).
    /(^|[^\w.])["']?syncConfig["']?\s*:\s*\{/m,
    // `fieldMappings` in key position, opening an array.
    /(^|[^\w.])["']?fieldMappings["']?\s*:\s*\[/m,
    // Block-style YAML: the key alone on its line, its body indented below.
    /^\s*-?\s*(syncConfig|fieldMappings)\s*:\s*$/m,
  ];

  /**
   * Prose mentions are spelled in INLINE CODE throughout this repo — the house
   * style `check:doc-authoring` enforces — so stripping single-backtick spans
   * separates "the retirement kit describing what it removed" from "a source
   * still writing it". Newline-bounded: a fenced block's content is NOT
   * stripped, so an authoring inside a fenced example is still caught.
   */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string, ext: string): RegExpExecArray | null => {
    const stripped = stripInlineCode(text);
    for (const re of TS_EXT.has(ext) ? NAME_AUTHORING : [...NAME_AUTHORING, ...KEY_AUTHORING]) {
      const m = re.exec(stripped);
      if (m) return m;
    }
    return null;
  };

  /**
   * Structural exclusions — the retirement kit and its projections, each with
   * its reason. ⛔ NOT an allowlist file (`spec-property-retirement` §4).
   */
  const EXCLUDED = new Set([
    // The ledger rows `retiredKey()` keeps in the walked shape — a JSON object
    // keyed by the property name, which is the key-position shape this walk
    // judges.
    'packages/spec/liveness/connector.json',
    // The pre-release authorable baseline: written ONLY by `gen:authorable-surface-base`,
    // never hand-edited or reverted — it is the record the removal is judged against.
    'packages/spec/authorable-surface.base.json',
    // This pin names the family to assert its absence.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion, its fixture and the strip target.
    'packages/spec/src/conversions/',
    // Registers the retirement by key and def (entries + the generated registry).
    'packages/spec/src/migrations/',
    // Generated projections of the registry.
    'packages/spec/spec-changes.json',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    '.changeset/',
    // The published upgrade skill walks a protocol-16 SOURCE through the chain
    // as its worked input — a retired shape shown as the thing being upgraded,
    // by design. It is a governed surface, reviewed on its own terms.
    'skills/objectstack-upgrade/',
    // GITIGNORED build output (`packages/spec/json-schema/`), reached only
    // because this is a FILESYSTEM walk. Its source is `connector.zod.ts`.
    'packages/spec/json-schema/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build (#15513's measured ENOENT). */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** Tolerates ONLY a path that vanished mid-walk; every other read fault is re-raised. */
  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores a prose mention (anti-vacuity)', () => {
    expect(judge("  syncConfig: { strategy: 'incremental' },", '.md')).not.toBeNull();
    expect(judge('  "syncConfig": { "strategy": "incremental" }', '.json')).not.toBeNull();
    expect(judge('    "fieldMappings": [', '.json')).not.toBeNull();
    expect(judge("  fieldMappings: [{ source: 'a', target: 'b' }],", '.mjs')).not.toBeNull();
    expect(judge('connectors:\n  - name: erp\n    syncConfig:\n      strategy: full', '.yaml')).not.toBeNull();
    expect(judge("import { DataSyncConfigSchema } from '@objectstack/spec/integration';", '.ts')).not.toBeNull();
    expect(judge("import type {\n  Connector,\n  ConnectorFieldMapping,\n} from '@objectstack/spec';", '.ts')).not.toBeNull();
    expect(judge('ConnectorConflictResolutionSchema.parse("latest_wins")', '.ts')).not.toBeNull();
    expect(judge('type T = z.infer<typeof SyncStrategySchema>;', '.ts')).not.toBeNull();
    // ⛔ NARROWNESS of the strip: a real authoring sharing a line with inline code still counts.
    expect(judge("// see `retryConfig` — syncConfig: { strategy: 'full' },", '.md')).not.toBeNull();
    // Prose: the retirement kit must be able to describe what it removed.
    expect(judge('the `syncConfig` block (`strategy`, `deleteMode`) leaves with it', '.md')).toBeNull();
    expect(judge('"integration/Connector:syncConfig [RETIRED]",', '.json')).toBeNull();
    // Neighbours that merely share a word stay legal: the `mapping` alias (a
    // string value), a property READ, and a TS pin authoring the key on purpose.
    expect(judge("    mappings: 'fieldMapping', fields: 'fieldMapping', fieldMappings: 'fieldMapping',", '.ts')).toBeNull();
    expect(judge("    fieldMappings: 'fieldMapping',", '.mjs')).toBeNull();
    expect(judge('const cfg = connector.syncConfig ?? {};', '.js')).toBeNull();
    expect(judge("  syncConfig: { strategy: 'incremental' },", '.ts')).toBeNull();
  });

  it('no authoring survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(ext)) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        const m = judge(text, ext);
        if (m) offenders.push(`${rel} authors \`${m[0].trim()}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree.
    expect(visited).toBeGreaterThan(1000);
    expect(offenders, 'an authoring of the retired family means the retirement is being undone').toEqual([]);
  });
});
