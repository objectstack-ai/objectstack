// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0058 D7 — the Expression Surface Conformance ledger is a CHECKED artifact.
// Refactored onto the reusable ADR-0060 `checkLedger` helper: one call asserts
// the shared invariants AND the ratchet (re-discover every expression-declaring
// field in packages/spec/src — see EXPRESSION_INPUT_SCHEMAS — plus the RLS
// using/check predicates; fail if any is unclassified). Discovery is by SCHEMA
// NAME, so a slot that moves to a narrower schema leaves the scan unless that
// schema is registered: #7327 is the worked example. Discovery is also by
// POSITION since #15500 — the key is `file:Schema.field` and two positions
// sharing one key FAIL rather than merge. The expression-specific invariants
// (mode/dialect/fail-policy, compile rows name the canonical compiler) stay
// here.
//
// Discovery is by IDENTITY rather than by head position since #17630, and
// resolves file-local aliases. The scan used to require a roster name to start
// immediately after `field:`, which made two mechanisms invisible while the
// ratchet reported a complete classification: a roster schema used as a UNION
// MEMBER (`field: z.union([z.boolean(), ExpressionInputSchema])`, or the member
// on its own line inside a multi-line union) and a roster schema behind a
// file-local alias const (`const X = z.union([z.boolean(),
// ExpressionInputSchema]); … field: X`). The first is the worse of the two: the
// roster name is literally on the line, so a reader who greps sees it and
// assumes discovery did. Five declaring positions were blind at `a26a114d7`.
// `SCAN_CONTROLS` below is what keeps the widening from silently un-widening.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { checkLedger } from '@objectstack/verify';
import { EXPRESSION_SURFACE } from './expression-conformance.ledger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');
const SPEC_SRC = join(REPO_ROOT, 'packages/spec/src');

const MODES = new Set(['compile', 'interpret']);
const FAIL_POLICIES = new Set(['compile-error', 'fail-closed', 'fail-soft-log', 'throw', 'unevaluated']);

/**
 * Runtime evaluator/compiler SITES, as this ledger's own enforcement cells
 * name them. Used only as the negative half of the `unevaluated` pin below: a
 * row claiming nothing evaluates its slot must not, in the same breath, name
 * the thing that does.
 *
 * The vocabulary is drawn from the enforcement cells already in the ledger
 * rather than invented, and it is deliberately a DETECTOR, not an inventory —
 * a row may name an evaluator this list has never heard of (the objectui
 * renderers are named in prose, with no callable token to match), so a MISS
 * proves nothing on its own. That is why the pin's other half is a positive
 * requirement rather than this one alone.
 */
const NAMES_RUNTIME_EVALUATOR =
  /celEngine|cronEngine|ExpressionEngine\.evaluate|compileCelToFilter|celToFilter|matchesFilterCondition|evaluateVisibility|evaluateValidationRules|evalFieldPredicate|evalRowPredicate|useRowPredicate|resolveCascadingOptions|toBoundaryJobSchedule|croner/;

/**
 * The closed set of spellings that STATE the absence `unevaluated` claims.
 *
 * ⚠️ This does not make the claim true — no regex reads prose for honesty. What
 * it does is refuse the shape the four older members were borrowed in: a row
 * whose enforcement cell simply describes a site and leaves the reader to infer
 * what happens to a bad expression. An `unevaluated` row has to say, in the
 * cell itself, that this ledger looked and found no evaluator — which is the
 * sentence a reviewer can check and a future author can be held to.
 */
const DECLARES_NO_EVALUATOR = /NO EVALUATOR FOUND|PARSE ONLY|no runtime consumer/;
// `settings-visibility` is not one of the spec's `ExpressionDialect` members on
// purpose (#7327): it is a closed non-CEL grammar with its own evaluator, and
// the ledger's job is to say what a surface IS, not what its schema used to
// claim. See the `settings-visibility` row.
const DIALECTS = new Set(['cel', 'cron', 'template', 'js', 'settings-visibility']);

