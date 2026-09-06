#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-duration-unit-keys — a duration-shaped `z.number()` key carries its
 * unit in its NAME, never only in its `.describe()` prose (#14478, maintainer
 * ruling 2026-09-02, recorded on the card as "ruled B").
 *
 *   tsx scripts/check-duration-unit-keys.ts               # gate: exit 1 on any offender
 *   tsx scripts/check-duration-unit-keys.ts --self-test   # prove the detector still detects
 *   tsx scripts/check-duration-unit-keys.ts --list        # every duration-shaped number key it sees
 *   tsx scripts/check-duration-unit-keys.ts --root <dir>  # judge another tree (ablation / demo), same rule
 *
 * ## The defect class
 *
 * `metadata-loader.zod.ts` carried two keys spelled `ttl` fourteen lines apart:
 * `cache.ttl` in SECONDS (default 3600) and `cache.databaseLoader.ttl` in
 * MILLISECONDS (default 60_000). Both `.describe()` strings named their unit;
 * the key names did not. An author — very often a model (ADR-0033) — who copies
 * the outer `3600` into the inner block gets a 3.6-second cache and no error
 * anywhere: the number is valid, the type is right, the cache is simply cold.
 * `Hook.timeout`, `Job.timeout` and `DriverOptions.timeout` had the same shape
 * (milliseconds, said only in prose) beside siblings that spell it (`backoffMs`,
 * `intervalMs`, `timeoutMs` on the script body), so the population carried two
 * conventions and the wrong one was indistinguishable at the authoring site.
 *
 * The published reference pages make it worse, not better: `.describe()` is
 * what `content/docs/references/**` renders and the JSDoc above a key is NOT —
 * so a key whose unit lives in the JSDoc alone (`tenant.zod.ts`'s
 * `idleTimeout` / `sessionTimeout`, "in seconds" one line above the key and
 * absent from the describe) publishes a bare number to exactly the reader who
 * never sees the source. That reader was the one #14519 was filed for.
 *
 * ## The rule
 *
 * For every property whose value is a numeric Zod chain — a chain rooted at
 * `z.number()`, `z.int()` or `z.coerce.number()` — in every workspace package's
 * `src/**` (tests, build output and installed dependencies excluded):
 * if its `.describe()` names a time unit (milliseconds, seconds, minutes,
 * hours, days — plus their short forms), the key NAME must carry a unit
 * token, and that token must be one the describe names. Two failure
 * directions, one rule: `ttl` with "in seconds" fails (no unit in the name);
 * `ttlMs` with "in seconds" fails too (the name names the WRONG unit — the
 * 1000× bug wearing a false sense of safety).
 *
 * A unit-carrying VALUE is the other sanctioned spelling and is not a number,
 * so it is outside the population by construction: `LIFECYCLE_DURATION_REGEX`
 * literals (`'14d'`) are strings, and the `{ value, unit }` pairs of
 * `disaster-recovery.zod.ts` put the unit in a sibling enum. The one numeric
 * shape that legitimately carries no unit in its name is that pair's `value`
 * — recognised structurally, by the sibling `unit` key on the same object
 * literal, never by name.
 *
 * ## What `--list` reports and the verdict does NOT judge: no unit anywhere
 *
 * A duration-SHAPED name (`sessionTimeout`, `flushInterval`) whose describe
 * names no unit at all is the #14519 shape — the reference-page reader gets a
 * bare `3600`. It is outside this verdict on purpose, and the reason is
 * measured, not aesthetic: judged by name alone on `ca46f8f12` (2026-09-04)
 * that rule fired 44 times, and most were counts wearing a duration's
 * vocabulary — `contextWindow`, `slidingWindowSize`, `snapshotInterval`
 * ("every N events"), `reflectionInterval` ("every N interactions"),
 * `backoffMultiplier`, `staleKeys`. A rule that cannot tell a window of
 * tokens from a window of seconds would either grandfather those by name
 * (an exception list) or teach authors to append `Ms` to a count. The
 * describe-driven rule has no such ambiguity: prose that says "seconds" is
 * talking about time. `--list` still prints the unit-nowhere keys so the
 * population stays visible; closing it is a describe-by-describe decision.
 *
 * ## The two exemptions, DECLARED ON THE SCHEMA (#15676, ruling B)
 *
 * The rule governs every authored and every runtime-emitted duration MINUS two
 * structural classes, and the ruling is explicit about the mechanism: they are
 * "declared ON THE SCHEMA, never in a gate ledger". So neither of them appears
 * in this file as a key, a path or a name. What appears here is the ability to
 * READ a declaration the schema itself carries.
 *
 * 1. **Epoch instants** — a key whose value IS the shared {@link INSTANT_ROOT}
 *    schema (`EpochMs`, `src/shared/epoch.zod.ts`) is an INSTANT, not a
 *    duration. An instant is numerically the same shape and its describe names
 *    the same unit, but it is a different confusion: renaming `startTime` to
 *    `startTimeMs` would move it into the `*Ms` DURATION family (measured on
 *    this package's authorable surface: all 51 distinct `*Ms` keys are
 *    durations, all 51 distinct `*At` keys are instants), which is the opposite
 *    of what the rule is for. The instant is spelled `*At` and typed `EpochMs`.
 *
 * 2. **External-standard mirrors** — a key that carries
 *    `.meta({ externalVocabulary: '<the standard>' })` mirrors a name fixed
 *    outside this repo (`max-age` from HTTP Cache-Control, `statement_timeout`
 *    from PostgreSQL, better-auth's option names). Renaming it would break the
 *    correspondence that makes it readable. The marker rides `z.toJSONSchema`
 *    verbatim — the same channel `xRef` / `xExpression` / `xEnumDeprecated` use
 *    — so the reference page prints the unit as "per the named standard"
 *    (`scripts/lib/schema-section.ts`) instead of the reader having to guess.
 *
 * ⛔ Neither exemption is a pass on lying. A marked key still fails
 * `name-unit-contradicts-prose` (a marker waives the RENAME, never a
 * contradiction), and an `EpochMs` key whose describe names a unit other than
 * milliseconds fails `instant-unit-contradicts-schema` — the schema says
 * milliseconds, so prose that says seconds is one of the two being wrong. A
 * declaration that could never be refused is an allowlist wearing a `.meta()`.
 *
 * Both classes stay VISIBLE in the census: `--list` marks them and the verdict
 * line counts them. An exemption nobody can see is the ledger this ruling
 * refused.
 *
 * ## No baseline, by ruling
 *
 * Triage proposed a ratchet from the day's count with the existing keys
 * grandfathered. The maintainer adopted the alternative: convert every
 * offender under ADR-0087 in the same PR and let the gate demand ZERO. A
 * ratchet baseline is a named list of permanent exceptions, and the standing
 * rules that decided it are quoted on the card — 「不考虑存量」 and 「项目在创
 * 业阶段,用户也很少,短期不考虑渐进。」. So this script has no ledger, no
 * `--update`, and no `gen:`. A red here is a rename (with its ADR-0087
 * conversion) or a describe to fix, never a command to run.
 *
 * ## The population: every workspace package's `src/**` (#15682)
 *
 * The rule is about how a duration is DECLARED, and the declaration is the same
 * defect wherever it is written: a `timeout` whose unit lives only in its
 * describe misleads an author identically in `packages/spec` and in a driver
 * package that publishes its own connection-config schema. This gate walked
 * `packages/spec/src/**` alone until #15682 widened it to every workspace
 * member's `src/` subtree. Measured across the widening on this tree: 2291
 * source files against 838, and exactly one offender outside `packages/spec` —
 * `@objectstack/driver-turso`'s published `config.timeout`, renamed in the same
 * PR that widened the walk.
 *
 * Members are enumerated through the shared `workspace-enumerator` module (the
 * ONE parse of `pnpm-workspace.yaml`) rather than a private copy of that parse,
 * and {@link ROOT_DIR_WATCH_HINTS} is held against the live globs in BOTH
 * directions by the self-test. `src/` is the whole boundary and that is
 * measured rather than assumed: all 210 tracked `*.zod.ts` files in this repo
 * live under some workspace member's `src/`.
 *
 * ⛔ THE WALK EXCLUDES `node_modules`, BUILD OUTPUT AND TEST FILES, AND THE
 * SELF-TEST PINS IT BEHAVIOURALLY. Measured on #15642 before the exclusion
 * existed: pointing `--root` at a package ROOT walked that package's installed
 * dependencies and reported *"7151 offender(s) … in 150098 source file(s)"*.
 * That is not a finding, it is a LOST POPULATION — a reading about this repo's
 * dependencies wearing this gate's verdict line, and a widened gate reporting
 * thousands of offenders has not found a problem, it has stopped describing
 * this repo. A `dist/` tree is the same hazard one step on: it re-reports every
 * offender its own source already carries, so one rename reads as two.
 * {@link SKIP_DIRS} is applied to the WALK rather than to the roots, so an
 * explicit `--root` cannot route around it. On this tree the exclusion removes
 * nothing tracked: no tracked file under any member's `src/` sits below a
 * skipped directory name.
 *
 * ## Why here and not `packages/lint`
 *
 * `@objectstack/lint` validates a customer's METADATA GRAPH at build time —
 * pure `(stack) => Issue[]` functions the CLI and AI authoring share. This
 * gate reads this package's own SOURCE and judges how a schema is declared;
 * it has no stack to validate and nothing a customer could run it on. That is
 * the shape of every other source audit in this directory
 * (`check-exported-any`, `check-dual-source-exports`, `check-error-code-
 * provenance`), and `check:generated` classifies it the same way: NO_GENERATOR.
 *
 * ## What it deliberately does not judge
 *
 * - Calendar POSITIONS are not durations: `dayOfMonth` "Day of the month
 *   (1-31)", `hour` "Hour of the day (0-23)". They are recognised by the
 *   position idioms in {@link POSITION_IDIOMS} and skipped.
 * - RATES are not durations either: "requests per second" names a unit, but
 *   the number is a count. Recognised by the `per <unit>` idiom and skipped.
 * - A chain rooted anywhere else (`z.string()`, an imported schema constant)
 *   is outside the population. Widening it is a decision, not a bug fix.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { isExclusionGlob, readWorkspaceGlobs, workspacePackageDirs } from '../../../scripts/workspace-enumerator.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(pkgRoot, '..', '..');

/**
 * The dispatch-gates declaration — the `ROOT_DIR_WATCH_HINTS` idiom (#12310).
 * `scripts/pm/dispatch-gates.mjs` derives which gates a card must run from the
 * path literals in each gate's source, and `check:declared-population-live`
 * refuses a gate whose only path-shaped literal names nothing in the tree.
 *
 * Since #15682 this gate walks every workspace member's `src/` subtree, so that
 * is what it declares — one entry per workspace glob, as LITERALS. The literal
 * spelling is load-bearing rather than stylistic: the extractor reads SOURCE
 * TEXT, so the same array computed from the workspace parse contributes no hint
 * at all and the gate drops silently out of every dispatch brief
 * (`check:watch-hint-literal` refuses that spelling for exactly this reason).
 *
 * The self-test holds these entries against the LIVE `pnpm-workspace.yaml`
 * globs in both directions. Each direction has its own silent failure: a
 * workspace root added there and not here leaves this gate walking a tree no
 * card is ever dispatched for, and an entry here the workspace no longer
 * declares announces a population nothing reads.
 */
export const ROOT_DIR_WATCH_HINTS = [
  'packages/*/src/**',
  'packages/apps/*/src/**',
  'packages/drivers/*/src/**',
  'packages/plugins/*/src/**',
  'packages/qa/*/src/**',
  'packages/triggers/*/src/**',
  'packages/services/*/src/**',
  'packages/adapters/*/src/**',
  'packages/connectors/*/src/**',
  'apps/*/src/**',
  'examples/*/src/**',
];

/** Canonical unit → every spelling the describe prose or a key token may use. */
const UNIT_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  ms: ['ms', 'msec', 'msecs', 'millis', 'millisecond', 'milliseconds'],
  seconds: ['sec', 'secs', 'second', 'seconds'],
  minutes: ['minute', 'minutes'],
  hours: ['hr', 'hrs', 'hour', 'hours'],
  days: ['day', 'days'],
};

