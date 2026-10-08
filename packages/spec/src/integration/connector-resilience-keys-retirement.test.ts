// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connector resilience family RETIRED — `connector.health` (the
 * `healthCheck` probe and the `circuitBreaker`), `connector.status` and the
 * connector-nested `webhooks`: sixteen authorable keys, ADR-0049
 * enforce-or-remove, one batch.
 *
 * The maintainer's criterion for a declared-but-unenforced family decided it:
 * does the mainstream platform offer the capability? Author-configured probes
 * and breakers are not connector metadata anywhere in the mainstream (breakers
 * live in API-gateway infrastructure); an authored `status` and a nested
 * webhook array duplicate what is delivered here by other means (`enabled` plus
 * the computed `state`; the top-level `webhooks:` collection). Measured before
 * the removal: zero reads of any of the sixteen keys outside `packages/spec`,
 * each census beside a lit control (`retryConfig`, `requestTimeoutMs`,
 * `stack.webhooks`).
 *
 * Bookkeeping shapes, pinned below:
 *   1. Three `retiredKey()` tombstones on the non-strict `ConnectorBaseSchema`
 *      (a bare deletion would be a SILENT STRIP, ADR-0104), carried by both
 *      published carriers — `ConnectorSchema` and
 *      `DeclarativeConnectorEntrySchema` — so the refusal reaches
 *      `registerConnector`, `stack.connectors[]` and the `/meta/connector`
 *      door. Six `RETIRED_KEYS_BY_MAJOR[18]` rows (three keys × two defs).
 *   2. `status` carried `.default('inactive')`, so its emitted default joins
 *      the retired-default residue stage (accepted and STRIPPED); every other
 *      value keeps the refusal.
 *   3. Seven defs leave whole (`RETIRED_DEFS_BY_MAJOR[18]`).
 *   4. The D2 conversion `connector-resilience-keys-removed` strips all three
 *      keys from `connectors[]` and stored rows, and ABSORBS the breaker half of
 *      the same step's duration rename: a source still holding
 *      `health.circuitBreaker.monitoringWindow` ends with no `health` at all.
 *   5. The family's D3 entry `connector-resilience-keys-retired`, which names
 *      that chain.
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
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ObjectStackSchema } from '../stack.zod';
import { EXPORT_ENTRY_POINTS, exportNamesOf, holdersOf } from '../../scripts/lib/export-origins-testkit';
import { ConnectorSchema, DeclarativeConnectorEntrySchema, type Connector } from './connector.zod';

/** A well-formed catalog descriptor — every required key, none of the retired ones. */
const WELL_FORMED = {
  name: 'erp_gateway',
  label: 'ERP Gateway',
  type: 'api',
} as const;

/** What an author could write under each retired key before the removal. */
const AUTHORED = {
  health: {
    healthCheck: { enabled: true, intervalMs: 30000, endpoint: '/health', method: 'GET', unhealthyThreshold: 3 },
    circuitBreaker: { enabled: true, failureThreshold: 5, monitoringWindowMs: 60000, fallbackStrategy: 'cache' },
  },
  status: 'active',
  webhooks: [{ name: 'erp_order_created', url: 'https://example.invalid/erp/orders', events: ['sync.completed'] }],
} as const;

type RetiredKey = keyof typeof AUTHORED;
const RETIRED_KEYS = Object.keys(AUTHORED) as RetiredKey[];