/**
 * Schemas that DECLARE an expression surface. `ExpressionInputSchema` is the
 * shared one; a slot whose accepted grammar is narrower gets its own schema and
 * must be listed here too, or the ratchet silently stops watching it.
 *
 * That is not hypothetical — it is how this scan behaves by construction, and
 * #7327 hit it: narrowing the settings `visible` slots off `ExpressionInputSchema`
 * dropped them out of discovery and turned their ledger entry stale. A new
 * narrowed alias belongs in this list on the same commit that introduces it.
 *
 * The two DIALECT-typed inputs were missing for as long as they have existed
 * (#15027). `CronExpressionInputSchema` and `TemplateExpressionInputSchema` are
 * siblings of `ExpressionInputSchema` — same envelope, a different default
 * dialect on the bare-string arm — so every slot typed with one of them was a
 * declared expression surface that this scan could NEVER match: the pattern
 * requires a listed name to start immediately after the colon, and neither was
 * listed. The ledger therefore reported a complete classification over a
 * population with zero `cron` and zero `template` rows in it, while the spec
 * declared 12 such positions. Structurally blind, not merely un-updated — which
 * is why the roster and the rows classifying them landed on one commit.
 *
 * `EvaluatedExpressionInputSchema` (#15807) is the EVALUATED sibling — the same
 * two arms, the string arm non-blank and the envelope arm requiring a non-blank
 * `source`. `FlowEdgeSchema.condition` moved onto it, and the very commit that
 * moved it listed it here: without this row the edge condition would have
 * dropped out of discovery and its `cel-interpret` cover gone STALE — measured,
 * on that commit's first CI run (#7327's shape, one more time).
 */
const EXPRESSION_INPUT_SCHEMAS = [
  'ExpressionInputSchema',
  'EvaluatedExpressionInputSchema',
  'SettingsVisibilityInputSchema',
  'CronExpressionInputSchema',
  'TemplateExpressionInputSchema',
];
/**
 * A roster (or alias) name as an IDENTIFIER, anywhere on the line — #17630.
 *
 * The lookarounds are the whole point: a bare-substring scan for
 * `ExpressionInputSchema` also fires inside `CronExpressionInputSchema` and
 * `EvaluatedExpressionInputSchema`, which would collapse three rosters into one
 * and attribute a cron slot to the CEL name. Identity keeps the Cron and
 * Template siblings distinct while still finding the name mid-line, which is
 * where mechanism A hides it.
 */
function identityOf(names: readonly string[]): RegExp {
  return new RegExp(String.raw`(?<![A-Za-z0-9_$])(?:${names.join('|')})(?![A-Za-z0-9_$])`);
}

/**
 * The pre-#17630 HEAD-ANCHORED pattern, kept as the `via: 'head'` label rather
 * than as the scan: it is what tells a reader (and `SCAN_CONTROLS`) which
 * positions the old regex could already see, so "the widening found nothing
 * new" is a visible fact instead of a green run.
 */
const DECLARES_EXPRESSION = new RegExp(
  String.raw`^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:${EXPRESSION_INPUT_SCHEMAS.join('|')})\b`,
);

/** A property key at the start of a line, with its indentation. */
const PROPERTY_KEY = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/;

/**
 * A `const` binding — the alias-registration shape of mechanism B. Matched at
 * ANY indentation: a factory-local `const cond = z.union([…])` inside
 * `lazySchema(() => { … })` hides a roster schema exactly as well as a
 * module-scope one, and both are file-local.
 */
const LOCAL_BINDING = /^\s*(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]*)?=/;

/**
 * Lines that carry a roster name but declare no slot. Structural categories,
 * not an allowlist of positions — a position-keyed exemption would rot, and
 * silently, which is the defect class this file exists to surface.
 *
 * Each one is a real occurrence in `packages/spec/src`: the import that brings
 * the roster name in, JSDoc and comment prose that names it (52 lines at
 * `a26a114d7`), the barrel re-export, and the `export type X = z.input<typeof
 * RosterSchema>` companion beside every roster member. The roster's OWN
 * definitions are excluded by `LOCAL_BINDING` instead, which registers no alias
 * for a name already on the roster.
 */