/** Key-name tokens accepted as carrying a unit. Deliberately NOT `min`/`mins`
 *  — in a key name `min` means minimum (`minDelay`), and reading it as
 *  minutes would flag `minAgeSeconds`-style keys for a mismatch they do not have. */
const KEY_TOKEN_UNITS: ReadonlyMap<string, string> = new Map(
  Object.entries(UNIT_SPELLINGS).flatMap(([unit, spellings]) => spellings.map((s) => [s, unit] as const)),
);

/**
 * Prose spellings. PLURAL and short forms stand on their own ("in seconds",
 * "(ms)", "5 mins"); a SINGULAR form counts only when a number precedes it
 * ("1 second", "15-minute", "one day" is not counted — write the digit). The
 * asymmetry is what keeps two measured false positives out: the ordinal
 * "second" ("deferred to second pass") and `min` as MINIMUM ("min 5MB",
 * "the same class as `min`"), both of which read as units to a bare word
 * match and neither of which is one.
 */
const PROSE_PLURAL_RE = /\b(milliseconds|millis|msecs|ms|seconds|secs|minutes|mins|hours|hrs|days)\b/gi;
const PROSE_COUNTED_RE = /\b\d+(?:[.,]\d+)?[\s-]*(millisecond|msec|ms|second|sec|minute|min|hour|hr|day)s?\b/gi;

