// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `connector.connectionTimeoutMs` RETIRED — ADR-0049 enforce-or-remove,
 * maintainer ruling 2026-09-22 letter A.
 *
 * The narrower SECOND decision this key was owed. The ruling that made its nine
 * ledger siblings live left this one dead on a stated reason: measured at the
 * fetch site, a connector's outbound call is a WHATWG `fetch`, whose only
 * cancellation surface is ONE `AbortSignal` covering the whole operation, so
 * nothing there observes the connect phase. The `实现` arm was therefore
 * unavailable and only `retire` was left.
 *
 * ⭐ WHAT MAKES THIS RETIREMENT UNUSUAL, and what a future reader must not
 * flatten: it is NOT the zero-mention shape. Five sites outside `packages/spec`
 * READ the key before this landed — the materialization fingerprint and the
 * provider-context build in the automation service, `ctx.connectionTimeoutMs`
 * in the `rest` and `openapi` provider factories, and the `?? 30000` fallbacks
 * that deposited it back onto the reported def. Every one was a pass-through:
 * the value's only termini were the def `GET /connectors` echoes and the
 * fingerprint that decides whether to re-materialize. `connectorFetchOptions()`
 * — the one mapping from authored policy onto the platform's outbound `fetch` —
 * was handed `{ retryConfig, requestTimeoutMs }` only. Carrying a number is not
 * honouring it, which is why ADR-0049 bit here despite the readers.
 *
 * Bookkeeping shapes, pinned below:
 *   1. `connectionTimeoutMs:` — `retiredKey()` tombstone on the non-strict
 *      `ConnectorSchema` (a bare deletion would be a SILENT STRIP, ADR-0104),
 *      inherited by `DeclarativeConnectorEntrySchema` (`superRefine`), so the
 *      refusal reaches `stack.connectors[]` and the `/meta/connector` door;
 *      `integration/Connector:connectionTimeoutMs` and
 *      `integration/DeclarativeConnectorEntry:connectionTimeoutMs` in
 *      `RETIRED_KEYS_BY_MAJOR[18]`.
 *   2. D2 conversion `connector-connection-timeout-ms-removed` in the step-18
 *      chain. Owed, not optional, and MEASURED rather than assumed: the
 *      `PUT /meta/connector/:name` door parses `DeclarativeConnectorEntrySchema`
 *      and persisted the authored value, and `applyConversionsToStoredItem` is
 *      live for the `connector` type — so a stored `sys_metadata` row can carry
 *      the key. Both legs are re-measured by the pins below rather than left to
 *      the reader.
 *   3. D3 semantic entry
 *      `connector-provider-context-connection-timeout-ms-retired` for the
 *      withdrawn `ConnectorProviderContext` member: a provider factory is code,
 *      so there is no authored source for a conversion to rewrite.
 *   4. No def leaves: the key was a bare `z.number()`, never a `ConfigSchema`
 *      shape, so `RETIRED_DEFS_BY_MAJOR[18]` gains nothing — asserted, because
 *      "zero baseline movement" reads differently per route
 *      (`spec-property-retirement` §2).
 *
 * On the assertion set (the #13823 precedent): a schema refusal raises a
 * `ZodError` whose issues carry `code` and `path` but no ADR-0112 `status` —
 * that envelope belongs to the API error surface. So these pins assert the
 * strongest set this surface really has: refusal, the issue `code`, the `path`
 * naming WHICH site refused, and the prescription text (#5240: where the
 * wording is the contract, pin the wording).
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
import { ConnectorSchema, DeclarativeConnectorEntrySchema, type Connector } from './connector.zod';

/** A well-formed catalog descriptor — every required key, none of the retired one. */
const WELL_FORMED = {
  name: 'ledger_api',
  label: 'Ledger API',
  type: 'api',
} as const;

/** A value an author used to be able to write: inside the old `min(1000).max(300000)` bounds. */
const AUTHORED_MS = 15000;

const PRESCRIPTION = /`connector\.connectionTimeoutMs`.*was removed.*17/s;

describe('connector.connectionTimeoutMs retirement — the tombstone', () => {
  it('REJECTS the authored key at path `connectionTimeoutMs`, carrying the prescription', () => {
    const result = ConnectorSchema.safeParse({ ...WELL_FORMED, connectionTimeoutMs: AUTHORED_MS });
    expect(result.success).toBe(false);
    if (result.success) return; // narrowing; the assertion above already failed

    const issue = result.error.issues.find((i) => i.path[0] === 'connectionTimeoutMs');
    expect(issue, 'the refusal must name `connectionTimeoutMs`').toBeDefined();
    // The machine-readable half of the envelope this surface actually has.
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['connectionTimeoutMs']);
    // …and the human half: the prescription IS the migration doc.
    expect(issue!.message).toMatch(PRESCRIPTION);
    // It must name the replacement, or an author who hits it learns only that
    // something is gone. `requestTimeoutMs` is the bound the platform keeps.
    expect(issue!.message).toContain('requestTimeoutMs');
  });

  it('the inherited carrier refuses it too, so `stack.connectors[]` and the /meta door are covered', () => {
    const entry = DeclarativeConnectorEntrySchema.safeParse({ ...WELL_FORMED, connectionTimeoutMs: AUTHORED_MS });
    expect(entry.success).toBe(false);

    // The registry lookup is the real `PUT /meta/connector/:name` entry point:
    // a rebinding that pointed `connector` at some third shape would pass the
    // pin above and still accept the key in production.
    const door = getMetadataTypeSchema('connector');
    expect(door, 'no schema bound for `connector`').toBeDefined();
    expect(door!.safeParse({ ...WELL_FORMED, connectionTimeoutMs: AUTHORED_MS }).success).toBe(false);

    const stack = ObjectStackSchema.safeParse({
      connectors: [{ ...WELL_FORMED, connectionTimeoutMs: AUTHORED_MS }],
    });
    expect(stack.success).toBe(false);
    if (stack.success) return;
    const issue = stack.error.issues.find((i) => i.path.join('.') === 'connectors.0.connectionTimeoutMs');
    expect(issue, 'the stack refusal must locate the key').toBeDefined();
    expect(issue!.path).toEqual(['connectors', 0, 'connectionTimeoutMs']);

    // CONTROL: the same three doors accept the same connector WITHOUT the key,
    // so the refusals above are attributable to `connectionTimeoutMs` alone.
    expect(DeclarativeConnectorEntrySchema.safeParse(WELL_FORMED).success).toBe(true);
    expect(door!.safeParse(WELL_FORMED).success).toBe(true);
    expect(ObjectStackSchema.safeParse({ connectors: [WELL_FORMED] }).success).toBe(true);
  });

  it('parses a well-formed connector and grows no `connectionTimeoutMs` property', () => {
    const parsed = ConnectorSchema.parse({ ...WELL_FORMED });
    expect(parsed.name).toBe('ledger_api');
    // CONTROL: the live defaults on this schema still apply, so an empty
    // reading below is the retirement and not a schema that stopped defaulting.
    expect(parsed.enabled).toBe(true);
    expect(parsed.requestTimeoutMs).toBe(30000);
    // The non-strict strip path: absence must stay absence. If the tombstone
    // were ever replaced by a plain deletion, an authored `connectionTimeoutMs`
    // would be stripped in silence — this pin plus the refusals above are what
    // make that regression loud.
    expect(parsed).not.toHaveProperty('connectionTimeoutMs');
  });

  it('fails tsc at the authoring site: the input type of the key is `never`', () => {
    const connector: Connector = {
      ...WELL_FORMED,
      // @ts-expect-error — `connectionTimeoutMs` is a retiredKey() tombstone:
      // its input type is `never`, so a typed literal cannot carry it.
      connectionTimeoutMs: AUTHORED_MS,
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(ConnectorSchema.safeParse(connector).success).toBe(false);
  });
});

describe('connector.connectionTimeoutMs retirement — the D2 conversion, and why one is owed', () => {
  it('a STORED connector row can carry the key — the measurement that made D2 owed', () => {
    // ⭐ This is the ruling's one deliberately-unanswered question ("the dev
    // measures"), re-taken here so it cannot rot into an assumption. Two legs:
    //
    //  1. The write door persists what it parses. `getMetadataTypeSchema
    //     ('connector')` is what `PUT /api/v1/meta/connector/:name` validates
    //     against, and before the tombstone its output RETAINED the authored
    //     value — so the number reached `sys_metadata`. It is refused now, which
    //     is exactly why rows written before this release still hold it.
    //  2. The rehydration seam is live for this type: a stored `connector` row
    //     replayed through `applyConversionsToStoredItem` reaches the conversion
    //     chain at all. Measured by the strip below rather than assumed.
    //
    // Had EITHER leg come back empty — no schema bound for `connector`, or a
    // seam that never reaches this type — the answer would have been D3-only,
    // which is what the ruling's prescription alone would have produced.
    const stored: Record<string, unknown> = {
      ...WELL_FORMED,
      connectionTimeoutMs: AUTHORED_MS,
      requestTimeoutMs: 12000,
    };
    const notices: { conversionId?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('connector', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string }),
    }) as Record<string, unknown>;

    expect(notices.map((n) => n.conversionId)).toContain('connector-connection-timeout-ms-removed');
    expect(rehydrated).not.toHaveProperty('connectionTimeoutMs');
    // CONTROL: the seam rewrote the retired key and nothing else — the live
    // sibling on the same row survives byte-for-byte.
    expect(rehydrated.requestTimeoutMs).toBe(12000);
    expect(rehydrated.name).toBe('ledger_api');
  });

  it('strips the key from `connectors[]` — one attributed notice per connector', () => {
    const { stack, notices } = collectConversionNotices(
      {
        connectors: [
          { ...WELL_FORMED, connectionTimeoutMs: AUTHORED_MS },
          // Never authored the key: rides through untouched.
          { name: 'inventory_sync', label: 'Inventory Sync', type: 'saas' },
        ],
      },
      { includeRetired: true },
    );
    expect(stack).toEqual({
      connectors: [
        { name: 'ledger_api', label: 'Ledger API', type: 'api' },
        { name: 'inventory_sync', label: 'Inventory Sync', type: 'saas' },
      ],
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      conversionId: 'connector-connection-timeout-ms-removed',
      toMajor: 18,
      path: 'connectors[0].connectionTimeoutMs',
    });
    // And the stripped entry parses through the real authoring schema: the
    // conversion output is exactly what the tombstone accepts.
    const stripped = (stack.connectors as unknown[])[0];
    expect(DeclarativeConnectorEntrySchema.safeParse(stripped).success).toBe(true);

    // Idempotence, measured rather than asserted from `stripKeys`'s shape: a
    // second replay over the converted snapshot converts nothing — zero
    // notices, and the copy-on-write contract hands the input back by reference.
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });
});