const NON_DECLARING_LINE: readonly RegExp[] = [
  /^\s*\/\//,                                          // line comment
  /^\s*\*/,                                            // JSDoc / block-comment continuation
  /^\s*\/\*/,                                          // block-comment opener
  /^\s*export\s+(?:\*|\{)/,                            // barrel re-export
  /^\s*(?:export\s+)?(?:type|interface)\s+[A-Za-z_]/,  // a TYPE declaration is never a slot
];

/**
 * One DECLARING POSITION of an expression surface in the spec.
 *
 * The ratchet's unit of accountability is the position, not the name: a
 * position is what an author writes and what a reader has to classify. The
 * `key` is only a NAME for it, and the ledger can be honest exactly as far as
 * that name is 1:1 with positions.
 */
interface Declaration {
  /** Ratchet key — `file:Schema.field`, relative to packages/spec/src. */
  key: string;
  /** Path relative to packages/spec/src. */
  file: string;
  /** Enclosing top-level declaration (see `TOP_LEVEL_DECL`). */
  schema: string;
  field: string;
  line: number;
  /**
   * WHICH mechanism found it (#17630) — the label `SCAN_CONTROLS` asserts on:
   * `head` a roster name immediately after `field:` (all the pre-#17630 scan
   * could see), `inline` a roster name elsewhere on the declaring line or on a
   * line nested under it (mechanism A), `alias` a file-local const that
   * resolves to a roster member (mechanism B), `manual` the two RLS rows below.
   */
  via: 'head' | 'inline' | 'alias' | 'manual';
}

/** What one file's scan produced — declarations plus the two honesty outputs. */
interface FileScan {
  declarations: Declaration[];
  /** File-local aliases registered, `file:line name` (mechanism B's table). */
  aliases: string[];
  /**
   * Roster hits that reached no `field:` and registered no alias — the scan
   * saying "I saw a roster name here and cannot tell you what it types". Pinned
   * empty below rather than dropped, because dropping is the defect: the
   * pre-#17630 scan's whole failure was discarding a hit it could not place.
   */
  unattributed: string[];
}

/**
 * The enclosing top-level declaration a position belongs to.
 *
 * Column 0 ONLY, deliberately: these files routinely wrap a schema as
 * `export const FieldSchema = lazySchema(() => { const base = strictObject({…`,
 * and the indented inner `const base` must never win over `FieldSchema`.
 */
const TOP_LEVEL_DECL = /^(?:export\s+)?(?:const|function|class)\s+([A-Za-z_][A-Za-z0-9_]*)/;

/**
 * Re-discover every expression-declaring POSITION in the spec — the SAME scan
 * the ledger encodes, but without the dedup that used to hide half of it.
 *
 * A ratchet key was `file:field` until #15500, so N declarations of one field
 * name in one file were ONE key and one ledger row classified all of them —
 * silently, because the collapse happened inside a `Set` before anything could
 * object. Measured at `61821e54cf5`: 44 declaring positions reduced to 34 keys,
 * and 10 keys carried two positions each. Two of those pairs were genuinely the
 * same surface twice (the cron ones), and the rest were not: one key covered
 * both the server-enforced `FieldSchema.requiredWhen` transition gate and the
 * `InlineGridColumnSchema.requiredWhen` cell whose own describe says nothing on
 * the write path reads it. The ledger could not represent the difference, and
 * the ratchet could not notice that it had never asked.
 *
 * The key is now `file:Schema.field`, which separates all 44 positions today.
 * ⚠️ That is a measurement, NOT a guarantee: two same-named fields in two
 * different inline `z.object({…})` blocks under ONE top-level const would
 * attribute to the same schema name and collide again. So the naming scheme is
 * not what makes this sound — the COLLISION ASSERTION below is. It holds for
 * any naming scheme, which is why it is the durable half of the repair and the
 * finer key is only what makes it pass today.
 *
 * A line number is deliberately not part of the key: it is not an identity, and
 * a key that moved whenever an unrelated edit shifted lines would rot every
 * ledger row on contact.
 *
 * ## Attribution (#17630)
 *
 * A hit on the `field:` line attributes to that key. A hit on a NESTED line —
 * the union member on its own line, `system/metrics.zod.ts` and
 * `system/tracing.zod.ts` both spell it that way — attributes to the nearest
 * preceding key at STRICTLY SMALLER indentation, bounded by the enclosing
 * top-level declaration. The indentation constraint is what makes it right
 * rather than nearly right, and that is measured, not assumed: dropping it and
 * walking back to the nearest key of ANY indentation lands on a SIBLING inside
 * the union's structured arm — `percentile:` instead of `successCriteria` in
 * `ServiceLevelIndicatorSchema` — which classifies a slot nobody declared AND
 * leaves the real one uncovered, both reported. ⚠️ STRICTLY smaller vs merely
 * not-deeper is NOT distinguishable on today's tree (measured: relaxing `<` to
 * `<=` changes no key, because every sibling key inside a structured arm is
 * DEEPER than the member line, not level with it). `<` is kept as the stricter
 * of the two on the rule rather than the reading: a key at the SAME indentation
 * as the hit is its sibling, never the slot it mounts.
 */
function scanFile(abs: string, file: string): FileScan {
  const out: FileScan = { declarations: [], aliases: [], unattributed: [] };
  const lines = readFileSync(abs, 'utf8').split('\n');
  /** File-local aliases of a roster member, in declaration order (mechanism B). */
  const aliases: string[] = [];
  let schema = '(top-level)';
  let schemaStart = 0;
  let inImportBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const decl = line.match(TOP_LEVEL_DECL);
    if (decl) { schema = decl[1]; schemaStart = i; }
    // An import block spans lines; its continuation lines carry a bare roster
    // name that looks exactly like the union member of mechanism A.
    if (inImportBlock || /^\s*import\b/.test(line)) {
      inImportBlock = !/\bfrom\b/.test(line);
      continue;
    }
    if (NON_DECLARING_LINE.some((re) => re.test(line))) continue;
    const isRoster = identityOf(EXPRESSION_INPUT_SCHEMAS).test(line);
    const isAlias = aliases.length > 0 && identityOf(aliases).test(line);
    if (!isRoster && !isAlias) continue;

    const binding = line.match(LOCAL_BINDING);
    if (binding) {
      // `const X = …RosterSchema…` registers X for the rest of the file. A name
      // already on the roster registers nothing: that is the roster's OWN
      // definition (`shared/expression.zod.ts`) or a rostered refinement of
      // another member (`system/settings-manifest.zod.ts`'s
      // `SettingsVisibilityInputSchema`) — already discovered, so re-registering
      // it as an alias of itself would add nothing and hide the distinction.
      const name = binding[1];
      if (!EXPRESSION_INPUT_SCHEMAS.includes(name) && !aliases.includes(name)) {
        aliases.push(name);
        out.aliases.push(`${file}:${i + 1} ${name}`);
      }
      continue;
    }

    const field = attributeToField(lines, i, schemaStart);
    if (field) {
      const via = DECLARES_EXPRESSION.test(line) ? 'head' : isAlias ? 'alias' : 'inline';
      out.declarations.push({ key: `${file}:${schema}.${field}`, file, schema, field, line: i + 1, via });
      continue;
    }
    // No `field:` above it inside this declaration ⇒ the hit is in a top-level
    // const's own INITIALIZER, which is the multi-line spelling of mechanism B
    // (`const X = z.union([⏎  ExpressionInputSchema,⏎]);`). Register the const.
    if (schema !== '(top-level)' && !EXPRESSION_INPUT_SCHEMAS.includes(schema) && !aliases.includes(schema)) {
      aliases.push(schema);
      out.aliases.push(`${file}:${i + 1} ${schema} (multi-line)`);
      continue;
    }
    out.unattributed.push(`${file}:${i + 1} ${line.trim()}`);
  }
  return out;
}