function proseUnitOf(spelling: string): string {
  const s = spelling.toLowerCase().replace(/s$/, '');
  switch (s) {
    case 'millisecond': case 'milli': case 'msec': case 'm': return 'ms';
    case 'second': case 'sec': return 'seconds';
    case 'minute': case 'min': return 'minutes';
    case 'hour': case 'hr': return 'hours';
    case 'day': return 'days';
    default: return s;
  }
}

/** A describe that names a unit as part of a calendar POSITION, not a duration. */
const POSITION_IDIOMS: readonly RegExp[] = [
  /\b(day|hour|minute|second)s?\s+of\s+(the\s+)?(week|month|year|day|hour|minute)\b/i,
  /\b(weekday|month|year)\b/i,
  /\(0-(23|59|6)\)/,
  /\b1-31\b/,
];

/** A describe that names a unit as the denominator of a RATE. */
const RATE_IDIOM = /\b(per|a|each|every)\s+(milli)?(second|minute|hour|day)\b/i;

/** Key names (or key-name tokens) that read as a duration even when no unit is named anywhere. */
const DURATION_SHAPED_TOKENS = new Set([
  'timeout', 'ttl', 'interval', 'delay', 'duration', 'maxage', 'expireafter', 'retention',
  'cooldown', 'debounce', 'throttle', 'window', 'grace', 'lifetime', 'expiry', 'expiration',
  'heartbeat', 'backoff', 'idle', 'stale', 'age', 'period', 'every', 'wait', 'timeouts',
]);

const NUMERIC_ROOTS = new Set(['z.number', 'z.int', 'z.coerce.number']);

/**
 * The shared epoch-instant schema — exemption class (i), read from the SOURCE
 * TEXT as the identifier a property's value chain is rooted at.
 *
 * Recognised by NAME rather than by resolving the import, for the same reason
 * the whole file is a syntactic scan: a detector with no module resolution
 * cannot fail to resolve in CI. The coupling that keeps the name honest is a
 * self-test case which reads `src/shared/epoch.zod.ts` and asserts it really
 * exports this symbol — so renaming the schema without renaming it here is RED,
 * not a silently-empty exemption.
 */
const INSTANT_ROOT = 'EpochMs';
/** Where {@link INSTANT_ROOT} is declared — read by the self-test, not by the scan. */
const INSTANT_ROOT_MODULE = 'src/shared/epoch.zod.ts';

/**
 * The `.meta()` key that declares exemption class (ii). A key carrying it
 * mirrors a name fixed by an external standard, so the RENAME is waived — never
 * the contradiction check, and never the requirement that the describe still
 * state the unit.
 */
const EXTERNAL_VOCABULARY_META_KEY = 'externalVocabulary';

export interface DurationKey {
  file: string;
  line: number;
  key: string;
  describe: string | undefined;
  /** units the describe prose names (canonical) */
  proseUnits: string[];
  /** units the key name carries (canonical) */
  keyUnits: string[];
  /** true when a sibling `unit` key sits on the same object literal */
  valueUnitPair: boolean;
  durationShaped: boolean;
  /** true when the value chain is rooted at the shared `EpochMs` schema — exemption (i) */
  instant: boolean;
  /** the standard named by `.meta({ externalVocabulary })`, when one is declared — exemption (ii) */
  externalVocabulary: string | undefined;
}

export interface Finding {
  site: DurationKey;
  rule:
    | 'unit-in-prose-not-in-name'
    | 'name-unit-contradicts-prose'
    | 'instant-unit-contradicts-schema';
  message: string;
}

// ── tokenising ─────────────────────────────────────────────────────────────

/** `ttlMs` → ['ttl','ms']; `idle_timeout_seconds` → ['idle','timeout','seconds']; `HTTPTimeoutMs` → ['http','timeout','ms'] */
export function keyTokens(key: string): string[] {
  return (key.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? []).map((t) => t.toLowerCase());
}

export function unitsInKey(key: string): string[] {
  const out = new Set<string>();
  for (const t of keyTokens(key)) {
    const u = KEY_TOKEN_UNITS.get(t);
    if (u) out.add(u);
  }
  return [...out];
}

export function unitsInProse(describe: string | undefined): string[] {
  if (!describe) return [];
  if (POSITION_IDIOMS.some((re) => re.test(describe))) return [];
  const withoutRates = describe.replace(new RegExp(RATE_IDIOM.source, 'gi'), ' ');
  const out = new Set<string>();
  for (const m of withoutRates.matchAll(PROSE_PLURAL_RE)) out.add(proseUnitOf(m[1]));
  for (const m of withoutRates.matchAll(PROSE_COUNTED_RE)) out.add(proseUnitOf(m[1]));
  return [...out];
}

