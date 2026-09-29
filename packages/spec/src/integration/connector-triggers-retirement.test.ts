// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connector `triggers` array RETIRED — the whole `ConnectorTrigger` shape
 * (`key`, `label`, `description`, `type: 'polling' | 'webhook'`,
 * `intervalSeconds`), ADR-0049 enforce-or-remove, one batch.
 *
 * Ruled RETIRE on the maintainer's criterion for a declared-but-unenforced
 * family, with ADR-0041 left as it is: connector-event triggers stay in its
 * third tier, as their own trigger package, promoted only when real projects
 * ask — and then in the mainstream shape (subscribe / unsubscribe, signature
 * verification, a dedupe cursor), which these five keys could not carry.
 * Measured before the removal: `registerConnector` walks `parsed.actions` only,
 * the engine's trigger registry holds FLOW trigger kinds no connector trigger
 * ever entered, no polling loop read an interval, no receiver was driven by a
 * `webhook` trigger, and nothing outside `packages/spec` declared one.
 *
 * Bookkeeping shapes, pinned below:
 *   1. One `retiredKey()` tombstone on the non-strict `ConnectorBaseSchema` (a
 *      bare deletion would be a SILENT STRIP, ADR-0104), carried by both
 *      published carriers — `ConnectorSchema` and
 *      `DeclarativeConnectorEntrySchema` — so the refusal reaches
 *      `registerConnector`, `stack.connectors[]` and the `/meta/connector`
 *      door. Two `RETIRED_KEYS_BY_MAJOR[18]` rows (one key × two defs).
 *   2. The provider-bound refusal of `triggers` (reasoned "the provider derives
 *      them" — untrue) is GONE: the tombstone refuses every value on every
 *      carrier, so a provider-bound instance meets the retirement prescription
 *      and never the old reason.
 *   3. `integration/ConnectorTrigger` leaves whole (`RETIRED_DEFS_BY_MAJOR[18]`).
 *   4. The D2 conversion `connector-triggers-removed` strips the array from
 *      `connectors[]` and stored rows, and ABSORBS the trigger half of the same
 *      step's duration rename: a source still holding `triggers[].interval`
 *      ends with no `triggers` at all, and the rename left the table.
 *   5. The family's D3 entry `connector-triggers-retired`, which names that
 *      chain.
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

/** A well-formed catalog descriptor — every required key, not the retired one. */
const WELL_FORMED = {
  name: 'billing_api',
  label: 'Billing API',
  type: 'api',
} as const;

/** What an author could write under `triggers` before the removal — both types. */
const AUTHORED_TRIGGERS = [
  { key: 'new_invoice', label: 'New invoice', type: 'polling', intervalSeconds: 60 },
  { key: 'invoice_paid', label: 'Invoice paid', type: 'webhook' },
] as const;

/** The prescription: named, dated to the npm major, and closed with the house sentence. */
const PRESCRIPTION = /^`connector\.triggers` was removed in @objectstack\/spec 17 \(ADR-0049/;

/**
 * What the prescription must send the author to — the two shapes that work
 * today, as ruled: an external event starts an `api` flow, and a scheduled pull
 * is a `schedule` flow, each calling the connector's action.
 */
const POINTS_AT = ['`connector_action` node', 'an `api` flow', '`schedule` flow', 'Delete the key'] as const;

const MIGRATE_SENTENCE =
  /Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand\.$/;

/** The provider-bound refusal's reason, which was untrue and must not survive anywhere. */
const OLD_REASON = 'derives them from the upstream';

function issueAt(result: { success: boolean; error?: { issues: readonly { path: PropertyKey[]; code: string; message: string }[] } }, at: string) {
  expect(result.success, `the parse must refuse \`${at}\``).toBe(false);
  return result.error!.issues.find((i) => i.path.join('.') === at);
}

describe('connector triggers retirement — the tombstone', () => {
  it('REJECTS an authored `triggers` at path `triggers`, carrying the prescription', () => {
    const issue = issueAt(ConnectorSchema.safeParse({ ...WELL_FORMED, triggers: AUTHORED_TRIGGERS }), 'triggers');
    expect(issue, 'the refusal must name `triggers`').toBeDefined();
    // The machine-readable half this surface has: a `retiredKey()` tombstone
    // raises `invalid_type` from its `z.never()` — not `unrecognized_keys`,
    // which would mean the key had simply vanished from a strict shape.
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['triggers']);
    expect(issue!.message).toMatch(PRESCRIPTION);
    for (const target of POINTS_AT) expect(issue!.message).toContain(target);
    expect(issue!.message).toMatch(MIGRATE_SENTENCE);
    // Customer-facing text carries the ADR, never a tracker number.
    expect(issue!.message).not.toMatch(/#\d{3,}/);
  });

  it('refuses EVERY value, both interval spellings and an empty array included', () => {
    // The pre-rename `interval` spelling was a tombstone of its own; an author
    // who still holds it must meet THIS prescription, which names it, and
    // never a rename prescription pointing at a key the parse refuses next.
    for (const value of [
      [{ key: 'new_invoice', label: 'New invoice', type: 'polling', interval: 60 }],
      [{ key: 'new_invoice', label: 'New invoice', type: 'polling', intervalSeconds: 60 }],
      [],
      null,
      'polling',
    ]) {
      const issue = issueAt(ConnectorSchema.safeParse({ ...WELL_FORMED, triggers: value }), 'triggers');
      expect(issue, `${JSON.stringify(value)} must be refused AT the key`).toBeDefined();
      expect(issue!.message, `${JSON.stringify(value)} must carry the prescription`).toMatch(PRESCRIPTION);
    }
    const message = issueAt(ConnectorSchema.safeParse({ ...WELL_FORMED, triggers: [] }), 'triggers')!.message;
    expect(message).toContain('`intervalSeconds` (or the `interval` spelling it was renamed from)');
  });

  it('the second carrier, a provider-bound instance, the /meta door and `stack.connectors[]` all refuse it — with controls', () => {
    const door = getMetadataTypeSchema('connector');
    expect(door, 'no schema bound for `connector`').toBeDefined();
    const instance = { ...WELL_FORMED, provider: 'openapi', providerConfig: { spec: './billing.json' } };
    for (const [label, base] of [['descriptor', WELL_FORMED], ['provider-bound instance', instance]] as const) {
      const withKey = { ...base, triggers: AUTHORED_TRIGGERS };
      const entry = issueAt(DeclarativeConnectorEntrySchema.safeParse(withKey), 'triggers');
      expect(entry, `entry refuses triggers on a ${label}`).toBeDefined();
      expect(entry!.message).toMatch(PRESCRIPTION);
      // The registry lookup is the real `PUT /meta/connector/:name` entry point:
      // a rebinding that pointed `connector` at some third shape would pass the
      // pin above and still accept the key in production.
      expect(door!.safeParse(withKey).success, `the /meta door refuses triggers on a ${label}`).toBe(false);
      const stack = ObjectStackSchema.safeParse({ connectors: [withKey] });
      const stackIssue = issueAt(stack, 'connectors.0.triggers');
      expect(stackIssue, `the stack refusal must locate triggers on a ${label}`).toBeDefined();
      expect(stackIssue!.message).toMatch(PRESCRIPTION);
      // ⛔ The provider-bound refusal's untrue reason is gone from every door.
      for (const r of [DeclarativeConnectorEntrySchema.safeParse(withKey), stack]) {
        for (const i of r.error?.issues ?? []) expect(i.message, label).not.toContain(OLD_REASON);
      }
      // CONTROL: the same three doors accept the same connector WITHOUT the key,
      // so every refusal above is attributable to `triggers` alone.
      expect(DeclarativeConnectorEntrySchema.safeParse(base).success, `${label} control`).toBe(true);
      expect(door!.safeParse(base).success, `${label} /meta control`).toBe(true);
      expect(ObjectStackSchema.safeParse({ connectors: [base] }).success, `${label} stack control`).toBe(true);
    }
  });

  it('parses a well-formed connector and grows no `triggers` property', () => {
    const parsed = ConnectorSchema.parse({ ...WELL_FORMED });
    expect(parsed.name).toBe('billing_api');
    // CONTROL: the live defaults still apply, so an empty reading below is the
    // retirement and not a schema that stopped emitting.
    expect(parsed.enabled).toBe(true);
    expect(parsed).not.toHaveProperty('triggers');
  });

  it('the walked shape keeps `triggers` as a key — the ledger row and the authorable-surface row stay reachable', () => {
    for (const [label, schema] of [
      ['base', ConnectorSchema],
      ['entry', DeclarativeConnectorEntrySchema],
    ] as const) {
      const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
      expect(shape, `${label} must expose a read-through shape`).toBeDefined();
      expect(Object.keys(shape!), `${label} keeps triggers walkable`).toContain('triggers');
      expect(Object.keys(shape!), `${label} keeps its live neighbour`).toContain('actions');
    }
  });

  it('fails tsc at the authoring site: the input type of the key is `never`', () => {
    const connector: Connector = {
      ...WELL_FORMED,
      // @ts-expect-error — `triggers` is a retiredKey() tombstone: its input type is `never`.
      triggers: AUTHORED_TRIGGERS,
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(ConnectorSchema.safeParse(connector).success).toBe(false);
  });
});

describe('connector triggers retirement — the D2 conversion', () => {
  it('a STORED connector row carrying `triggers` is converted losslessly through the rehydration seam', () => {
    // The `PUT /meta/connector/:name` door persisted what it parsed, and a
    // descriptor's `triggers` parsed clean there; `applyConversionsToStoredItem`
    // is live for the `connector` type. Measured here rather than assumed.
    const stored: Record<string, unknown> = {
      ...WELL_FORMED,
      description: 'Invoices from the billing system',
      actions: [{ key: 'get_invoice', label: 'Get invoice', effect: 'read' }],
      requestTimeoutMs: 12000,
      triggers: AUTHORED_TRIGGERS,
    };
    const notices: { conversionId?: string; path?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('connector', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string }),
    }) as Record<string, unknown>;

    expect(notices.map((n) => n.conversionId)).toEqual(['connector-triggers-removed']);
    // LOSSLESS: the row that comes back is the stored row minus `triggers`, key
    // for key — the array had no effect to preserve, and nothing else moved.
    const { triggers: _dropped, ...rest } = stored;
    expect(rehydrated).toEqual(rest);
    // …and the result is exactly what the tombstoned door accepts.
    expect(DeclarativeConnectorEntrySchema.safeParse(rehydrated).success).toBe(true);
    // The input is never mutated (copy-on-write).
    expect(stored.triggers).toBe(AUTHORED_TRIGGERS);
  });

  it('strips the key from `connectors[]` — one attributed notice per connector — and is idempotent', () => {
    const { stack, notices } = collectConversionNotices(
      {
        connectors: [
          { ...WELL_FORMED, triggers: AUTHORED_TRIGGERS },
          // Never authored the key: rides through untouched.
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
      ['connector-triggers-removed', 'connectors[0].triggers', '(removed)'],
    ]);
    // Never turned into flows: writing a flow would START work that never ran.
    expect(stack).not.toHaveProperty('flows');
    // Idempotence, measured: a second replay converts nothing and hands the
    // input back by reference (the copy-on-write contract).
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('the absorbed chain: a pre-rename `interval` trigger ends with the whole array gone, in one notice and no rename', () => {
    const { stack, notices } = collectConversionNotices(
      {
        connectors: [{
          ...WELL_FORMED,
          triggers: [{ key: 'new_invoice', label: 'New invoice', type: 'polling', interval: 60 }],
          // CONTROL: a live sibling key the removal must leave alone.
          requestTimeoutMs: 12000,
        }],
      },
      { includeRetired: true },
    );
    expect(stack).toEqual({ connectors: [{ ...WELL_FORMED, requestTimeoutMs: 12000 }] });
    expect(notices.map((n) => [n.conversionId, n.from, n.to])).toEqual([
      ['connector-triggers-removed', 'triggers', '(removed)'],
    ]);
    // The rename that used to fire first is gone from the table, with both of
    // its halves absorbed (the breaker half by the `health` removal).
    expect(ALL_CONVERSIONS.map((c) => c.id)).not.toContain('connector-health-and-trigger-durations-unit-in-key');
  });
});

describe('connector triggers retirement — ADR-0087 registration', () => {
  it('declares both carrier keys and the removed def under major 18, and keeps the `interval` record', () => {
    for (const def of ['integration/Connector', 'integration/DeclarativeConnectorEntry']) {
      expect(RETIRED_KEYS_BY_MAJOR[18], `${def}:triggers must be declared`).toContain(`${def}:triggers`);
    }
    expect(RETIRED_DEFS_BY_MAJOR[18]).toContain('integration/ConnectorTrigger');
    // The absorbed rename's tombstone row stays: its def left whole, which is
    // the steady state gate (b3) exempts — deleting the row would erase the
    // record that the bare `interval` spelling was ever retired.
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('integration/ConnectorTrigger:interval');
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped, lossless strip', () => {
    const ids = MIGRATIONS_BY_MAJOR[18]!.conversionIds;
    expect(ids).toContain('connector-triggers-removed');
    expect(ids).not.toContain('connector-health-and-trigger-durations-unit-in-key');
    const conversion = ALL_CONVERSIONS.find((c) => c.id === 'connector-triggers-removed');
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
    expect(conversion!.surface).toBe('connector.triggers');
  });

  it('carries ONE D3 entry for the family, naming its D2 conversion, the chain and the two working shapes', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === 'connector-triggers-retired');
    expect(entries, 'the family needs its own D3 entry (ruling B)').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain('`connector-triggers-removed`');
    expect(entry!.reason).toContain('`connector-health-and-trigger-durations-unit-in-key`');
    expect(entry!.replacement).toContain('`api` flow');
    expect(entry!.replacement).toContain('`schedule` flow');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
    // The absorbed rename's own D3 entry left with its conversion.
    expect(MIGRATIONS_BY_MAJOR[18]!.semantic.map((s) => s.id)).not.toContain('connector-resilience-durations-unit-in-key');
  });
});

describe('connector triggers retirement — the def leaves every public entry', () => {
  // The two names the retired def exported (it declared no `…Parsed` alias —
  // its input and output types coincided).
  const RETIRED_NAMES = ['ConnectorTriggerSchema', 'ConnectorTrigger'] as const;

  it('every retired name has ZERO holders on any public entry; the carriers survive', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    expect(EXPORT_ENTRY_POINTS).toContain('./integration');
    expect(exportNamesOf('./integration').length).toBeGreaterThan(20);
    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders`).toEqual([]);
    }
    const integrationNames = exportNamesOf('./integration');
    for (const name of ['ConnectorSchema', 'DeclarativeConnectorEntrySchema', 'ConnectorActionSchema']) {
      expect(integrationNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('the integration barrel resolves without the retired schema', async () => {
    const integration = await import('./index');
    expect(integration).not.toHaveProperty('ConnectorTriggerSchema');
    expect(integration).toHaveProperty('ConnectorSchema');
  });
});

// ─── Tree-scoped absence, inside the radius already declared for this package ─
//
// What this leg guarantees. `tsc` is the primary sweeper — the retired key is
// typed `never` and the retired export is gone, so a TypeScript authoring site
// fails to compile. The residue is everything `tsc` never compiles: JSON, YAML,
// MD, MDX and untyped `.js` / `.mjs` / `.cjs`. This walk covers that residue
// across the five repo roots `scripts/cross-package-test-inputs.mjs` already
// declares for `@objectstack/spec#test` (the #15513 radius, mirrored in
// `turbo.json`), so a resurrection inside it puts this suite into
// `turbo ls --affected`. The bound, stated: `docs/**`, `.claude/**`,
// `.github/**` and the repo-root files are outside the walk.
//
// The matcher judges AUTHORING SHAPES, never a mention. The carrier key
// (`triggers`) and four of its five leaves (`key`, `label`, `description`,
// `intervalSeconds`) are too common a spelling to judge by text — `triggers:`
// is authored on every webhook — so they are held by `tsc` and the parse refusal
// above. What IS distinctive is held here: a `type: 'polling'` pair (the only
// schema that ever declared that value under a `type` key; the realtime
// `polling` transport lives under `transport`), and the retired def's exported
// names, imported from the spec package or used as a schema value.
describe('tree-scoped absence: nothing inside the declared radius still authors the family', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared (the #15513 bound). */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const NAMES = 'ConnectorTrigger';
  const AUTHORING = [
    // A polling trigger's `type` in key position (TS / JSON / YAML).
    /(^|[^\w.])["']?type["']?\s*:\s*["']polling["']/m,
    // The retired name imported from the spec package.
    new RegExp(`import\\s+(type\\s+)?\\{[^}]*\\b(${NAMES})(Schema|Parsed)?\\b[^}]*\\}\\s*from\\s*['"]@objectstack/spec`, 'm'),
    // The retired schema used as a value.
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
    // The declaring file: the tombstone and the removal record.
    'packages/spec/src/integration/connector.zod.ts',
    // The ledger row `retiredKey()` keeps in the walked shape.
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
    expect(judge("    triggers: [{ key: 'new_invoice', label: 'New invoice', type: 'polling', intervalSeconds: 60 }],")).not.toBeNull();
    expect(judge('  { "key": "new_lead", "type": "polling" }')).not.toBeNull();
    expect(judge('    type: polling')).toBeNull(); // bare YAML scalar: not this spelling, stated
    expect(judge("  - type: 'polling'   # yaml")).not.toBeNull();
    expect(judge("import { ConnectorTriggerSchema } from '@objectstack/spec/integration';")).not.toBeNull();
    expect(judge("import type {\n  Connector,\n  ConnectorTrigger,\n} from '@objectstack/spec';")).not.toBeNull();
    expect(judge('ConnectorTriggerSchema.parse({ key: "k" })')).not.toBeNull();
    expect(judge('type T = z.infer<typeof ConnectorTriggerSchema>;')).not.toBeNull();
    // ⛔ NARROWNESS of the strip: a real authoring sharing a line with inline code still counts.
    expect(judge("// see `actions` — type: 'polling',")).not.toBeNull();
    // Prose: the retirement kit must be able to describe what it removed.
    expect(judge("the `ConnectorTrigger` shape (`type: 'polling' | 'webhook'`) leaves with it")).toBeNull();
    expect(judge('"integration/ConnectorTrigger:type",')).toBeNull();
    // Neighbours that merely share a word: the realtime transport, a webhook
    // `triggers` list and a webhook-typed node stay legal.
    expect(judge("transport: 'polling',")).toBeNull();
    expect(judge("triggers: ['create', 'update'],")).toBeNull();
    expect(judge("  type: 'webhook',")).toBeNull();
    expect(judge("  subtype: 'polling',")).toBeNull();
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