/**
 * The `field:` key a roster hit on line `i` mounts — see `scanFile`'s
 * attribution note. Comment lines are skipped on the walk back so a JSDoc block
 * between the key and the member cannot end the search early.
 */
function attributeToField(lines: string[], i: number, schemaStart: number): string | undefined {
  const sameLine = lines[i].match(PROPERTY_KEY);
  if (sameLine) return sameLine[2];
  const indent = (lines[i].match(/^\s*/)?.[0].length) ?? 0;
  for (let j = i - 1; j >= schemaStart; j--) {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(lines[j])) continue;
    const key = lines[j].match(PROPERTY_KEY);
    if (key && key[1].length < indent) return key[2];
  }
  return undefined;
}

/** Every `.zod.ts` under `packages/spec/src`, scanned as TEXT. */
function scanSpec(): FileScan {
  const all: FileScan = { declarations: [], aliases: [], unattributed: [] };
  const walk = (dir: string) => {
    // `withFileTypes` reads the entry type from the single readdir syscall — no
    // stat-then-read window (avoids a file-system TOCTOU race; CodeQL).
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith('.zod.ts')) {
        const one = scanFile(p, relative(SPEC_SRC, p));
        all.declarations.push(...one.declarations);
        all.aliases.push(...one.aliases);
        all.unattributed.push(...one.unattributed);
      }
    }
  };
  walk(SPEC_SRC);
  return all;
}