export function isDurationShaped(key: string): boolean {
  const toks = keyTokens(key);
  if (toks.some((t) => DURATION_SHAPED_TOKENS.has(t))) return true;
  // `maxAge` / `expireAfter` split into two tokens each; test the joined pairs too.
  for (let i = 0; i + 1 < toks.length; i++) {
    if (DURATION_SHAPED_TOKENS.has(toks[i] + toks[i + 1])) return true;
  }
  return false;
}

// ── AST ────────────────────────────────────────────────────────────────────

/**
 * Walk a `z.x().y().z()` chain to its root.
 *
 * Returns the root's dotted name (`z.number`, `z.coerce.number`) OR, when the
 * chain bottoms out at a plain identifier, that identifier — which is how a key
 * declared as `EpochMs` / `EpochMs.optional().describe(…)` is recognised as
 * exemption class (i) rather than vanishing from the population as an
 * unresolvable root. Every OTHER identifier root (`PositiveInt.describe(…)`)
 * stays outside the population exactly as before: `collectDurationKeys` admits
 * only the roots it knows.
 *
 * Also collects, from the same single pass:
 *   - every `.describe()` string;
 *   - `description` and `externalVocabulary` from `.meta({ … })` — `.meta()` is
 *     the repo's established annotation channel (`xRef`, `xExpression`,
 *     `xEnumDeprecated`) and it MERGES with a `.describe()` earlier in the
 *     chain rather than replacing it (measured against zod 4.4.3), so the two
 *     spellings coexist on one key.
 *
 * Reading `description` out of `.meta()` closes a hole rather than adding a
 * feature: without it, moving a describe into `.meta({ description })` would
 * take a key out of this gate's population SILENTLY — an exemption by
 * blindness, which is precisely what ruling B refuses. (Measured on this tree:
 * exactly one numeric key declares its description that way — `data/Field`'s
 * `precision`, "Decimal precision (default: 2)" — so the reading adds no
 * offender today. It stops the next one.)
 */
function chainInfo(expr: ts.Expression): {
  root: string | undefined;
  describes: string[];
  metaDescription: string | undefined;
  externalVocabulary: string | undefined;
} {
  const describes: string[] = [];
  let metaDescription: string | undefined;
  let externalVocabulary: string | undefined;
  let cur: ts.Expression = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (ts.isIdentifier(cur)) {
      // A bare schema constant, or the receiver a chain bottomed out at:
      // `createdAt: EpochMs` / `createdAt: EpochMs.optional()`.
      return { root: cur.text, describes, metaDescription, externalVocabulary };
    }
    if (!ts.isCallExpression(cur)) return { root: undefined, describes, metaDescription, externalVocabulary };
    if (!ts.isPropertyAccessExpression(cur.expression)) {
      // `someHelper(...)` — a call whose callee is not `a.b`; not a `z.` root
      return { root: undefined, describes, metaDescription, externalVocabulary };
    }
    const method = cur.expression.name.text;
    if (method === 'describe' && cur.arguments.length > 0) {
      const a = cur.arguments[0];
      const text = concatLiteral(a);
      if (text !== undefined) describes.push(text);
    }
    if (method === 'meta' && cur.arguments.length > 0) {
      const a = cur.arguments[0];
      if (ts.isObjectLiteralExpression(a)) {
        for (const prop of a.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const name = ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name) ? prop.name.text : undefined;
          if (name === undefined) continue;
          // Only a non-empty STRING LITERAL declares anything. A computed value,
          // a template with holes or an empty string is not a standard's name,
          // and an unverifiable claim is refused rather than assumed true — so
          // the key stays in the population and stays judged.
          const value = concatLiteral(prop.initializer);
          if (name === 'description' && value !== undefined && metaDescription === undefined) {
            metaDescription = value;
          }
          if (name === EXTERNAL_VOCABULARY_META_KEY && value !== undefined && value.trim() !== ''
              && externalVocabulary === undefined) {
            externalVocabulary = value;
          }
        }
      }
    }
    // The callee `a.b.c` — collect its dotted parts down to whatever `a` is.
    const parts: string[] = [];
    let p: ts.Expression = cur.expression;
    while (ts.isPropertyAccessExpression(p)) { parts.unshift(p.name.text); p = p.expression; }
    if (ts.isIdentifier(p) && p.text === 'z') {
      // reached `z.number(...)` / `z.coerce.number(...)`: this call is the root
      return { root: ['z', ...parts].join('.'), describes, metaDescription, externalVocabulary };
    }
    // otherwise `p` is the receiver of this method call — keep walking down it
    cur = p;
  }
}

function concatLiteral(e: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(e)) return e.text;
  if (ts.isParenthesizedExpression(e)) return concatLiteral(e.expression);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = concatLiteral(e.left);
    const r = concatLiteral(e.right);
    if (l === undefined || r === undefined) return undefined;
    return l + r;
  }
  return undefined;
}