describe('connector.connectionTimeoutMs retirement — ADR-0087 registration', () => {
  it('declares both carrier keys under major 18, with the D2 conversion in the step-18 chain', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('integration/Connector:connectionTimeoutMs');
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('integration/DeclarativeConnectorEntry:connectionTimeoutMs');

    const step = MIGRATIONS_BY_MAJOR[18];
    expect(step, 'the step-18 chain must exist').toBeDefined();
    expect(step!.conversionIds).toContain('connector-connection-timeout-ms-removed');
  });

  it('declares the withdrawn provider-context member as a D3 semantic entry', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]!.semantic
      .find((s) => s.id === 'connector-provider-context-connection-timeout-ms-retired');
    expect(entry, 'the withdrawn ConnectorProviderContext member needs its own D3 entry').toBeDefined();
    // Non-empty by contract (`spec-property-retirement` §3), and it must name
    // the replacement rather than only the removal.
    expect(entry!.reason.length).toBeGreaterThan(0);
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(entry!.replacement).toContain('requestTimeoutMs');
  });

  it('retires NO def — the key was a bare number, not a config shape', () => {
    // Route-dependent reading (`spec-property-retirement` §2): on a whole-def
    // removal the four ratchets MUST move, on a key-only tombstone they move by
    // exactly the `[RETIRED]` row. Asserting the def table is untouched keeps a
    // future reader from judging this retirement against the wrong expectation.
    for (const def of RETIRED_DEFS_BY_MAJOR[18] ?? []) {
      expect(def, 'no integration def leaves with this key').not.toMatch(/^integration\/Connector(Timeout|Connection)/);
    }
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// What this leg guarantees. `tsc` is the primary sweeper — `retiredKey()` types
// the key `never`, so every TypeScript authoring site in the monorepo fails to
// compile. The residue is everything `tsc` never compiles: JSON, YAML, MD, MDX
// and untyped `.js` / `.mjs` / `.cjs`. This walk covers that residue across five
// repo roots, each already declared for `@objectstack/spec#test` in
// `scripts/cross-package-test-inputs.mjs` and mirrored in `turbo.json`, so a
// resurrection inside the radius puts this suite into `turbo ls --affected`.
// ⛔ A tree-scoped pin whose radius is undeclared is not a completed retirement
// (`spec-property-retirement` §4) — the declaration is half the pin.
//
// The bound, stated: `docs/**`, `.claude/**`, `.github/**` and the repo-root
// files are outside the walk, as they are for the #15513 pin this copies.
//
// The matcher judges an AUTHORING SHAPE, never a mention: `connectionTimeoutMs`
// in key position, or read off an object. Prose about the retirement spells the
// name inside backticks and is not matched — which is what lets the retirement
// kit itself describe what it removed without reporting itself as an offender.
describe('tree-scoped absence: nothing inside the declared radius still authors the key', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared (the #15513 bound). */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /**
   * An AUTHORING of the key, never a prose mention:
   *   - key position — `connectionTimeoutMs:` in TS/JSON/YAML, not preceded by
   *     a word character (a longer identifier ending in this name);
   *   - a member read — `.connectionTimeoutMs`, i.e. a consumer pulling the
   *     value back off an object.
   */
  const AUTHORING = /(^|[^\w.])connectionTimeoutMs["']?\s*:|\.connectionTimeoutMs\b/m;

  /**
   * Prose mentions are spelled in INLINE CODE throughout this repo — the house
   * style `check:doc-authoring` enforces — so stripping single-backtick spans
   * separates "the retirement kit describing what it removed" from "a source
   * still writing it". Deliberately newline-bounded: a fenced block's content
   * is NOT stripped, so an authoring inside a fenced example is still caught.
   */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');

  /**
   * Structural exclusions — the retirement kit and its projections, each with
   * its reason. ⛔ NOT an allowlist file (`spec-property-retirement` §4): every
   * entry is a file whose JOB is to spell the retired key.
   */
  const EXCLUDED = new Set([
    // The tombstone itself — the key is still a property of the walked shape.
    'packages/spec/src/integration/connector.zod.ts',
    // The ledger row, which `retiredKey()` keeps in the walked shape.
    'packages/spec/liveness/connector.json',
    // The pin that holds a stray leftover to reaching nothing.
    'packages/spec/src/integration/connector-fetch-policy.test.ts',
    // The host-side negative pin: it authors the key to prove the carry is gone.
    'packages/services/service-automation/src/connector-materialization.test.ts',
    // This pin names it to assert its absence.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion, its fixture and the strip target.
    'packages/spec/src/conversions/',
    // Registers the retirement by key (entries + the generated registry).
    'packages/spec/src/migrations/',
    // Generated projections of the registry.
    'packages/spec/spec-changes.json',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    '.changeset/',
    // GITIGNORED build output (`.gitignore` line for `packages/spec/json-schema/`),
    // reached only because this is a FILESYSTEM walk rather than a git walk.
    // `retiredKey()` emits the tombstoned property into the generated JSON
    // Schema, exactly as it already does for the two retired siblings on this
    // same schema — measured: `Connector.json` carries `rateLimitConfig` and
    // `errorMapping` the same way. Excluding it costs no coverage: the source
    // it is generated from is `connector.zod.ts`, which this walk reads.
    'packages/spec/json-schema/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build (#15513's measured ENOENT). */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const vanished: string[] = [];
  /**
   * Read a path the walk enumerated, tolerating ONLY its disappearance: a path
   * that no longer exists cannot be an authoring that SURVIVES. ⛔ Every other
   * read failure is re-raised — a blanket `catch` would turn an unreadable tree
   * into a silent green.
   */
  const readIfPresent = (full: string, rel: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      vanished.push(rel);
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores a prose mention (anti-vacuity)', () => {
    const judge = (line: string): boolean => AUTHORING.test(stripInlineCode(line));

    expect(judge('  connectionTimeoutMs: 30000,')).toBe(true);
    expect(judge('connectionTimeoutMs: 5000')).toBe(true);
    expect(judge('  "connectionTimeoutMs": 30000,')).toBe(true);
    expect(judge('connectionTimeoutMs: 15000   # yaml')).toBe(true);
    expect(judge('const ms = ctx.connectionTimeoutMs;')).toBe(true);
    expect(judge('entry.connectionTimeoutMs ?? null')).toBe(true);
    // ⛔ NARROWNESS of the strip: it must not swallow a real authoring that
    // merely shares a line with inline code, or the pin goes quiet.
    expect(judge('// see `requestTimeoutMs` — connectionTimeoutMs: 30000,')).toBe(true);
    // Prose: the retirement kit must be able to describe what it removed.
    expect(judge('`connectionTimeoutMs` was removed in @objectstack/spec 17')).toBe(false);
    expect(judge('the factories read `ctx.connectionTimeoutMs` only to echo it')).toBe(false);
    expect(judge('| **connectionTimeoutMs** | `never` | optional | [REMOVED] `connector.connectionTimeoutMs` was removed |')).toBe(false);
    expect(judge('the connectionTimeoutMs key is gone')).toBe(false);
    expect(judge('"integration/Connector:connectionTimeoutMs",')).toBe(false);
    // A longer identifier that merely ends in the name is not this key.
    expect(judge('  defaultConnectionTimeoutMs: 30000,')).toBe(false);
  });

  it('a path that VANISHES mid-walk is not a finding, and every other read fault still is', () => {
    const before = vanished.length;
    const gone = path.join(REPO_ROOT, 'packages/spec/does-not-exist.bundled_probe.mjs');
    expect(fs.existsSync(gone)).toBe(false);
    expect(readIfPresent(gone, 'probe/gone')).toBeUndefined();
    expect(vanished.slice(before)).toEqual(['probe/gone']);
    // POSITIVE CONTROL: a path that IS there is read, so the guard cannot be
    // passing by refusing to read anything.
    expect(readIfPresent(fileURLToPath(import.meta.url), THIS_FILE)).toContain('tree-scoped absence');
    expect(vanished.length).toBe(before + 1);
    // ⛔ A NON-ENOENT fault is re-raised: reading a DIRECTORY raises EISDIR.
    expect(() => readIfPresent(path.join(REPO_ROOT, 'packages/spec'), 'probe/dir')).toThrow();
    expect(vanished.length).toBe(before + 1);
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
        const text = readIfPresent(full, rel);
        if (text === undefined) continue;
        const m = AUTHORING.exec(stripInlineCode(text));
        if (m) offenders.push(`${rel} authors \`${m[0].trim()}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree.
    expect(visited).toBeGreaterThan(1000);
    expect(offenders, 'an authoring of the retired key means the retirement is being undone').toEqual([]);
  });
});