function discoverDeclarations(): Declaration[] {
  const found = scanSpec().declarations;
  // RLS using/check are expression predicates too (legacy z.string() fields, so
  // no roster schema types them and the scan above cannot see them). Spelled
  // schema-qualified like every other key so the ledger has ONE key vocabulary.
  for (const field of ['using', 'check']) {
    found.push({
      key: `security/rls.zod.ts:RowLevelSecurityPolicySchema.${field}`,
      file: 'security/rls.zod.ts',
      schema: 'RowLevelSecurityPolicySchema',
      field,
      line: 0,
      via: 'manual',
    });
  }
  return found;
}

function discoverSurfaces(): Set<string> {
  return new Set(discoverDeclarations().map((d) => d.key));
}

/**
 * The three mechanisms the scan must keep finding, with the minimum each was
 * measured at on the commit that widened discovery (#17630, `a26a114d7`).
 *
 * A floor, not an equality: a new position or a retirement moves these counts,
 * and the ratchet already fails on either (an unclassified position and a STALE
 * cover are both hard failures), so pinning equality here would only duplicate
 * that and rot.
 *
 * What the floor catches is the one re-narrowing the ratchet CANNOT see. Undo
 * the widening alone and the five positions leave `discovered` while their rows
 * stay in `covered` — STALE covers, red. But undo it TOGETHER with deleting
 * those rows, in this same pair of files, and both sides of the ratchet agree
 * again: green, over a population five positions smaller, with no diff left to
 * read. That is this card's own defect wearing a new face, and this floor is
 * what refuses it — by MECHANISM, naming which one went missing.
 */
const SCAN_CONTROLS: ReadonlyArray<{ via: Declaration['via']; min: number; mechanism: string }> = [
  { via: 'head', min: 37, mechanism: 'a roster name immediately after `field:` (the pre-#17630 scan)' },
  // [#18118] Lowered 3 → 1 in the commit that deleted the `cel-declared-unwired-observability`
  // ledger row. The two positions that went away are named rather than subtracted:
  // `system/metrics.zod.ts:ServiceLevelIndicatorSchema.successCriteria` and
  // `system/tracing.zod.ts:TraceSamplingConfigSchema.condition` — both mounted the roster
  // schema as a union member, and both of those CEL arms were RETIRED under ADR-0049
  // enforce-or-remove because nothing evaluated them. `ui/component.zod.ts` `RecordAlertProps.visible`
  // is the one survivor of mechanism A, which is why the floor is 1 and not 0: a floor of 0
  // would stop measuring the mechanism instead of measuring less of it.
  { via: 'inline', min: 1, mechanism: 'mechanism A — a roster name used as a UNION MEMBER, not at the head of the declaration' },
  { via: 'alias', min: 2, mechanism: 'mechanism B — a slot typed with a file-local alias const of a roster member' },
];