/** Every numeric-chain property in one source text. */
export function collectDurationKeys(fileName: string, code: string): DurationKey[] {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, /* setParentNodes */ true, ts.ScriptKind.TS);
  const out: DurationKey[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : undefined;
      if (name) {
        const { root, describes, metaDescription, externalVocabulary } = chainInfo(node.initializer);
        const instant = root === INSTANT_ROOT;
        if (root && (NUMERIC_ROOTS.has(root) || instant)) {
          const siblings = node.parent.properties;
          const valueUnitPair = siblings.some(
            (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'unit',
          );
          // An explicit `.describe()` wins over a `.meta({ description })`: it is
          // what every site in this tree writes, and where a key carries both,
          // the describe is the one an author reads at the declaration.
          const describe = describes.length ? describes[describes.length - 1] : metaDescription;
          out.push({
            file: fileName,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            key: name,
            describe,
            proseUnits: unitsInProse(describe),
            keyUnits: unitsInKey(name),
            valueUnitPair,
            durationShaped: isDurationShaped(name),
            instant,
            externalVocabulary,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function judge(site: DurationKey): Finding | undefined {
  if (site.valueUnitPair) return undefined;
  const where = `${site.file}:${site.line} \`${site.key}\``;

  // Exemption (i): the value IS the shared `EpochMs` schema, so the key is an
  // INSTANT and the duration rule does not reach it. The one thing still
  // refused is a describe that contradicts the schema: `EpochMs` declares
  // milliseconds, so prose naming another unit means the site and the schema
  // disagree, and a silent exemption there would let the declaration launder a
  // real unit bug.
  if (site.instant) {
    if (site.proseUnits.length > 0 && !site.proseUnits.includes('ms')) {
      return {
        site,
        rule: 'instant-unit-contradicts-schema',
        message: `${where} — typed \`${INSTANT_ROOT}\` (epoch MILLISECONDS) but the describe says `
          + `${site.proseUnits.join('/')}. One of them is lying; either the describe is wrong or this is `
          + `not an epoch-millisecond instant and must not be typed \`${INSTANT_ROOT}\`.`,
      };
    }
    return undefined;
  }

  if (site.proseUnits.length > 0) {
    if (site.keyUnits.length === 0) {
      // Exemption (ii): the key mirrors a name fixed outside this repo, declared
      // on the schema with `.meta({ externalVocabulary })`. It waives the RENAME
      // and nothing else — the describe must still state the unit, which is what
      // put this site in `proseUnits.length > 0` in the first place, and the
      // contradiction branch below is not reachable past a `return` here because
      // a marked key with a unit token in its NAME never takes this branch.
      if (site.externalVocabulary !== undefined) return undefined;
      return {
        site,
        rule: 'unit-in-prose-not-in-name',
        message: `${where} — describe names ${site.proseUnits.join('/')} but the key name carries no unit. `
          + `Rename it to carry the unit (e.g. \`${site.key}${suffixFor(site.proseUnits[0])}\`), with an ADR-0087 conversion if the key is published.`,
      };
    }
    if (!site.keyUnits.some((u) => site.proseUnits.includes(u))) {
      // Reached by MARKED keys too, deliberately: a marker waives the rename,
      // never a contradiction. A key spelled `maxAgeMs` whose describe says
      // seconds is the 1000x bug whatever standard its name mirrors.
      return {
        site,
        rule: 'name-unit-contradicts-prose',
        message: `${where} — the key name says ${site.keyUnits.join('/')} but the describe says ${site.proseUnits.join('/')}. One of them is lying; fix whichever is wrong.`
          + (site.externalVocabulary !== undefined
            ? ` The \`${EXTERNAL_VOCABULARY_META_KEY}\` marker waives the RENAME, never this.`
            : ''),
      };
    }
    return undefined;
  }
  return undefined;
}

function suffixFor(unit: string): string {
  return { ms: 'Ms', seconds: 'Seconds', minutes: 'Minutes', hours: 'Hours', days: 'Days' }[unit] ?? '';
}

// ── population ─────────────────────────────────────────────────────────────

function isSourceFile(rel: string): boolean {
  if (!rel.endsWith('.ts')) return false;
  if (rel.endsWith('.d.ts') || rel.endsWith('.test.ts') || rel.endsWith('.spec.ts')) return false;
  if (rel.includes('/__tests__/') || rel.startsWith('__tests__/')) return false;
  return true;
}

/**
 * Directory names the walk never descends into — see the population section of
 * this file's header for what each one costs when it is walked. Applied to the
 * WALK rather than to the roots, so an explicit `--root` at a package root
 * cannot route around it: that is the exact shape of the measured `node_modules`
 * reading (#15642), and a root-level filter would have let it back in.
 */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', '.cache',
]);

/**
 * The `src/` subtree of every workspace member that has one — the population,
 * enumerated live rather than listed. A member with no `src/` (the console
 * bundle, the docs app, the dogfood suite) contributes nothing and is not an
 * error: this gate reads declarations, and a package that declares none has
 * none to get wrong.
 */
export function sourceRoots(repoRoot: string = REPO_ROOT): string[] {
  const out: string[] = [];
  for (const dir of workspacePackageDirs(repoRoot)) {
    const src = join(repoRoot, dir, 'src');
    if (existsSync(src) && statSync(src).isDirectory()) out.push(src);
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

/**
 * How a file is NAMED in a finding and in `--list`: repo-relative, so an
 * offender in any package is a path a reader can open. A `--root` outside this
 * repo (the self-test's fixture tree) falls back to root-relative rather than
 * printing a `../../..` climb.
 */
function labelFor(root: string, file: string): string {
  const fromRepo = relative(REPO_ROOT, file).split('\\').join('/');
  if (fromRepo !== '' && !fromRepo.startsWith('../')) return fromRepo;
  return relative(root, file).split('\\').join('/');
}

/**
 * Scan the declared population, or one explicit tree when `root` is given
 * (ablation / demo). The exclusions apply to both — see {@link SKIP_DIRS}.
 */
export function scanTree(root?: string): { sites: DurationKey[]; findings: Finding[]; files: number } {
  const roots = root === undefined ? sourceRoots() : [root];
  const sites: DurationKey[] = [];
  let count = 0;
  for (const r of roots) {
    const files: string[] = [];
    walk(r, files);
    for (const f of files.sort()) {
      const label = labelFor(r, f);
      if (!isSourceFile(label)) continue;
      count++;
      sites.push(...collectDurationKeys(label, readFileSync(f, 'utf8')));
    }
  }
  const findings = sites.map(judge).filter((x): x is Finding => x !== undefined);
  return { sites, findings, files: count };
}

// ── self-test ──────────────────────────────────────────────────────────────

function selfTest(): number {
  let failures = 0;
  const expect = (label: string, ok: boolean) => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failures++;
  };
  const rulesOf = (code: string) => collectDurationKeys('fixture.ts', code).map(judge).map((f) => f?.rule);

  expect('offender: unit in describe, none in name → unit-in-prose-not-in-name',
    rulesOf(`const S = z.object({ ttl: z.number().int().min(0).default(3600).describe('Cache TTL in seconds') });`)
      .join() === 'unit-in-prose-not-in-name');
  expect('offender: short-form "ms" in describe, bare `timeout` → unit-in-prose-not-in-name',
    rulesOf(`const S = z.object({ timeout: z.number().optional().describe('Timeout in ms') });`)
      .join() === 'unit-in-prose-not-in-name');
  expect('offender: name says Ms, describe says seconds → name-unit-contradicts-prose',
    rulesOf(`const S = z.object({ ttlMs: z.number().describe('Cache TTL in seconds') });`)
      .join() === 'name-unit-contradicts-prose');
  expect('listed, not judged: duration-shaped name with no unit anywhere (the #14519 shape) is a census row',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ sessionTimeout: z.number().int().positive().default(3600).describe('Session timeout'), idleTimeout: z.number().optional() });`);
      return sites.length === 2 && sites.every((x) => x.durationShaped && judge(x) === undefined);
    })());
  expect('offender through `z.int()` and `z.coerce.number()` roots',
    rulesOf(`const S = z.object({ a: z.int().describe('Delay in seconds'), b: z.coerce.number().describe('Delay in hours') });`)
      .join() === 'unit-in-prose-not-in-name,unit-in-prose-not-in-name');
  expect('offender inside a `lazySchema(() => strictObject({...}, {...}))` wrapper',
    rulesOf(`export const S = lazySchema(() => strictObject({ surface: 's', history: 'h' }, { timeout: z.number().int().positive().optional().describe('Per-attempt time limit in milliseconds') }));`)
      .join() === 'unit-in-prose-not-in-name');
  expect('offender through a concatenated describe string',
    rulesOf(`const S = z.object({ timeout: z.number().describe('Timeout ' + 'in milliseconds') });`)
      .join() === 'unit-in-prose-not-in-name');

  expect('compliant: `ttlMs` / "milliseconds"',
    rulesOf(`const S = z.object({ ttlMs: z.number().int().min(0).default(60_000).describe('Cache TTL in milliseconds') });`)
      .join() === '');
  expect('compliant: snake_case `idle_timeout_seconds` / "seconds"',
    rulesOf(`const S = z.object({ idle_timeout_seconds: z.number().describe('Idle timeout in seconds') });`)
      .join() === '');
  expect('compliant: `retentionDays` / "days"; `timeoutHours` / "hours"; `intervalMinutes` / "minutes"',
    rulesOf(`const S = z.object({ retentionDays: z.number().describe('Keep for N days'), timeoutHours: z.number().describe('Escalate after N hours'), intervalMinutes: z.number().describe('Poll every N minutes') });`)
      .join() === ',,');
  expect('compliant: knex-inherited `idleTimeoutMillis` / "ms"',
    rulesOf(`const S = z.object({ idleTimeoutMillis: z.number().min(0).default(30000).describe('Time in ms before idle connection is closed') });`)
      .join() === '');
  expect('compliant: `{ value, unit }` pair — the sibling `unit` key exempts the numeric `value`',
    rulesOf(`const S = z.object({ value: z.number().min(0).describe('RPO value in seconds, minutes or hours'), unit: z.enum(['seconds', 'minutes', 'hours']) });`)
      .join() === '');
  expect('compliant: a describe naming a unit AND a matching key unit, other prose units present',
    rulesOf(`const S = z.object({ backoffMs: z.number().describe('Backoff in milliseconds (default 30 seconds)') });`)
      .join() === '');
  expect('skipped: calendar position, not a duration (`dayOfMonth`, `hour`)',
    rulesOf(`const S = z.object({ dayOfMonth: z.number().describe('Day of the month (1-31)'), hour: z.number().describe('Hour of the day (0-23)'), weekday: z.number().describe('Day of week, 0 = Sunday') });`)
      .join() === ',,');
  expect('skipped: a rate, not a duration ("requests per second")',
    rulesOf(`const S = z.object({ limit: z.number().describe('Max requests per second') });`)
      .join() === '');
  expect('skipped: non-numeric roots are outside the population (`z.string()`, imported schema)',
    rulesOf(`const S = z.object({ expireAfter: z.string().regex(RE).describe('Duration such as 14d or 36h'), timeout: PositiveInt.describe('Timeout in ms') });`)
      .join() === '');
  expect('skipped: a non-duration number whose describe names no unit',
    rulesOf(`const S = z.object({ maxRetries: z.number().int().describe('Retry attempts'), priority: z.number().describe('Order') });`)
      .join() === ',');
  expect('skipped: `min` in a key name is minimum, not minutes',
    rulesOf(`const S = z.object({ minAgeSeconds: z.number().describe('Minimum age in seconds') });`)
      .join() === '');
  expect('skipped: ordinal "second" and `min` as minimum are not units in prose',
    rulesOf(`const S = z.object({ referencesDeferred: z.number().describe('References deferred to second pass'), partSize: z.number().describe('Part size in bytes (min 5MB, max 5GB)'), maxLength: z.number().describe('Max length; the same transition-gate class as \`min\`') });`)
      .join() === ',,');
  expect('counted singular/short forms ARE units: "1 second", "15-minute", "5 min", "30 ms"',
    rulesOf(`const S = z.object({ a: z.number().describe('Wait 1 second'), b: z.number().describe('A 15-minute window'), c: z.number().describe('Poll every 5 min'), d: z.number().describe('Debounce of 30 ms') });`)
      .join() === 'unit-in-prose-not-in-name,unit-in-prose-not-in-name,unit-in-prose-not-in-name,unit-in-prose-not-in-name');

  // ── the two DECLARED exemptions (#15676, ruling B) ───────────────────────
  // Each class is pinned in both directions: the declaration exempts, and the
  // declaration does NOT exempt a contradiction. A marker that could never be
  // refused would be an allowlist wearing a `.meta()`.

  expect('exempt (i): a key whose value IS `EpochMs` is an instant, not a duration',
    rulesOf(`const S = z.object({ createdAt: EpochMs.describe('Unix timestamp in milliseconds when the scope was created') });`)
      .join() === '');
  expect('exempt (i): a BARE `EpochMs` key (no chain at all) is an instant',
    rulesOf(`const S = z.object({ createdAt: EpochMs });`)
      .join() === '');
  expect('exempt (i): `EpochMs.optional()` — the exemption survives the chain',
    rulesOf(`const S = z.object({ registeredAt: EpochMs.optional().describe('Unix timestamp in milliseconds when registered') });`)
      .join() === '');
  expect('REFUSED (i): an `EpochMs` key whose describe names a unit other than ms → instant-unit-contradicts-schema',
    rulesOf(`const S = z.object({ startedAt: EpochMs.describe('Boot timestamp in seconds') });`)
      .join() === 'instant-unit-contradicts-schema');
  expect('the instant exemption is `EpochMs` ALONE — another identifier root stays outside the population',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ startedAt: SomeOtherSchema.describe('Boot timestamp in seconds') });`);
      return sites.length === 0;
    })());
  expect('an `EpochMs` site is COUNTED in the census, not vanished from it',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ createdAt: EpochMs.describe('Unix timestamp in milliseconds') });`);
      return sites.length === 1 && sites[0].instant && sites[0].proseUnits.join() === 'ms';
    })());

  expect('exempt (ii): `.meta({ externalVocabulary })` waives the rename on a bare-named mirror',
    rulesOf(`const S = z.object({ maxAge: z.number().describe('Maximum cache age in seconds').meta({ externalVocabulary: 'HTTP Cache-Control max-age (RFC 9111)' }) });`)
      .join() === '');
  expect('exempt (ii): the marker rides in a `.meta()` that also carries description/title',
    rulesOf(`const S = z.object({ statementTimeout: z.number().int().positive().optional().describe('Abort statements running longer than this (ms)').meta({ title: 'Statement timeout (ms)', externalVocabulary: 'PostgreSQL statement_timeout' }) });`)
      .join() === '');
  expect('REFUSED (ii): a MARKED key whose name-unit contradicts its describe is still an offender',
    rulesOf(`const S = z.object({ maxAgeMs: z.number().describe('Maximum cache age in seconds').meta({ externalVocabulary: 'HTTP Cache-Control max-age (RFC 9111)' }) });`)
      .join() === 'name-unit-contradicts-prose');
  expect('REFUSED (ii): an EMPTY marker declares no standard and exempts nothing',
    rulesOf(`const S = z.object({ maxAge: z.number().describe('Maximum cache age in seconds').meta({ externalVocabulary: '' }) });`)
      .join() === 'unit-in-prose-not-in-name');
  expect('REFUSED (ii): a non-literal marker value is unverifiable and exempts nothing',
    rulesOf(`const S = z.object({ maxAge: z.number().describe('Maximum cache age in seconds').meta({ externalVocabulary: SOME_CONST }) });`)
      .join() === 'unit-in-prose-not-in-name');
  expect('REFUSED (ii): a marker is not a licence to drop the unit from the describe — an unmarked sibling still fails',
    rulesOf(`const S = z.object({ maxAge: z.number().describe('Maximum cache age in seconds').meta({ externalVocabulary: 'RFC 9111' }), ttl: z.number().describe('TTL in seconds') });`)
      .join() === ',unit-in-prose-not-in-name');
  expect('a marked site is COUNTED in the census with its standard, not vanished from it',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ maxAge: z.number().describe('Maximum cache age in seconds').meta({ externalVocabulary: 'RFC 9111' }) });`);
      return sites.length === 1 && sites[0].externalVocabulary === 'RFC 9111' && sites[0].proseUnits.join() === 'seconds';
    })());

  expect('a describe declared through `.meta({ description })` is READ — no exemption by blindness',
    rulesOf(`const S = z.object({ timeout: z.number().meta({ description: 'Timeout in milliseconds' }) });`)
      .join() === 'unit-in-prose-not-in-name');
  expect('an explicit `.describe()` wins over a `.meta({ description })` on the same key',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ ttl: z.number().describe('Cache TTL in seconds').meta({ description: 'Cache TTL in milliseconds' }) });`);
      return sites.length === 1 && sites[0].describe === 'Cache TTL in seconds' && judge(sites[0])?.rule === 'unit-in-prose-not-in-name';
    })());

  // The instant exemption names a schema by IDENTIFIER, because this file is a
  // syntactic scan with no module resolution. That is only honest while the
  // identifier really is exported from where it says — otherwise the exemption
  // would be silently empty and every instant would read as an offender (or,
  // after a rename in the other direction, an unrelated local could inherit the
  // exemption). Held from this side, the same coupling ROOT_DIR_WATCH_HINTS has.
  expect(`\`${INSTANT_ROOT}\` is exported from \`${INSTANT_ROOT_MODULE}\``,
    (() => {
      const src = readFileSync(join(pkgRoot, INSTANT_ROOT_MODULE), 'utf8');
      return new RegExp(`export const ${INSTANT_ROOT}\\b`).test(src);
    })());

  // ── the DECLARED population, held against the LIVE workspace (#15682) ────
  //
  // The literal is what `scripts/pm/dispatch-gates.mjs` reads; the workspace
  // file is what `sourceRoots()` actually enumerates. Held in BOTH directions
  // because each has its own silent failure — see ROOT_DIR_WATCH_HINTS' own
  // docblock. The declaration is NOT replaced by the live parse: a parse spells
  // no literal, and a gate that declares nothing is dispatched for nothing.
  const liveHints = readWorkspaceGlobs(REPO_ROOT)
    .filter((g) => !isExclusionGlob(g))
    .map((g) => `${g}/src/**`);
  for (const hint of liveHints) {
    expect(`pnpm-workspace.yaml's \`${hint.replace('/src/**', '')}\` is declared here as \`${hint}\``,
      ROOT_DIR_WATCH_HINTS.includes(hint));
  }
  for (const hint of ROOT_DIR_WATCH_HINTS) {
    expect(`declared \`${hint}\` is still a workspace root pnpm-workspace.yaml names`,
      liveHints.includes(hint));
  }

  // The population must REACH the tree, and reach PAST the one subtree this
  // gate used to walk alone. "Exactly one offender outside packages/spec" is
  // only news if the instrument fired outside packages/spec at all — the
  // reading the widening exists to produce, and the one a silently-empty
  // enumeration fakes perfectly (measured next door: a `packages/*/src`
  // pathspec that returned zero and zeroed its positive control with it).
  const roots = sourceRoots();
  const specSrc = join(pkgRoot, 'src');
  expect('the enumerated population contains `packages/spec/src`', roots.includes(specSrc));
  expect(`the enumerated population reaches ${roots.length - 1} src tree(s) OUTSIDE packages/spec`,
    roots.some((r) => r !== specSrc));
  expect('no enumerated root is itself inside `node_modules`',
    roots.every((r) => !r.split(sep).includes('node_modules')));

  // ── the walk's exclusions, pinned BEHAVIOURALLY (#15682) ─────────────────
  //
  // Measured on #15642 before they existed: `--root` at a package ROOT walked
  // that package's installed dependencies and reported "7151 offender(s) … in
  // 150098 source file(s)". A `SKIP_DIRS.has('node_modules')` assertion cannot
  // catch that coming back — the trap is that the WALK DESCENDS, so this builds
  // a tree containing every excluded shape, each carrying the same offender the
  // first case of this self-test uses, plus two real source files, and asserts
  // the walk finds TWO files. Ten copies of the offender on disk — eight of
  // them behind an exclusion — two in the verdict.
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'duration-unit-keys-'));
  try {
    const offender = "const S = z.object({ ttl: z.number().describe('Cache TTL in seconds') });\n";
    const excluded = [
      'node_modules/some-dep/index.ts',
      'node_modules/@scope/dep/nested/schema.ts',
      'dist/bundle.ts',
      'build/out.ts',
      'nested/__tests__/helper.ts',
      'unit.test.ts',
      'unit.spec.ts',
      'generated.d.ts',
    ];
    for (const rel of [...excluded, 'real.ts', 'nested/also-real.ts']) {
      const p = join(fixtureRoot, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, offender);
    }
    const walked = scanTree(fixtureRoot);
    expect(`the walk skips node_modules/, dist/, build/ and test files — 2 source file(s) of ${excluded.length + 2}, 2 offender(s)`,
      walked.files === 2 && walked.findings.length === 2);
    expect('an excluded file is not merely unjudged, it is never read',
      walked.sites.every((site) => !excluded.includes(site.file)));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nself-test: all cases pass' : `\nself-test: ${failures} case(s) FAILED`);
  return failures === 0 ? 0 : 1;
}

