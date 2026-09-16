#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-duration-unit-keys — a `z.number()` key that DECLARES a time unit
 * carries it in its NAME or in its TYPE, never only in its `.describe()` prose
 * (#14478, maintainer ruling 2026-09-02, recorded on the card as "ruled B").
 *
 *   tsx scripts/check-duration-unit-keys.ts               # gate: exit 1 on any offender
 *   tsx scripts/check-duration-unit-keys.ts --self-test   # prove the detector still detects
 *   tsx scripts/check-duration-unit-keys.ts --list        # every unit-declaring number key it sees
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
 * ## ADMISSION: a key is judged when it DECLARES a unit, never when it merely
 * ## LOOKS like a duration
 *
 * A numeric key enters the census when it declares a unit through one of two
 * channels — a closed duration/instant TYPE in its zod chain ({@link
 * DURATION_ROOTS}, {@link INSTANT_ROOT}), or a unit token in its key NAME
 * ({@link unitsInKey}) — plus the describe prose, which is admitted for one
 * reason only: the founding rule of this gate is that a unit named in the prose
 * and NOWHERE else is an offence, and a key the census never draws cannot be
 * refused for anything. Prose admits so that prose can be judged against the
 * name. It never satisfies the rule and it never exempts.
 *
 * ⛔ A key's NAME SHAPE is no longer an admission channel. Until this rule
 * landed, a 25-token list (`timeout`, `ttl`, `interval`, `window`, `backoff`,
 * `stale`, `age`, …) pulled a key into the census on the strength of its name
 * alone. The list is RETIRED: the token-set constant and the predicate that
 * read it are both deleted, and there is no name-shape reading left in this
 * file — a self-test case reads this source and asserts both identifiers are
 * absent, with a positive control, so the retirement cannot rot back in under
 * a new spelling. A bare `z.number()` called `timeout`
 * — no unit token, no duration type, no unit in its prose — declares nothing,
 * is not in the census, and is not judged.
 *
 * That is a cost, and it is accepted rather than hidden. The list was what made
 * "no unit ANYWHERE" (the #14519 shape) visible at all, and it was what admitted
 * the JSDoc-divergence class's whole population (see below). Two things bought
 * it: the list could not tell a window of TOKENS from a window of SECONDS —
 * judged by name alone on `ca46f8f12` (2026-09-04) it fired 44 times and most
 * were counts wearing a duration's vocabulary (`contextWindow`,
 * `slidingWindowSize`, `snapshotInterval` "every N events", `reflectionInterval`
 * "every N interactions", `backoffMultiplier`, `staleKeys`) — and a list of 25
 * words is a special case that drifts, maintained forever against a vocabulary
 * nobody agreed to. A key whose unit is genuinely missing is fixed by giving it
 * a `Duration*` type or a unit-carrying name, which is a declaration the next
 * reader can see, not by being recognised from a word list.
 *
 * ## The SECOND prose channel: a JSDoc that names a unit the describe does not
 *
 * A key's unit can be written in two places, and only one of them is governed.
 * `.describe()` / `.meta({ description })` is what `content/docs/references/**`
 * renders and what rides into the published dist; the JSDoc block above the key
 * is developer commentary that stops at the source file. Ruled 2026-09-07
 * (decision batch #65, on #15939): JSDoc is NOT "prose" in the sense of this
 * rule, so this gate does not read it as a unit channel — a key whose unit
 * lives only in a JSDoc has NOT satisfied the rule, and option 1 of that card
 * ("read the JSDoc too") was not adopted.
 *
 * What the ruling did adopt is the DIVERGENCE: when the JSDoc names a unit and
 * the describe names none (or there is no describe at all), the two channels
 * disagree about whether this number's unit is written down anywhere a reader
 * can reach — and the channel that is silent is the published one. That is
 * refused as `unit-in-jsdoc-not-in-describe`, and the remedy is to move the
 * unit into the describe, where the rule above then applies and puts it in the
 * key NAME.
 *
 * ⛔ SO THE JSDoc IS READ IN EXACTLY ONE DIRECTION: to refuse, never to
 * satisfy. The divergence branch tests for a unit PRESENT in the JSDoc; it
 * never tests for one absent from the describe, which is what would have made
 * it option 1.
 *
 * ⚠️ WHAT THE NAME-LIST RETIREMENT COST THIS CLASS, stated plainly because a
 * silent repeal is the worse outcome. The divergence branch used to be guarded
 * by the name-shape list, so its whole live population was keys like `timeout`,
 * `window` and `interval` — names that declare nothing. Those keys are no
 * longer admitted, so the branch can no longer reach them: a bare `timeout`
 * whose unit is written only in a JSDoc is now neither listed nor refused. What
 * survives is the half that rests on a declaration — a key whose NAME carries a
 * unit, whose describe names none, and whose JSDoc names a DIFFERENT unit. The
 * two channels still disagree and the disagreement is still refused; the shape
 * where nothing was declared in the first place went out with the list. The
 * route back for such a key is step ③'s conversion to a `Duration*` type, at
 * which point the schema declares the unit and the contradiction branch reaches
 * it again.
 *
 * Why the divergence is worth a refusal and the blindness was not: the card
 * that filed it measured the cost. #15678 recorded in its changeset that
 * `RuntimeConfig.resourceLimits.timeout` "names no unit anywhere in its prose"
 * — and the JSDoc two lines above it says milliseconds. The blindness did not
 * merely miss the key; it produced a confident, wrong, PINNED explanation of
 * why it was missed. A gate that cannot see a channel writes falsehoods about
 * it.
 *
 * ## The exemptions, DECLARED ON THE SCHEMA (#15676, ruling B)
 *
 * The rule governs every authored and every runtime-emitted duration MINUS four
 * structural classes, and the ruling is explicit about the mechanism: they are
 * "declared ON THE SCHEMA, never in a gate ledger". So none of them appears
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
 * 3. **Declared durations** — a key whose value IS one of the closed duration
 *    schemas ({@link DURATION_ROOTS}, `src/shared/duration.zod.ts`) states its
 *    unit in the TYPE, which the authoring site shows and the published JSON
 *    schema carries. The unit is written down where the reader reaches it, so
 *    the key-NAME requirement is waived — and nothing else is. This is the
 *    channel step ③ converts the unit-nowhere rows into.
 *
 * 4. **Dimensionless numbers** — a key that carries
 *    `.meta({ dimensionless: '<what it counts>' })` is a count, a multiplier or
 *    a ratio whose prose happens to name a time unit belonging to something
 *    else in the sentence. Same mechanism as class 2, same literal-only
 *    validation, same visibility.
 *
 * ⛔ No exemption is a pass on lying. A marked key still fails
 * `name-unit-contradicts-prose` (a marker waives the RENAME, never a
 * contradiction), an `EpochMs` key whose describe names a unit other than
 * milliseconds fails `instant-unit-contradicts-schema` — the schema says
 * milliseconds, so prose that says seconds is one of the two being wrong — and
 * a `DurationMs` key whose prose or name says seconds fails
 * `duration-unit-contradicts-schema` for the same reason. A declaration that
 * could never be refused is an allowlist wearing a `.meta()`.
 *
 * Every class stays VISIBLE in the census: `--list` marks them and the verdict
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
 * The closed duration vocabulary (`src/shared/duration.zod.ts`) — the TYPE half
 * of the admission rule, read exactly the way {@link INSTANT_ROOT} is: as the
 * identifier a property's value chain bottoms out at, never through module
 * resolution. A key declared `DurationMs` states its unit at the authoring site
 * and in the published JSON schema, so the unit is written down in a channel
 * the reference-page reader reaches — which is the whole thing the key-name
 * requirement exists to secure. The declaration therefore waives the RENAME,
 * and nothing else: a `DurationMs` key whose prose or whose name names another
 * unit is still refused, exactly as an `EpochMs` instant is.
 *
 * Held honest from the same side as the instant root: a self-test case reads
 * {@link DURATION_ROOT_MODULE} and asserts each identifier really is exported
 * there, so renaming a schema without renaming it here is RED rather than a
 * silently-empty admission channel.
 */
const DURATION_ROOTS: ReadonlyMap<string, string> = new Map([
  ['DurationMs', 'ms'],
  ['DurationSeconds', 'seconds'],
]);
/** Where the {@link DURATION_ROOTS} identifiers are declared — read by the self-test, not by the scan. */
const DURATION_ROOT_MODULE = 'src/shared/duration.zod.ts';

/**
 * The `.meta()` key that declares exemption class (ii). A key carrying it
 * mirrors a name fixed by an external standard, so the RENAME is waived — never
 * the contradiction check, and never the requirement that the describe still
 * state the unit.
 */
const EXTERNAL_VOCABULARY_META_KEY = 'externalVocabulary';

/**
 * The `.meta()` key that declares exemption class (iii): this number is
 * DIMENSIONLESS — a count, a multiplier, a ratio — even though something about
 * it reads like a duration. Its value names what the number counts, as a
 * non-empty string literal, under the same rule the mirror marker carries: an
 * unverifiable claim exempts nothing, so a computed value or an empty string
 * leaves the key judged.
 *
 * It sits beside {@link EXTERNAL_VOCABULARY_META_KEY} in this reader on
 * purpose. Both are declarations ON THE SCHEMA rather than rows in a gate
 * ledger, both stay visible and counted in the census, and neither is a pass on
 * lying: a dimensionless key whose NAME carries a unit token still fails
 * `name-unit-contradicts-prose`, because "this number counts events" and "this
 * number is a span of milliseconds" cannot both be true of one key.
 */
const DIMENSIONLESS_META_KEY = 'dimensionless';

export interface DurationKey {
  file: string;
  line: number;
  key: string;
  describe: string | undefined;
  /** units the describe prose names (canonical) */
  proseUnits: string[];
  /** the JSDoc block written immediately above the key, when there is one */
  jsdoc: string | undefined;
  /** units that JSDoc block names (canonical) — read ONLY to refuse a divergence, never to satisfy the rule */
  jsdocUnits: string[];
  /** units the key name carries (canonical) */
  keyUnits: string[];
  /** true when a sibling `unit` key sits on the same object literal */
  valueUnitPair: boolean;
  /** the closed-vocabulary duration schema the value chain is rooted at (`DurationMs`), when it is one */
  durationType: string | undefined;
  /** the unit that {@link durationType} declares (canonical), when there is one */
  typeUnits: string[];
  /** true when the value chain is rooted at the shared `EpochMs` schema — exemption (i) */
  instant: boolean;
  /** the standard named by `.meta({ externalVocabulary })`, when one is declared — exemption (ii) */
  externalVocabulary: string | undefined;
  /** what this number counts, named by `.meta({ dimensionless })`, when it is declared — exemption (iii) */
  dimensionless: string | undefined;
}

/**
 * ADMISSION — the one predicate that decides whether a numeric key is in the
 * census at all, and therefore whether any verdict can reach it.
 *
 * A key is admitted when it DECLARES a unit, through one of the two declaration
 * channels the ruling names: a closed duration/instant TYPE in its zod chain
 * ({@link DURATION_ROOTS} / {@link INSTANT_ROOT}), or a unit token in its key
 * NAME ({@link unitsInKey}). The describe prose is the third entry, and it is
 * here for one reason: the founding rule of this gate is that a unit named in
 * the prose and nowhere else is an offence, and a key the census never drew
 * cannot be refused for anything. Prose admits a key so the prose can be judged
 * against the name; it never SATISFIES the rule and it never exempts.
 *
 * ⛔ What is NOT here any more is the key's NAME SHAPE. A bare `z.number()`
 * called `timeout`, with no unit token, no duration type and no unit in its
 * prose, declares nothing and is not judged — the cost the ruling accepted when
 * it retired the 25-token name list. Those keys become genuine durations again
 * by being given a `Duration*` type or a unit-carrying name, not by being
 * recognised from a list of words.
 */
export function declaresUnit(site: DurationKey): boolean {
  return site.instant
    || site.durationType !== undefined
    || site.keyUnits.length > 0
    || site.proseUnits.length > 0;
}

export interface Finding {
  site: DurationKey;
  rule:
    | 'unit-in-prose-not-in-name'
    | 'name-unit-contradicts-prose'
    | 'instant-unit-contradicts-schema'
    | 'duration-unit-contradicts-schema'
    | 'unit-in-jsdoc-not-in-describe';
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
  dimensionless: string | undefined;
} {
  const describes: string[] = [];
  let metaDescription: string | undefined;
  let externalVocabulary: string | undefined;
  let dimensionless: string | undefined;
  let cur: ts.Expression = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (ts.isIdentifier(cur)) {
      // A bare schema constant, or the receiver a chain bottomed out at:
      // `createdAt: EpochMs` / `createdAt: EpochMs.optional()`.
      return { root: cur.text, describes, metaDescription, externalVocabulary, dimensionless };
    }
    if (!ts.isCallExpression(cur)) return { root: undefined, describes, metaDescription, externalVocabulary, dimensionless };
    if (!ts.isPropertyAccessExpression(cur.expression)) {
      // `someHelper(...)` — a call whose callee is not `a.b`; not a `z.` root
      return { root: undefined, describes, metaDescription, externalVocabulary, dimensionless };
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
          if (name === DIMENSIONLESS_META_KEY && value !== undefined && value.trim() !== ''
              && dimensionless === undefined) {
            dimensionless = value;
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
      return { root: ['z', ...parts].join('.'), describes, metaDescription, externalVocabulary, dimensionless };
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

/**
 * The JSDoc block written immediately above a property — the SECOND prose
 * channel, read only so a divergence can be refused (#15939, ruling 2026-09-07).
 *
 * Read through `ts.getJSDocCommentsAndTags`, not through a leading-comment scan,
 * because the two differ exactly where it matters. A `//` line comment above a
 * key is NOT a JSDoc block and must not be read as one, and — the hazard that
 * would make this reader silently over-fire — an enclosing declaration's JSDoc
 * must not be inherited by the first property of the object literal it
 * introduces. Both are measured: a schema whose own docblock says
 * "timeouts in milliseconds" contributes NOTHING to the bare `timeout` key
 * declared first inside it, and the self-test pins that direction.
 *
 * The whole block's SOURCE TEXT is taken (leading asterisks, tags and all)
 * rather than just the description: a unit named in an `@default 60 seconds`
 * tag is the same divergence as one named in the summary line, and
 * {@link unitsInProse}'s word-boundary matching is unbothered by the
 * comment punctuation carried along with it.
 */
function jsdocTextOf(node: ts.Node, sf: ts.SourceFile): string | undefined {
  const docs = ts.getJSDocCommentsAndTags(node).filter((d): d is ts.JSDoc => ts.isJSDoc(d));
  if (docs.length === 0) return undefined;
  return docs.map((d) => d.getText(sf)).join('\n');
}

/** Every numeric-chain property in one source text. */
export function collectDurationKeys(fileName: string, code: string): DurationKey[] {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, /* setParentNodes */ true, ts.ScriptKind.TS);
  const out: DurationKey[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : undefined;
      if (name) {
        const { root, describes, metaDescription, externalVocabulary, dimensionless } = chainInfo(node.initializer);
        const instant = root === INSTANT_ROOT;
        const durationType = root !== undefined && DURATION_ROOTS.has(root) ? root : undefined;
        if (root && (NUMERIC_ROOTS.has(root) || instant || durationType !== undefined)) {
          const siblings = node.parent.properties;
          const valueUnitPair = siblings.some(
            (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'unit',
          );
          // An explicit `.describe()` wins over a `.meta({ description })`: it is
          // what every site in this tree writes, and where a key carries both,
          // the describe is the one an author reads at the declaration.
          const describe = describes.length ? describes[describes.length - 1] : metaDescription;
          const jsdoc = jsdocTextOf(node, sf);
          out.push({
            file: fileName,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            key: name,
            describe,
            proseUnits: unitsInProse(describe),
            jsdoc,
            jsdocUnits: unitsInProse(jsdoc),
            keyUnits: unitsInKey(name),
            valueUnitPair,
            durationType,
            typeUnits: durationType === undefined ? [] : [DURATION_ROOTS.get(durationType) as string],
            instant,
            externalVocabulary,
            dimensionless,
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

  // Exemption (iv): the value IS one of the closed duration schemas, so the
  // unit is declared by the TYPE — at the authoring site and in the published
  // JSON schema alike. That waives the key-NAME requirement and nothing else.
  // Both contradiction directions stay refusable, because a declaration that
  // could never be refused is an allowlist wearing an import: `DurationMs`
  // states milliseconds, so a describe that says seconds, or a name spelled
  // `*Seconds`, means the site and the schema disagree and one of them is the
  // 1000x bug.
  if (site.durationType !== undefined) {
    const declared = site.typeUnits.join('/');
    // All three channels are read here, and every one of them is read ONLY to
    // refuse — the JSDoc included, which is batch #65's direction unchanged: it
    // can contradict the type, it can never declare one.
    const conflicting = [
      ...site.proseUnits.filter((u) => !site.typeUnits.includes(u)).map((u) => `the describe says ${u}`),
      ...site.keyUnits.filter((u) => !site.typeUnits.includes(u)).map((u) => `the key name says ${u}`),
      ...site.jsdocUnits.filter((u) => !site.typeUnits.includes(u)).map((u) => `the JSDoc says ${u}`),
    ];
    if (conflicting.length > 0) {
      return {
        site,
        rule: 'duration-unit-contradicts-schema',
        message: `${where} — typed \`${site.durationType}\` (${declared}) but ${conflicting.join(' and ')}. `
          + `One of them is lying; either fix the prose and the name, or this is not a ${declared} duration `
          + 'and must not carry that type.',
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
      // Exemption (iii): the schema declares this number DIMENSIONLESS — a
      // count, a multiplier, a ratio — so the time unit its prose names belongs
      // to something else in the sentence ("events in the last 5 minutes"), not
      // to the number. Like the mirror marker it waives the RENAME only: the
      // contradiction branch below is still reached by a marked key that DOES
      // carry a unit token in its name, because a dimensionless number spelled
      // `*Ms` is two declarations that cannot both be true.
      if (site.dimensionless !== undefined) return undefined;
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

  // The DIVERGENCE class (#15939, ruling 2026-09-07, decision batch #65),
  // re-seated on the admission rule now that the name-shape list is retired.
  //
  // Reached only when the describe named no unit at all — every branch above
  // returns for a key whose describe did, and for a key whose TYPE declares the
  // unit. So what is left here is a key admitted by its NAME alone, whose JSDoc
  // names a unit that name does not carry.
  //
  // ⛔ Two halves of the guard, and each one is load-bearing:
  //
  //   `keyUnits.length > 0` — the key must DECLARE something. The old guard was
  //   the retired name-shape flag, i.e. the key merely LOOKED like a duration, and that is
  //   the reading the ruling retired: a bare `timeout` whose unit lives only in
  //   a JSDoc is no longer admitted and is therefore no longer refused. That is
  //   a real narrowing of this class and it is recorded as such — see the
  //   header — not smuggled in as a guard that happens to be equivalent.
  //
  //   the unit must not already BE in the name — a JSDoc that says milliseconds
  //   over a key called `latencyMs` diverges from nothing: the published
  //   reference page prints that key name, so the reader who most needs the
  //   unit can see it. Refusing there would manufacture offenders out of
  //   agreement, and the two rows in this tree that sit in exactly that shape
  //   (`latencyMs`, `frequencyHours`) are the measured proof of it.
  //
  // The JSDoc is still NEVER read as a way to SATISFY the rule — that was
  // option 1 and it was not adopted. It is read in one direction only: to
  // refuse.
  if (site.keyUnits.length > 0 && site.jsdocUnits.length > 0
      && !site.jsdocUnits.some((u) => site.keyUnits.includes(u))) {
    return {
      site,
      rule: 'unit-in-jsdoc-not-in-describe',
      message: `${where} — the JSDoc above the key names ${site.jsdocUnits.join('/')}, the key name says `
        + `${site.keyUnits.join('/')} and the describe names no unit`
        + `${site.describe === undefined ? ' (there is no describe at all)' : ` (${JSON.stringify(site.describe)})`}. `
        + 'The JSDoc is developer commentary; the describe and the key name are what '
        + '`content/docs/references/**` publishes, so the only unit the reader can see is the one the JSDoc '
        + 'disagrees with. One of them is wrong — fix whichever it is, and state the unit in the describe.',
    };
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
  // ── the RETIREMENT of the name-shape list ────────────────────────────────
  //
  // #18115 option A, batch #134 item 1, sharpened by batch #139 item 3
  // (maintainer 2026-09-16): 「名字表退休」. The 25-token list is deleted and a
  // key that merely LOOKS like a duration declares nothing. These cases pin the
  // cost as well as the rule — a repeal nobody can see in the self-test is a
  // repeal that comes back as a surprise.
  expect('RETIRED: a name-shaped key with no unit anywhere declares nothing — NOT admitted, NOT judged',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ sessionTimeout: z.number().int().positive().default(3600).describe('Session timeout'), idleTimeout: z.number().optional() });`);
      return sites.length === 2 && sites.every((x) => !declaresUnit(x) && judge(x) === undefined);
    })());
  expect('RETIRED: every token the old list carried is now inert — none of them admits a bare number',
    (() => {
      const names = ['timeout', 'ttl', 'interval', 'delay', 'duration', 'maxAge', 'expireAfter', 'retention',
        'cooldown', 'debounce', 'throttle', 'window', 'grace', 'lifetime', 'expiry', 'expiration',
        'heartbeat', 'backoff', 'idle', 'stale', 'age', 'period', 'every', 'wait', 'timeouts'];
      const code = `const S = z.object({ ${names.map((n) => `${n}: z.number()`).join(', ')} });`;
      const sites = collectDurationKeys('fixture.ts', code);
      return sites.length === names.length && sites.every((x) => !declaresUnit(x) && judge(x) === undefined);
    })());
  expect(`RETIRED: this file no longer contains the token list or its reader (positive control: it still contains \`${'judge'}\`)`,
    (() => {
      // The identifiers are assembled rather than written, so this assertion
      // cannot match ITSELF and report a retirement that never happened. The
      // positive control is the point: a source read that finds nothing proves
      // nothing until the same read finds something it should.
      const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
      const gone = ['DURATION_SHAPED' + '_TOKENS', 'is' + 'DurationShaped', 'duration' + 'Shaped'];
      const control = 'export function ' + 'judge';
      return gone.every((ident) => !src.includes(ident)) && src.includes(control);
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

  // ── exemption (iii): DIMENSIONLESS, declared on the schema ───────────────
  //
  // Pinned in both directions, like every other declaration here: it waives the
  // rename, and it does NOT waive a contradiction. ⚠️ Measured on this tree at
  // the time it landed: ZERO keys carry it. The rows the census used to class
  // dimensionless left the census with the name list instead, so this channel
  // exists for the key whose PROSE names a time unit that belongs to something
  // else in the sentence — the only shape the gate still refuses and the marker
  // can save.
  expect('exempt (iii): `.meta({ dimensionless })` waives the rename on a count whose prose names a time unit',
    rulesOf(`const S = z.object({ recentFailures: z.number().describe('Failures seen in the last 5 minutes').meta({ dimensionless: 'failed attempts' }) });`)
      .join() === '');
  expect('REFUSED (iii): a dimensionless key whose NAME carries a unit token is two declarations that cannot both hold',
    rulesOf(`const S = z.object({ recentFailuresMs: z.number().describe('Failures seen in the last 5 minutes').meta({ dimensionless: 'failed attempts' }) });`)
      .join() === 'name-unit-contradicts-prose');
  expect('REFUSED (iii): an EMPTY dimensionless marker declares nothing and exempts nothing',
    rulesOf(`const S = z.object({ recentFailures: z.number().describe('Failures seen in the last 5 minutes').meta({ dimensionless: '' }) });`)
      .join() === 'unit-in-prose-not-in-name');
  expect('REFUSED (iii): a non-literal dimensionless marker is unverifiable and exempts nothing',
    rulesOf(`const S = z.object({ recentFailures: z.number().describe('Failures seen in the last 5 minutes').meta({ dimensionless: SOME_CONST }) });`)
      .join() === 'unit-in-prose-not-in-name');
  expect('a dimensionless site is COUNTED in the census with what it counts, not vanished from it',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ recentFailures: z.number().describe('Failures seen in the last 5 minutes').meta({ dimensionless: 'failed attempts' }) });`);
      return sites.length === 1 && sites[0].dimensionless === 'failed attempts' && declaresUnit(sites[0]);
    })());

  // ── the TYPE channel: the closed duration vocabulary (#18122, step ①) ────
  //
  // The half of the admission rule that did not exist before this change. It is
  // read exactly as the instant root is — as the identifier the value chain
  // bottoms out at — so the cases that keep the instant root honest are the
  // cases that keep this one honest.
  expect('admitted by TYPE: a `DurationMs` key needs no unit in its name',
    rulesOf(`const S = z.object({ gracePeriod: DurationMs.default(30000).describe('How long to wait before forcing the operation') });`)
      .join() === '');
  expect('admitted by TYPE: a BARE `DurationSeconds` key (no chain at all)',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ refreshInterval: DurationSeconds });`);
      return sites.length === 1 && sites[0].durationType === 'DurationSeconds'
        && sites[0].typeUnits.join() === 'seconds' && declaresUnit(sites[0]) && judge(sites[0]) === undefined;
    })());
  expect('REFUSED by TYPE: `DurationMs` whose describe says seconds → duration-unit-contradicts-schema',
    rulesOf(`const S = z.object({ gracePeriod: DurationMs.describe('How long to wait, in seconds') });`)
      .join() === 'duration-unit-contradicts-schema');
  expect('REFUSED by TYPE: `DurationSeconds` whose NAME says Ms → duration-unit-contradicts-schema',
    rulesOf(`const S = z.object({ refreshIntervalMs: DurationSeconds.optional() });`)
      .join() === 'duration-unit-contradicts-schema');
  expect('compliant by TYPE: name, describe and type all agree',
    rulesOf(`const S = z.object({ refreshIntervalSeconds: DurationSeconds.describe('Refresh every N seconds') });`)
      .join() === '');
  expect('the type channel is the CLOSED vocabulary alone — another identifier root stays outside the population',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ gracePeriod: PositiveInt.describe('How long to wait, in seconds') });`);
      return sites.length === 0;
    })());

  // ⚠️ THE #18427 SHAPE, the reason this predicate is a chain WALK and not a
  // read of the value's opening token. A predicate that judged only what a
  // value STARTS with lets a live key go silent by chaining one more method
  // onto it. Both of these keys are live and both must still be seen.
  expect('adversarial: `DurationMs.or(z.string())` still resolves to the duration root — the chain is walked, not peeked at',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ ttl: DurationMs.or(z.string()).describe('Grace period in seconds') });`);
      return sites.length === 1 && sites[0].durationType === 'DurationMs'
        && judge(sites[0])?.rule === 'duration-unit-contradicts-schema';
    })());
  expect('adversarial: a unit token in the name survives an `.or()` tail too',
    rulesOf(`const S = z.object({ ttlMs: z.number().or(z.string()).describe('Cache TTL in seconds') });`)
      .join() === 'name-unit-contradicts-prose');
  // The documented BOUNDARY on the other side of that walk, pinned so it is a
  // known edge rather than a surprise: a root wrapped in a COMBINATOR CALL
  // (`z.union([...])`) is not this chain shape and is outside the population —
  // for the duration roots exactly as it already was for the instant root.
  expect('boundary: `z.union([DurationMs, z.string()])` is a `z.union` root and stays outside the population',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({ ttl: z.union([DurationMs, z.string()]).describe('Grace period in seconds') });`);
      return sites.length === 0;
    })());

  // ── the DIVERGENCE class (#15939, ruling 2026-09-07, decision batch #65) ──
  //
  // The three POSITIVE CONTROLS are the three sites the card measured, reduced
  // to their shape. They are the reason this class exists, so they are pinned
  // here rather than described: if the reader ever stops seeing them, these
  // cases go red instead of the population quietly shrinking by three.
  //
  // ⛔ The direction is load-bearing. The JSDoc is read ONLY to refuse, never
  // to satisfy — option 1 (read JSDoc as a unit channel) was NOT adopted, and
  // the case below that keeps a JSDoc-plus-describe key failing
  // `unit-in-prose-not-in-name` is what stops this reader drifting into it.

  expect('REFUSED (divergence): JSDoc says seconds, the NAME says ms, describe names none → unit-in-jsdoc-not-in-describe',
    rulesOf(`const S = z.object({\n  /**\n   * Execution timeout in seconds\n   */\n  timeoutMs: z.number().int().min(0).optional().describe('Maximum execution time') });`)
      .join() === 'unit-in-jsdoc-not-in-describe');
  expect('REFUSED (divergence): JSDoc says ms, the NAME says seconds, and there is NO describe at all',
    rulesOf(`const S = z.object({\n  /**\n   * Export interval in milliseconds\n   */\n  intervalSeconds: z.number().int().positive().optional().default(60) });`)
      .join() === 'unit-in-jsdoc-not-in-describe');

  // ⚠️ THE COST OF THE RETIREMENT, pinned rather than quietly dropped. These
  // three shapes were this class's original positive controls (#15939) and
  // every one of them rested on the name-shape list: `timeout`, `window` and
  // `interval` declare nothing, so nothing admits them any more and nothing
  // refuses them. The route back is step ③'s conversion to a `Duration*` type,
  // pinned two cases below. ⛔ If a future change re-admits these, it is
  // re-opening a retired list — these cases go red first and say so.
  expect('COST of 退休: JSDoc names ms over a bare `timeout` — no longer admitted, no longer refused',
    rulesOf(`const S = z.object({\n  /**\n   * Execution timeout in milliseconds\n   */\n  timeout: z.number().int().min(0).optional().describe('Maximum execution time') });`)
      .join() === '');
  expect('COST of 退休: JSDoc names seconds over a bare `window` — no longer admitted, no longer refused',
    rulesOf(`const S = z.object({\n  /**\n   * Window size in seconds\n   */\n  window: z.number().int().positive().describe('Window size') });`)
      .join() === '');
  expect('COST of 退休: JSDoc names seconds over a bare `interval` with no describe — no longer refused',
    rulesOf(`const S = z.object({\n  /**\n   * Export interval in seconds\n   */\n  interval: z.number().int().positive().optional().default(60) });`)
      .join() === '');
  expect('the route back: the SAME key typed `DurationMs` is admitted again and its JSDoc contradiction is refused',
    rulesOf(`const S = z.object({\n  /**\n   * Export interval in seconds\n   */\n  interval: DurationMs.optional().default(60) });`)
      .join() === 'duration-unit-contradicts-schema');

  expect('compliant (negative control): the unit is in BOTH channels and in the name',
    rulesOf(`const S = z.object({\n  /**\n   * Cache TTL in milliseconds\n   */\n  ttlMs: z.number().int().default(60_000).describe('Cache TTL in milliseconds') });`)
      .join() === '');
  expect('compliant: JSDoc names a unit the describe ALSO names — no divergence, nothing to refuse',
    rulesOf(`const S = z.object({\n  /**\n   * Duration in milliseconds\n   */\n  durationMs: z.number().describe('Elapsed time in milliseconds') });`)
      .join() === '');

  // ⛔ The JSDoc never SATISFIES the rule. A key whose describe names the unit
  // and whose name does not is still a rename, JSDoc or no JSDoc — otherwise
  // this reader would have quietly implemented option 1 by the back door.
  expect('the JSDoc does NOT satisfy the rule: describe names the unit, name does not → still unit-in-prose-not-in-name',
    rulesOf(`const S = z.object({\n  /**\n   * Cache TTL in seconds\n   */\n  ttl: z.number().describe('Cache TTL in seconds') });`)
      .join() === 'unit-in-prose-not-in-name');

  // Unchanged by this class, and pinned again from the JSDoc side: no unit in
  // EITHER channel stays a census row (the #14519 shape). The divergence
  // branch tests for a unit IN the JSDoc, never for its absence in the describe.
  expect('a JSDoc that names no unit adds nothing: an undeclared key stays undeclared and unjudged',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({\n  /**\n   * Session timeout\n   */\n  sessionTimeout: z.number().int().positive().default(3600).describe('Session timeout') });`);
      return sites.length === 1 && !declaresUnit(sites[0]) && sites[0].jsdocUnits.length === 0 && judge(sites[0]) === undefined;
    })());

  // The two ways this reader could OVER-fire, both measured against the AST
  // rather than assumed. Either one would manufacture offenders out of prose
  // that is not attached to the key at all.
  expect('a `//` line comment above a key is NOT a JSDoc block and is not read as one',
    rulesOf(`const S = z.object({\n  // Execution timeout in milliseconds\n  timeout: z.number().describe('Maximum execution time') });`)
      .join() === '');
  expect('an ENCLOSING declaration\'s JSDoc is not inherited by the first property inside it',
    rulesOf(`/**\n * The whole schema, timeouts in milliseconds\n */\nexport const S = z.object({ timeout: z.number().describe('Maximum execution time') });`)
      .join() === '');

  // The idiom suppressions that keep `unitsInProse` honest apply to this
  // channel too — it is the SAME reader, deliberately, so a calendar position
  // or a rate cannot become an offender by being written in a JSDoc instead.
  expect('skipped in the JSDoc channel too: a calendar position is not a duration',
    rulesOf(`const S = z.object({\n  /**\n   * Hour of the day (0-23)\n   */\n  windowHour: z.number().describe('Start hour') });`)
      .join() === '');
  expect('skipped in the JSDoc channel too: a rate is not a duration',
    rulesOf(`const S = z.object({\n  /**\n   * Heartbeats per second\n   */\n  heartbeat: z.number().describe('Heartbeat rate') });`)
      .join() === '');

  expect('the divergence class needs a DECLARATION: an undeclared name with a unit in its JSDoc is not refused',
    rulesOf(`const S = z.object({\n  /**\n   * Sampled over 30 seconds\n   */\n  sampleCount: z.number().describe('Samples taken') });`)
      .join() === '');
  expect('exempt (i) survives the new class: an `EpochMs` instant with an ms JSDoc is not newly refused',
    rulesOf(`const S = z.object({\n  /**\n   * Creation timestamp in milliseconds\n   */\n  createdAt: EpochMs });`)
      .join() === '');
  expect('a mirror whose name carries no unit declares no unit to diverge FROM — the marker is not what saves it',
    rulesOf(`const S = z.object({\n  /**\n   * Maximum cache age in seconds\n   */\n  maxAge: z.number().meta({ externalVocabulary: 'HTTP Cache-Control max-age (RFC 9111)' }) });`)
      .join() === '');
  expect('REFUSED: a mirror whose NAME does carry a unit is still judged against its JSDoc',
    rulesOf(`const S = z.object({\n  /**\n   * Maximum cache age in seconds\n   */\n  maxAgeMs: z.number().meta({ externalVocabulary: 'HTTP Cache-Control max-age (RFC 9111)' }) });`)
      .join() === 'unit-in-jsdoc-not-in-describe');

  expect('a site carries its JSDoc units in the census reading, not just in the verdict',
    (() => {
      const sites = collectDurationKeys('fixture.ts', `const S = z.object({\n  /**\n   * Window size in seconds\n   */\n  windowMs: z.number().describe('Window size') });`);
      return sites.length === 1 && sites[0].jsdocUnits.join() === 'seconds' && sites[0].proseUnits.length === 0
        && sites[0].jsdoc !== undefined && sites[0].jsdoc.includes('Window size in seconds');
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
  // The same coupling for the TYPE channel, which now carries the same hazard:
  // an identifier this file names and the module no longer exports is an
  // admission channel that is silently empty, and every key step ③ converts
  // would drop straight back out of the census with nothing going red.
  for (const root of DURATION_ROOTS.keys()) {
    expect(`\`${root}\` is exported from \`${DURATION_ROOT_MODULE}\``,
      (() => {
        const src = readFileSync(join(pkgRoot, DURATION_ROOT_MODULE), 'utf8');
        return new RegExp(`export const ${root}\\b`).test(src);
      })());
  }
  expect('the declared duration units are units this reader actually knows',
    [...DURATION_ROOTS.values()].every((u) => Object.keys(UNIT_SPELLINGS).includes(u)));

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
  const durationSites = sites.filter(declaresUnit);

  // The two DECLARED exemptions, counted rather than hidden. A key exempted by
  // a declaration stays in the census and stays countable — that is what makes
  // the exemption reviewable at a glance and keeps it from becoming the ledger
  // ruling B refused. Counted over the same `durationSites` population the
  // verdict line reports, so the three numbers add up on the page.
  const instants = durationSites.filter((s) => s.instant);
  const declaredDurations = durationSites.filter((s) => s.durationType !== undefined);
  const mirrors = durationSites.filter((s) => !s.instant && s.externalVocabulary !== undefined);
  const dimensionless = durationSites.filter((s) => s.dimensionless !== undefined);
  const exemptions = `${declaredDurations.length} declared duration type(s) `
    + `(${[...DURATION_ROOTS.keys()].map((r) => `\`${r}\``).join('/')}), `
    + `${instants.length} declared \`${INSTANT_ROOT}\` instant(s), `
    + `${mirrors.length} declared \`${EXTERNAL_VOCABULARY_META_KEY}\` mirror(s), `
    + `${dimensionless.length} declared \`${DIMENSIONLESS_META_KEY}\` number(s)`;

  if (argv.includes('--list')) {
    for (const s of durationSites) {
      const marks = [
        s.jsdocUnits.length ? ` [jsdoc: ${s.jsdocUnits.join('/')}]` : '',
        s.valueUnitPair ? ' [value/unit pair]' : '',
        s.instant ? ` [instant: ${INSTANT_ROOT}]` : '',
        s.durationType !== undefined ? ` [type: ${s.durationType}]` : '',
        s.externalVocabulary !== undefined ? ` [${EXTERNAL_VOCABULARY_META_KEY}: ${s.externalVocabulary}]` : '',
        s.dimensionless !== undefined ? ` [${DIMENSIONLESS_META_KEY}: ${s.dimensionless}]` : '',
      ].join('');
      console.log(`${s.file}:${s.line}  ${s.key}  [name: ${s.keyUnits.join('/') || '-'}] [prose: ${s.proseUnits.join('/') || '-'}]${marks}  ${JSON.stringify(s.describe ?? null)}`);
    }
    console.log(`\n${durationSites.length} unit-declaring numeric key(s) across ${files} source file(s); ${sites.length} numeric keys in all; ${exemptions}.`);
  }

  if (findings.length === 0) {
    console.log(`✓ check:duration-unit-keys — ${durationSites.length} unit-declaring numeric key(s) across ${files} source file(s) all carry their unit in the key name (or in a sibling \`unit\`, or under a declared exemption: ${exemptions}); zero offenders, no baseline.`);
    return 0;
  }
  console.error(`✗ check:duration-unit-keys — ${findings.length} offender(s) among ${durationSites.length} unit-declaring numeric key(s) in ${files} source file(s) (${exemptions}):\n`);
  for (const f of findings) console.error(`  [${f.rule}] ${f.message}`);
  console.error(
    '\nThe unit of a duration lives in the KEY NAME (`Ms` / `Seconds` / `Minutes` / `Hours` / `Days`), in its TYPE'
    + ' or in a unit-carrying VALUE (a duration literal, or a `{ value, unit }` pair) — never only in the describe prose,'
    + ' and never nowhere. There is no baseline: a published key is renamed under an ADR-0087 conversion (registry entry +'
    + ' a loud refusal of the old spelling naming the new key); see the header of this script.'
    + '\n\nFour structural classes are exempt, and every one is DECLARED ON THE SCHEMA — there is no list to add a key to:'
    + `\n  - an epoch INSTANT is typed \`${INSTANT_ROOT}\` (\`${INSTANT_ROOT_MODULE}\`) and named \`*At\`;`
    + `\n  - a DURATION may state its unit through its type instead of its name — ${[...DURATION_ROOTS.keys()].map((r) => `\`${r}\``).join(' / ')}`
    + ` (\`${DURATION_ROOT_MODULE}\`), which waives the rename and nothing else;`
    + `\n  - a key mirroring a name fixed outside this repo carries \`.meta({ ${EXTERNAL_VOCABULARY_META_KEY}: '<the standard>' })\`,`
    + ' which the reference page prints as "unit per <the standard>";'
    + `\n  - a DIMENSIONLESS number — a count, a multiplier, a ratio — carries \`.meta({ ${DIMENSIONLESS_META_KEY}: '<what it counts>' })\`.`
    + '\nIf the offender above is none of them, it is a rename.',
  );
  return 1;
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