describe('ADR-0058 D7 — expression surface conformance ledger', () => {
  it('is a sound conformance ledger + ratchet (ADR-0060 checkLedger)', () => {
    const problems = checkLedger(EXPRESSION_SURFACE, {
      proofRoot: REPO_ROOT,
      discover: discoverSurfaces,
    });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every row has a valid expression mode / dialect / fail-policy', () => {
    for (const s of EXPRESSION_SURFACE) {
      expect(MODES.has(s.mode), `${s.id}: mode '${s.mode}'`).toBe(true);
      expect(DIALECTS.has(s.dialect), `${s.id}: dialect '${s.dialect}'`).toBe(true);
      expect(FAIL_POLICIES.has(s.failPolicy), `${s.id}: failPolicy '${s.failPolicy}'`).toBe(true);
    }
  });

  it('every COMPILE row is fail-closed and names the canonical compiler', () => {
    for (const s of EXPRESSION_SURFACE.filter((x) => x.mode === 'compile')) {
      expect(s.failPolicy, `${s.id}: a compile/security surface must fail closed`).toBe('fail-closed');
      expect(
        /compileCelToFilter|celToFilter|matchesFilterCondition/.test(s.enforcement),
        `${s.id}: enforcement does not name the canonical compiler`,
      ).toBe(true);
      expect(s.proof, `${s.id}: an enforced compile surface must carry a proof`).toBeTruthy();
    }
  });

  // The structural half of #17630. The ratchet measures whether the ledger
  // agrees with discovery; nothing in it measures whether discovery still
  // REACHES the mechanisms it was widened for. Those are different questions,
  // and the second one is how this file stayed green over five declaring
  // positions for as long as it did.
  it('discovery still reaches every mechanism it was widened for', () => {
    const declarations = discoverDeclarations();
    for (const { via, min, mechanism } of SCAN_CONTROLS) {
      const hits = declarations.filter((d) => d.via === via);
      expect(
        hits.length,
        `discovery found ${hits.length} position(s) via '${via}' (floor ${min}) — ${mechanism}. `
        + 'Discovery has lost a mechanism it is required to see. If a position was legitimately '
        + 'retired, lower the floor in SCAN_CONTROLS in the same commit that deletes its ledger row, '
        + 'and say which position went away; ⛔ do not lower it to make a re-narrowed scan pass.',
      ).toBeGreaterThanOrEqual(min);
    }
  });

  // A roster name the scan can see but cannot place is the pre-#17630 failure
  // in miniature: the old scan discarded every hit that was not head-anchored,
  // silently, and the ledger read complete. Anything the widened scan cannot
  // attribute is surfaced here instead of dropped.
  it('no roster identifier in the spec is seen and then dropped', () => {
    const { unattributed, aliases } = scanSpec();
    // Positive control for the alias table: with it empty, mechanism B resolves
    // nothing and the `alias` floor above would be the only thing objecting.
    expect(
      aliases.length,
      'the file-local alias table is EMPTY — mechanism B resolution is not running, so every '
      + 'assertion that depends on it is vacuous',
    ).toBeGreaterThan(0);
    expect(
      unattributed,
      `roster identifiers the scan could not attribute to a declaring position:\n${unattributed.join('\n')}\n`
      + 'Each is a line where a roster (or file-local alias) name appears and the scan found no `field:` '
      + 'to mount it on and no const to register it as an alias. Either it declares a slot the attribution '
      + 'rule cannot reach — widen the rule — or it is a new NON-DECLARING shape, in which case add the '
      + 'shape to NON_DECLARING_LINE. ⛔ Never leave it dropped: dropped is how the five positions of '
      + '#17630 stayed invisible while this ledger reported a complete classification.',
    ).toEqual([]);
  });

  // The structural half of #15500. Before this existed, two declarations of one
  // field name in one file collapsed inside a `Set` and the ratchet reported
  // the file green — the same defect class the ledger header claims to prevent
  // ("a NEW expression surface that nobody classified breaks the build"),
  // reached through GRANULARITY instead of roster membership. A gate that says
  // "these positions share a key and I cannot tell them apart" is honest; one
  // that quietly re-keys moves coverage with nobody reading the diff.
  it('every declaring POSITION has its own ratchet key — no silent collapse', () => {
    const declarations = discoverDeclarations();
    // Positive control. An aborted or mis-rooted scan returns nothing, which
    // would make the assertion below vacuously green — precisely the "reports
    // green because it never looked" failure this card is about.
    expect(
      declarations.length,
      'discovery returned NO declarations — the scan did not run, so the collision check below proves nothing',
    ).toBeGreaterThan(0);

    const byKey = new Map<string, Declaration[]>();
    for (const d of declarations) byKey.set(d.key, [...(byKey.get(d.key) ?? []), d]);

    const collisions = [...byKey.entries()]
      .filter(([, ds]) => ds.length > 1)
      .map(([key, ds]) =>
        `${key}: ${ds.length} declaring positions share ONE ratchet key, so a single ledger row `
        + 'classifies all of them and the ratchet cannot tell them apart — '
        + `${ds.map((d) => `${d.file}:${d.line}`).join(', ')}. `
        + 'Give the colliding declarations distinguishable keys, then classify each on its own row.');
    expect(collisions, collisions.join('\n')).toEqual([]);
  });

  // The pin that makes `unevaluated` worth minting. The card this member comes
  // from is about a vocabulary with no word for "nothing evaluates this slot",
  // which forced five rows to borrow a member claiming something stronger —
  // `compile-error` on four, and `fail-closed` on a security-flavoured row
  // whose own enforcement cell read `(no runtime consumer yet)`. A new word
  // that could be borrowed just as loosely would reproduce that defect one
  // member wider, so the word arrives with the assertions below.
  //
  // "Non-empty runtime enforcement" cannot be checked as `enforcement !== ''`:
  // `ExprSurface` makes the cell REQUIRED, so every row has a non-empty one,
  // the five honest `unevaluated` rows included. The checkable question is what
  // the cell SAYS — it must state the absence, and it must not name the runtime
  // site whose existence the row is denying.
  it('`unevaluated` states an absence, and cannot be borrowed the way the old members were', () => {
    // Positive control for the detector itself. An emptied or mistyped
    // NAMES_RUNTIME_EVALUATOR makes the negative assertion below vacuously
    // green — the "reports green because it never looked" failure the pin above
    // guards against with its own control. The COMPILE rows are exactly the
    // rows another pin in this file already requires to name the canonical
    // compiler, so they are rows this detector MUST fire on.
    const compileRows = EXPRESSION_SURFACE.filter((x) => x.mode === 'compile');
    expect(
      compileRows.length,
      'no COMPILE rows in the ledger — the runtime-evaluator detector has nothing to be controlled against, so the assertions below prove nothing',
    ).toBeGreaterThan(0);
    for (const s of compileRows) {
      expect(
        NAMES_RUNTIME_EVALUATOR.test(s.enforcement),
        `${s.id}: the runtime-evaluator detector does not fire on a row that is required to name the canonical compiler — the DETECTOR is broken, not the row`,
      ).toBe(true);
    }

    for (const s of EXPRESSION_SURFACE.filter((x) => x.failPolicy === 'unevaluated')) {
      // `enforced` means the platform enforces the surface; `unevaluated` means
      // nothing reads it. Restricting this pin to `experimental` rows would
      // leave `state: 'enforced'` as the escape hatch, so the contradiction is
      // refused directly instead.
      expect(
        s.state,
        `${s.id}: state 'enforced' and failPolicy 'unevaluated' contradict each other — nothing evaluates the slot, so nothing enforces it`,
      ).not.toBe('enforced');

      expect(
        DECLARES_NO_EVALUATOR.test(s.enforcement),
        `${s.id}: failPolicy 'unevaluated' but the enforcement cell never states the absence it claims. Say it in the cell — 'NO EVALUATOR FOUND', 'PARSE ONLY', or 'no runtime consumer' — so the claim is reviewable rather than inferred from silence`,
      ).toBe(true);

      expect(
        NAMES_RUNTIME_EVALUATOR.test(s.enforcement),
        `${s.id}: failPolicy 'unevaluated' says nothing evaluates this slot, but the enforcement cell names a runtime evaluator/compiler site. One of the two is wrong: if something evaluates it, classify it under the ADR-0058 D5 tier that describes what happens to a bad expression there`,
      ).toBe(false);
    }
  });
});