// ── main ───────────────────────────────────────────────────────────────────

function main(argv: string[]): number {
  if (argv.includes('--self-test')) return selfTest();
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : undefined;
  if (rootIdx >= 0 && !root) {
    console.error('--root needs a directory');
    return 2;
  }
  const { sites, findings, files } = scanTree(root ? resolve(root) : undefined);
  const durationSites = sites.filter((s) => s.proseUnits.length > 0 || s.durationShaped || s.keyUnits.length > 0);

  // The two DECLARED exemptions, counted rather than hidden. A key exempted by
  // a declaration stays in the census and stays countable — that is what makes
  // the exemption reviewable at a glance and keeps it from becoming the ledger
  // ruling B refused. Counted over the same `durationSites` population the
  // verdict line reports, so the three numbers add up on the page.
  const instants = durationSites.filter((s) => s.instant);
  const mirrors = durationSites.filter((s) => !s.instant && s.externalVocabulary !== undefined);
  const exemptions = `${instants.length} declared \`${INSTANT_ROOT}\` instant(s), `
    + `${mirrors.length} declared \`${EXTERNAL_VOCABULARY_META_KEY}\` mirror(s)`;

  if (argv.includes('--list')) {
    for (const s of durationSites) {
      const marks = [
        s.valueUnitPair ? ' [value/unit pair]' : '',
        s.instant ? ` [instant: ${INSTANT_ROOT}]` : '',
        s.externalVocabulary !== undefined ? ` [${EXTERNAL_VOCABULARY_META_KEY}: ${s.externalVocabulary}]` : '',
      ].join('');
      console.log(`${s.file}:${s.line}  ${s.key}  [name: ${s.keyUnits.join('/') || '-'}] [prose: ${s.proseUnits.join('/') || '-'}]${marks}  ${JSON.stringify(s.describe ?? null)}`);
    }
    console.log(`\n${durationSites.length} duration-shaped numeric key(s) across ${files} source file(s); ${sites.length} numeric keys in all; ${exemptions}.`);
  }

  if (findings.length === 0) {
    console.log(`✓ check:duration-unit-keys — ${durationSites.length} duration-shaped numeric key(s) across ${files} source file(s) all carry their unit in the key name (or in a sibling \`unit\`, or under a declared exemption: ${exemptions}); zero offenders, no baseline.`);
    return 0;
  }
  console.error(`✗ check:duration-unit-keys — ${findings.length} offender(s) among ${durationSites.length} duration-shaped numeric key(s) in ${files} source file(s) (${exemptions}):\n`);
  for (const f of findings) console.error(`  [${f.rule}] ${f.message}`);
  console.error(
    '\nThe unit of a duration-shaped number lives in the KEY NAME (`Ms` / `Seconds` / `Minutes` / `Hours` / `Days`)'
    + ' or in a unit-carrying VALUE (a duration literal, or a `{ value, unit }` pair) — never only in the describe prose,'
    + ' and never nowhere. There is no baseline: a published key is renamed under an ADR-0087 conversion (registry entry +'
    + ' a loud refusal of the old spelling naming the new key); see the header of this script.'
    + '\n\nTwo structural classes are exempt, and both are DECLARED ON THE SCHEMA — there is no list to add a key to:'
    + `\n  - an epoch INSTANT is typed \`${INSTANT_ROOT}\` (\`${INSTANT_ROOT_MODULE}\`) and named \`*At\`;`
    + `\n  - a key mirroring a name fixed outside this repo carries \`.meta({ ${EXTERNAL_VOCABULARY_META_KEY}: '<the standard>' })\`,`
    + ' which the reference page prints as "unit per <the standard>".'
    + '\nIf the offender above is neither, it is a rename.',
  );
  return 1;
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