/** Each key's prescription: named, dated to the npm major, and closed with the house sentence. */
const PRESCRIPTION: Record<RetiredKey, RegExp> = {
  health: /^`connector\.health` was removed in @objectstack\/spec 17 \(ADR-0049/,
  status: /^`connector\.status` was removed in @objectstack\/spec 17 \(ADR-0049/,
  webhooks: /^`connector\.webhooks` was removed in @objectstack\/spec 17 \(ADR-0049/,
};

/** What each prescription must send the author to — a refusal alone teaches nothing. */
const POINTS_AT: Record<RetiredKey, readonly string[]> = {
  health: ['connector provider or an upstream gateway', '`state`'],
  status: ['`enabled: false`', '`state`'],
  webhooks: ['top-level `webhooks:` collection'],
};

const MIGRATE_SENTENCE =
  /Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\.$/;

function issueAt(result: { success: boolean; error?: { issues: readonly { path: PropertyKey[]; code: string; message: string }[] } }, at: string) {
  expect(result.success, `the parse must refuse \`${at}\``).toBe(false);
  return result.error!.issues.find((i) => i.path.join('.') === at);
}

describe('connector resilience family retirement — the tombstones', () => {
  for (const key of RETIRED_KEYS) {
    it(`REJECTS an authored \`${key}\` at path \`${key}\`, carrying the prescription`, () => {
      const issue = issueAt(ConnectorSchema.safeParse({ ...WELL_FORMED, [key]: AUTHORED[key] }), key);
      expect(issue, `the refusal must name \`${key}\``).toBeDefined();
      // The machine-readable half this surface has: a `retiredKey()` tombstone
      // raises `invalid_type` from its `z.never()` — not `unrecognized_keys`,
      // which would mean the key had simply vanished from a strict shape.
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual([key]);
      expect(issue!.message).toMatch(PRESCRIPTION[key]);
      for (const target of POINTS_AT[key]) expect(issue!.message).toContain(target);
      expect(issue!.message).toMatch(MIGRATE_SENTENCE);
      // Customer-facing text carries the ADR, never a tracker number.
      expect(issue!.message).not.toMatch(/#\d{3,}/);
    });
  }

  it('the second carrier, the /meta door and `stack.connectors[]` refuse all three — with controls', () => {
    const door = getMetadataTypeSchema('connector');
    expect(door, 'no schema bound for `connector`').toBeDefined();
    for (const key of RETIRED_KEYS) {
      const withKey = { ...WELL_FORMED, [key]: AUTHORED[key] };
      expect(issueAt(DeclarativeConnectorEntrySchema.safeParse(withKey), key), `entry refuses ${key}`)
        .toBeDefined();
      // The registry lookup is the real `PUT /meta/connector/:name` entry point:
      // a rebinding that pointed `connector` at some third shape would pass the
      // pin above and still accept the key in production.
      expect(door!.safeParse(withKey).success, `the /meta door refuses ${key}`).toBe(false);
      const stack = issueAt(ObjectStackSchema.safeParse({ connectors: [withKey] }), `connectors.0.${key}`);
      expect(stack, `the stack refusal must locate ${key}`).toBeDefined();
      expect(stack!.message).toMatch(PRESCRIPTION[key]);
    }
    // CONTROL: the same three doors accept the same connector WITHOUT the keys,
    // so every refusal above is attributable to the retired key alone.
    expect(DeclarativeConnectorEntrySchema.safeParse(WELL_FORMED).success).toBe(true);
    expect(door!.safeParse(WELL_FORMED).success).toBe(true);
    expect(ObjectStackSchema.safeParse({ connectors: [WELL_FORMED] }).success).toBe(true);
  });

  it('an author holding EITHER breaker spelling is refused at `health`, told the renamed key is itself gone', () => {
    // The chain the family D3 entry names: `monitoringWindow` was renamed to
    // `monitoringWindowMs` earlier in the same protocol step, and the whole
    // block is removed now. Both spellings must end at a refusal that names
    // both — never at a prescription that sends the author to a key that is
    // refused next.
    for (const breaker of [{ enabled: true, monitoringWindow: 120000 }, { enabled: true, monitoringWindowMs: 120000 }]) {
      const issue = issueAt(ConnectorSchema.safeParse({ ...WELL_FORMED, health: { circuitBreaker: breaker } }), 'health');
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('`circuitBreaker.monitoringWindowMs`');
      expect(issue!.message).toContain('`monitoringWindow` spelling it was renamed from');
      expect(issue!.message).toContain('the renamed key is removed with the rest');
    }
  });

  it('parses a well-formed connector and grows none of the three properties', () => {
    const parsed = ConnectorSchema.parse({ ...WELL_FORMED });
    expect(parsed.name).toBe('erp_gateway');
    // CONTROL: the live defaults still apply, so an empty reading below is the
    // retirement and not a schema that stopped defaulting.
    expect(parsed.enabled).toBe(true);
    expect(parsed.requestTimeoutMs).toBe(30000);
    // The non-strict strip path: absence must stay absence. `status` used to be
    // EMITTED here as `'inactive'` on every parse.
    for (const key of RETIRED_KEYS) expect(parsed).not.toHaveProperty(key);
  });

  it("accepts and STRIPS `status: 'inactive'` — the retired default every 17.x parse emitted — on both carriers", () => {
    for (const [label, schema] of [
      ['base', ConnectorSchema],
      ['the /meta + stack.connectors carrier', DeclarativeConnectorEntrySchema],
    ] as const) {
      // The shape a 17.x parse produced for a three-key author literal. (Its
      // other retired default is pinned by its own retirement's test, which
      // also holds that key's spelling to that file alone.)
      const r = schema.safeParse({ ...WELL_FORMED, status: 'inactive' });
      expect(r.success, `${label} must accept the emitted default as residue`).toBe(true);
      if (!r.success) continue;
      expect(r.data, `${label} must STRIP status`).not.toHaveProperty('status');
      // CONTROL: the live sibling on the same shape is untouched by the stage.
      expect(r.data.enabled, `${label} keeps the live sibling`).toBe(true);
    }
  });

  it('⛔ keeps the refusal for every status value that is NOT the retired default', () => {
    for (const value of ['active', 'error', 'configuring', 'INACTIVE', ' inactive', false, null]) {
      const issue = issueAt(ConnectorSchema.safeParse({ ...WELL_FORMED, status: value }), 'status');
      expect(issue, `${String(value)} must be refused AT the key`).toBeDefined();
      expect(issue!.message, `${String(value)} must carry the prescription`).toMatch(PRESCRIPTION.status);
    }
  });

  it('the residue stage leaves the walked shape intact — the three tombstones stay walkable', () => {
    // The authorable-surface and liveness walkers duck-test `.shape`; a wrapper
    // that lost it would silently drop the def from both ratchets while every
    // parse pin above stayed green.
    for (const [label, schema] of [
      ['base', ConnectorSchema],
      ['entry', DeclarativeConnectorEntrySchema],
    ] as const) {
      const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
      expect(shape, `${label} must expose a read-through shape`).toBeDefined();
      for (const key of RETIRED_KEYS) expect(Object.keys(shape!), `${label} keeps ${key} walkable`).toContain(key);
      expect(Object.keys(shape!), `${label} keeps its live neighbours`).toContain('enabled');
    }
  });

  it('fails tsc at the authoring site: the input type of each key is `never`', () => {
    const connector: Connector = {
      ...WELL_FORMED,
      // @ts-expect-error — `health` is a retiredKey() tombstone: its input type is `never`.
      health: AUTHORED.health,
      // @ts-expect-error — `status` is a retiredKey() tombstone: its input type is `never`.
      status: 'active',
      // @ts-expect-error — `webhooks` is a retiredKey() tombstone: its input type is `never`.
      webhooks: AUTHORED.webhooks,
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(ConnectorSchema.safeParse(connector).success).toBe(false);
  });
});

describe('connector resilience family retirement — the D2 conversion', () => {
  it('a STORED connector row carrying the family replays clean through the rehydration seam', () => {
    // The `PUT /meta/connector/:name` door persisted what it parsed — including
    // the materialized `status: 'inactive'` — and `applyConversionsToStoredItem`
    // is live for the `connector` type. Measured here rather than assumed.
    const stored: Record<string, unknown> = { ...WELL_FORMED, ...AUTHORED, requestTimeoutMs: 12000 };
    const notices: { conversionId?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('connector', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string }),
    }) as Record<string, unknown>;

    expect(notices.map((n) => n.conversionId)).toEqual([
      'connector-resilience-keys-removed',
      'connector-resilience-keys-removed',
      'connector-resilience-keys-removed',
    ]);
    for (const key of RETIRED_KEYS) expect(rehydrated).not.toHaveProperty(key);
    // CONTROL: the seam rewrote the retired keys and nothing else.
    expect(rehydrated.requestTimeoutMs).toBe(12000);
    expect(rehydrated.name).toBe('erp_gateway');
    // …and the result is exactly what the tombstoned door accepts.
    expect(DeclarativeConnectorEntrySchema.safeParse(rehydrated).success).toBe(true);
  });

  it('strips the three keys from `connectors[]` — one attributed notice per key — and is idempotent', () => {
    const { stack, notices } = collectConversionNotices(
      {
        connectors: [
          { ...WELL_FORMED, ...AUTHORED },
          // Never authored any of them: rides through untouched.
          { name: 'crm_directory', label: 'CRM Directory', type: 'saas' },
        ],
      },
      { includeRetired: true },
    );
    expect(stack).toEqual({
      connectors: [
        { ...WELL_FORMED },
        { name: 'crm_directory', label: 'CRM Directory', type: 'saas' },
      ],
    });
    expect(notices.map((n) => [n.conversionId, n.path])).toEqual([
      ['connector-resilience-keys-removed', 'connectors[0].health'],
      ['connector-resilience-keys-removed', 'connectors[0].status'],
      ['connector-resilience-keys-removed', 'connectors[0].webhooks'],
    ]);
    // Idempotence, measured: a second replay converts nothing and hands the
    // input back by reference (the copy-on-write contract).
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('never MOVES a nested webhook to the top-level collection — that would start deliveries', () => {
    const { stack } = collectConversionNotices(
      { connectors: [{ ...WELL_FORMED, webhooks: AUTHORED.webhooks }] },
      { includeRetired: true },
    );
    expect(stack).not.toHaveProperty('webhooks');
    expect(stack).toEqual({ connectors: [{ ...WELL_FORMED }] });
  });

  it('the absorbed chain: a pre-rename breaker key ends with the whole block gone, and no rename fires on it', () => {
    // The rename's other half (`triggers[].interval`) used to ride in this same
    // connector as the control that the rename still fired. It was absorbed in
    // turn by the triggers retirement, so the rename left the table; that
    // chain is pinned in `connector-triggers-retirement.test.ts`. The control
    // here is now a live sibling key the removal must leave alone.
    const { stack, notices } = collectConversionNotices(
      {
        connectors: [{
          ...WELL_FORMED,
          health: { circuitBreaker: { enabled: true, monitoringWindow: 120000 } },
          requestTimeoutMs: 12000,
        }],
      },
      { includeRetired: true },
    );
    expect(stack).toEqual({ connectors: [{ ...WELL_FORMED, requestTimeoutMs: 12000 }] });
    expect(notices.map((n) => [n.conversionId, n.from, n.to])).toEqual([
      ['connector-resilience-keys-removed', 'health', '(removed)'],
    ]);
  });
});

describe('connector resilience family retirement — ADR-0087 registration', () => {
  it('declares all six carrier keys and the seven removed defs under major 18', () => {
    for (const def of ['integration/Connector', 'integration/DeclarativeConnectorEntry']) {
      for (const key of RETIRED_KEYS) {
        expect(RETIRED_KEYS_BY_MAJOR[18], `${def}:${key} must be declared`).toContain(`${def}:${key}`);
      }
    }
    for (const def of [
      'integration/ConnectorHealth',
      'integration/HealthCheckConfig',
      'integration/CircuitBreakerConfig',
      'integration/ConnectorStatus',
      'integration/WebhookConfig',
      'integration/WebhookEvent',
      'integration/WebhookSignatureAlgorithm',
    ]) {
      expect(RETIRED_DEFS_BY_MAJOR[18], `${def} must be declared`).toContain(def);
    }
    // The absorbed rename's tombstone row stays: its def left whole, which is
    // the steady state gate (b3) exempts — deleting the row would erase the
    // record that `monitoringWindow` was ever retired.
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('integration/CircuitBreakerConfig:monitoringWindow');
  });

  it('wires the D2 conversion into the step-18 chain; the duration rename it absorbed is gone from it', () => {
    const ids = MIGRATIONS_BY_MAJOR[18]!.conversionIds;
    expect(ids).toContain('connector-resilience-keys-removed');
    // This used to pin the removal AFTER the rename in the chain. The rename
    // lost its trigger half to the triggers retirement as well, so with neither
    // half left it is no longer in the step at all — an ordering assertion
    // against an absent id would pass vacuously.
    expect(ids).not.toContain('connector-health-and-trigger-durations-unit-in-key');
  });

  it('carries ONE D3 entry for the family, naming its D2 conversion and the chain', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === 'connector-resilience-keys-retired');
    expect(entry, 'the family needs its own D3 entry (ruling B)').toBeDefined();
    expect(entry!.reason).toContain('`connector-resilience-keys-removed`');
    expect(entry!.reason).toContain('`connector-health-and-trigger-durations-unit-in-key`');
    expect(entry!.reason).toContain('`health.circuitBreaker.monitoringWindow`');
    expect(entry!.replacement).toContain('top-level `webhooks:` collection');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

describe('connector resilience family retirement — the seven defs leave every public entry', () => {
  /** The names the seven retired defs exported (7 schema consts + their types). */
  const RETIRED_NAMES = [
    'ConnectorHealthSchema', 'ConnectorHealth', 'ConnectorHealthParsed',
    'HealthCheckConfigSchema', 'HealthCheckConfig', 'HealthCheckConfigParsed',
    'CircuitBreakerConfigSchema', 'CircuitBreakerConfig', 'CircuitBreakerConfigParsed',
    'ConnectorStatusSchema', 'ConnectorStatus',
    'WebhookConfigSchema', 'WebhookConfig', 'WebhookConfigParsed',
    'WebhookEventSchema', 'WebhookEvent',
    'WebhookSignatureAlgorithmSchema', 'WebhookSignatureAlgorithm',
  ] as const;

  it('every retired name has ZERO holders on any public entry; the carriers survive', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    expect(EXPORT_ENTRY_POINTS).toContain('./integration');
    expect(exportNamesOf('./integration').length).toBeGreaterThan(20);
    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders`).toEqual([]);
    }
    const integrationNames = exportNamesOf('./integration');
    // `ConnectorTriggerSchema` was the fourth survivor here until the triggers
    // retirement took it whole; `connector-triggers-retirement.test.ts` pins that.
    for (const name of ['ConnectorSchema', 'DeclarativeConnectorEntrySchema', 'RetryConfigSchema']) {
      expect(integrationNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('the integration barrel resolves without the retired schemas', async () => {
    const integration = await import('./index');
    for (const name of RETIRED_NAMES.filter((n) => n.endsWith('Schema'))) {
      expect(integration).not.toHaveProperty(name);
    }
    expect(integration).toHaveProperty('ConnectorSchema');
  });
});

// ─── Tree-scoped absence, inside the radius already declared for this package ─
//
// What this leg guarantees. `tsc` is the primary sweeper — every retired key
// is typed `never` and every retired export is gone, so a TypeScript authoring
// site fails to compile. The residue is everything `tsc` never compiles: JSON,
// YAML, MD, MDX and untyped `.js` / `.mjs` / `.cjs`. This walk covers that
// residue across the five repo roots `scripts/cross-package-test-inputs.mjs`
// already declares for `@objectstack/spec#test` (the #15513 radius, mirrored
// in `turbo.json`), so a resurrection inside it puts this suite into
// `turbo ls --affected`. The bound, stated: `docs/**`, `.claude/**`,
// `.github/**` and the repo-root files are outside the walk.
//
// The matcher judges AUTHORING SHAPES, never a mention. The three carrier keys
// (`health`, `status`, `webhooks`) are too common a spelling to judge by text —
// `status:` alone is authored thousands of times on other surfaces — so they
// are held by `tsc` and the parse refusal above. What IS distinctive is held
// here: the six breaker / probe leaf keys no other surface declares, in key
// position or read off an object; and the seven retired defs' exported names,
// imported from the spec package or used as a schema value.
describe('tree-scoped absence: nothing inside the declared radius still authors the family', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared (the #15513 bound). */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const LEAF_KEYS = 'halfOpenMaxRequests|fallbackStrategy|unhealthyThreshold|healthyThreshold|monitoringWindowMs|monitoringWindow';
  const NAMES = 'ConnectorHealth|HealthCheckConfig|CircuitBreakerConfig|ConnectorStatus|WebhookConfig|WebhookEvent|WebhookSignatureAlgorithm';
  const AUTHORING = [
    // A breaker / probe leaf key in key position (TS / JSON / YAML) or read off an object.
    new RegExp(`(^|[^\\w.])(${LEAF_KEYS})["']?\\s*:|\\.(${LEAF_KEYS})\\b`, 'm'),
    // A retired name imported from the spec package.
    new RegExp(`import\\s+(type\\s+)?\\{[^}]*\\b(${NAMES})(Schema|Parsed)?\\b[^}]*\\}\\s*from\\s*['"]@objectstack/spec`, 'm'),
    // A retired schema used as a value.
    new RegExp(`\\b(${NAMES})Schema\\s*\\.\\s*(parse|safeParse|parseAsync|safeParseAsync|shape|extend|options)\\b|typeof\\s+(${NAMES})Schema\\b`, 'm'),
  ];

  /**
   * Prose mentions are spelled in INLINE CODE throughout this repo — the house
   * style `check:doc-authoring` enforces — so stripping single-backtick spans
   * separates "the retirement kit describing what it removed" from "a source
   * still writing it". Newline-bounded: a fenced block's content is NOT
   * stripped, so an authoring inside a fenced example is still caught.
   */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string): RegExpExecArray | null => {
    const stripped = stripInlineCode(text);
    for (const re of AUTHORING) {
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
    // The declaring file: tombstones and the removal record.
    'packages/spec/src/integration/connector.zod.ts',
    // The ledger rows `retiredKey()` keeps in the walked shape.
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
    expect(judge('    circuitBreaker: { enabled: true, halfOpenMaxRequests: 2 },')).not.toBeNull();
    expect(judge('  "fallbackStrategy": "cache",')).not.toBeNull();
    expect(judge('monitoringWindow: 120000   # yaml')).not.toBeNull();
    expect(judge('const w = def.health.circuitBreaker.monitoringWindowMs;')).not.toBeNull();
    expect(judge("import { ConnectorStatusSchema } from '@objectstack/spec/integration';")).not.toBeNull();
    expect(judge("import type {\n  Connector,\n  WebhookConfig,\n} from '@objectstack/spec';")).not.toBeNull();
    expect(judge('HealthCheckConfigSchema.parse({ enabled: true })')).not.toBeNull();
    expect(judge('type C = z.infer<typeof CircuitBreakerConfigSchema>;')).not.toBeNull();
    // ⛔ NARROWNESS of the strip: a real authoring sharing a line with inline code still counts.
    expect(judge('// see `retryConfig` — unhealthyThreshold: 3,')).not.toBeNull();
    // Prose: the retirement kit must be able to describe what it removed.
    expect(judge('`circuitBreaker.monitoringWindowMs` and the `monitoringWindow` spelling')).toBeNull();
    expect(judge('the whole shape leaves with it (`ConnectorHealth`, `HealthCheckConfig`)')).toBeNull();
    expect(judge('"integration/CircuitBreakerConfig:halfOpenMaxRequests",')).toBeNull();
    // Neighbours that merely share a word: the cache breaker, the live kernel
    // contract and the delivered webhook shape stay legal.
    expect(judge('circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeoutSeconds: 30 },')).toBeNull();
    expect(judge('healthCheck: { intervalMs: 30000, failureThreshold: 3 }')).toBeNull();
    expect(judge("import { EventWebhookConfigSchema, WebhookSchema } from '@objectstack/spec/kernel';")).toBeNull();
    expect(judge('  defaultFallbackStrategy: 1,')).toBeNull();
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
        const m = judge(text);
        if (m) offenders.push(`${rel} authors \`${m[0].trim()}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree.
    expect(visited).toBeGreaterThan(1000);
    expect(offenders, 'an authoring of the retired family means the retirement is being undone').toEqual([]);
  });
});
