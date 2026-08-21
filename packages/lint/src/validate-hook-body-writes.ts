// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Author-time write-set check for L2 (`language:'js'`) hook bodies (#4271).
//
// An L2 body that writes a field the target object never declares —
// `ctx.input.amout = 0`, `ctx.api.object('deal').update({ stag: 'won' })` —
// runs clean in the QuickJS sandbox and reaches the driver UNFILTERED:
// `applyMutationsToInput` (runtime/src/sandbox/body-runner.ts) is a plain
// `Object.assign`, and `validateRecord` walks declared fields on insert and
// `continue`s past a key with no field def on update. What happens after that
// is DRIVER-DEPENDENT, and neither half is acceptable:
//
//   • SQL — the stray column enters the knex statement and the WHOLE write
//     fails with a driver-level error (`table deal has no column named
//     stagee`). The write is lost, and the error surfaces far from the
//     authoring mistake that caused it.
//   • Schemaless (memory, MongoDB) — the driver spreads the payload, so the
//     stray key IS persisted: an undeclared column nothing downstream reads.
//
// Either way the mistake is invisible where it is MADE — the #4001 family, if
// not literally its silent-no-op shape. Both runtime outcomes are pinned by
// `runtime/src/sandbox/undeclared-field-write-driver-split.integration.test.ts`
// so this rule's wording cannot drift from what the runtime does; the same
// split is documented in `content/docs/automation/hook-bodies.mdx`.
//
// The read side (`hook.condition`, ADR-0032) and the capability surface are
// statically checked; until this rule, the write side was the one blind face
// (the gap `hook-body.zod.ts` used to carry as "accepted").
//
// Scope — the literal write patterns in {@link HOOK_BODY_WRITE_PATTERNS}, and
// nothing else. The body is PARSED (TypeScript parser, never executed, never
// type-checked); each declared pattern is reconciliation-tested against the
// extractor, so a pattern cannot be declared-but-unverified (#3528's death).
// Everything statically unknowable is skipped SILENTLY, asymmetrically
// favouring missed findings over false ones — a false positive kills an
// advisory lint, a miss just leaves the gap open a little longer:
//
//   • computed keys (`ctx.input[k] = …`), spreads, non-literal payloads;
//   • dynamic object names (`ctx.api.object(name)`);
//   • `object:'*'` wildcard hooks' `ctx.input` writes (no single target);
//   • multi-target hooks where the field exists on SOME target — the body may
//     legitimately branch per object (`if (ctx.object === '…')`), so only a
//     field missing on EVERY named target is flagged;
//   • targets declared by another package (not in this stack);
//   • one-level aliasing (`const doc = ctx.input; doc.x = 1`) — known miss,
//     deliberately: v1 does no data-flow analysis.
//
// Severity: always `warning` (advisory, never gates). Same posture as
// `lintUnknownAuthoringKeys` (#3786) — ratchet only with field data.
//
// Wired via REFERENCE_INTEGRITY_RULES (it resolves field NAMES written in
// metadata against what the stack declares — the suite's exact membership
// test), so it runs on `os validate`, `os lint` and `os compile` at once.
// Deliberately NOT in the `defineStack` runtime path: the TypeScript parser
// has no place on kernel boot (see the lazy-load contract below).
//
// ACTION bodies run through the same `HookBodySchema` and the same sandbox, so
// they get the same treatment from a sibling rule — `validate-action-body-
// writes.ts`, which reuses this module's extractor, ledger, field index and
// implicit-field set. It carries only the pattern subset that survives the
// context change (an action's `ctx.input` is its params bag, not a record);
// the reasoning is declared as data there, not restated here.

import { createRequire } from 'node:module';
import type ts from 'typescript';
import { findClosestMatches, formatSuggestion } from '@objectstack/spec/shared';

import {
  createSourceFileChecked,
  describeParseFailure,
  PARSE_FAILURE_HINT,
  type SourceParseFailure,
} from './checked-parse.js';

import {
  SYSTEM_FIELDS,
  indexUnprovisionedAnchors,
  unprovisionedAnchorCause,
  unprovisionedAnchorHint,
} from './system-fields.js';

// The TypeScript compiler must NOT be imported at module top level: it is
// ~9 MB of CJS, and @objectstack/lint sits on the kernel boot path — while
// this gate only parses when a hook actually carries an L2 JS body. Same
// lazy-load contract as validate-react-page-props.ts (which see for the
// history, including production images pruning the package). Guarded by
// lazy-deps.test.ts.
//
// `node:module` is a Node builtin, untouched by esbuild/tsup, so the static
// `createRequire` import survives bundling; the `createRequire(...)` call is
// deferred because `import.meta.url` is rewritten to an empty stub in the CJS
// build (same pattern as driver-sqlite-wasm's knex-wasm-dialect).
let cachedTs: typeof ts | null = null;
function loadTypeScript(): typeof ts {
  if (cachedTs) return cachedTs;
  const anchor =
    typeof import.meta !== 'undefined' && import.meta.url
      ? import.meta.url
      : typeof __filename !== 'undefined'
        ? __filename
        : process.cwd() + '/';
  try {
    cachedTs = createRequire(anchor)('typescript') as typeof ts;
  } catch (err) {
    throw new Error(
      `@objectstack/lint: checking an L2 (language:'js') hook body requires the "typescript" package, which could not ` +
        `be loaded (${err instanceof Error ? err.message : String(err)}). It is a declared dependency of ` +
        `@objectstack/lint — if this deployment prunes packages, keep "typescript" in the image; it is only loaded ` +
        `when a hook with a JS body is validated.`,
    );
  }
  return cachedTs;
}

export type HookBodyWriteSeverity = 'warning';

export interface HookBodyWriteFinding {
  /** v1 is advisory-only by contract — the type says so. */
  severity: HookBodyWriteSeverity;
  rule: string;
  /** Human-readable location, e.g. `hook "normalize_lead" › body`. */
  where: string;
  /** Config path, e.g. `hooks[0].body.source`. */
  path: string;
  message: string;
  hint: string;
}

// Rule id (registry entry).
export const HOOK_BODY_WRITE_UNKNOWN_FIELD = 'hook-body-write-unknown-field';

/**
 * [#10653] The body did not parse, so its write set is whatever error recovery
 * left readable.
 *
 * Reported rather than skipped for the reason this rule exists at all: a
 * mistake must be visible where it is MADE. An unparseable body reached the
 * extractor, produced fewer matches, and came back as a hook with nothing to
 * report — the same silence the undeclared write itself has at run time, this
 * time wearing the checker's badge. `warning` because the whole rule is
 * advisory and never gates (the severity type admits nothing else).
 */
export const HOOK_BODY_SOURCE_UNPARSEABLE = 'hook-body-source-unparseable';

/**
 * [#8663] The write-axis twin of `flow-template-field-unprovisioned` (#8340):
 * the body writes a field {@link IMPLICIT_FIELDS} exempts, but on THIS target
 * the platform registered that anchor without provisioning storage for it.
 *
 * A separate id at `warning` severity rather than a reclassification of
 * {@link HOOK_BODY_WRITE_UNKNOWN_FIELD}, matching #8340's precedent exactly:
 * the existence verdict is unchanged (the name IS addressable), and what is
 * added is a second, independently suppressible finding on the path where the
 * existence check stays silent.
 */
export const HOOK_BODY_WRITE_UNPROVISIONED_ANCHOR = 'hook-body-write-unprovisioned-anchor';

// ─── The write-pattern ledger ───────────────────────────────────────────────
//
// Every syntactic write shape the extractor recognizes, declared as data. The
// reconciliation test (validate-hook-body-writes.test.ts) runs the extractor
// over each entry's example and asserts it yields EXACTLY the declared writes,
// each tagged with this entry's id — so "the docs say this pattern is covered
// but nothing extracts it" cannot happen (#3528), and the answer to "which
// writes does the lint see?" is this list, not the extractor's code.

/** One syntactic write shape the extractor recognizes. */
export interface HookBodyWritePattern {
  /** Stable pattern id, carried on every extracted write. */
  readonly id: string;
  /** Author-facing syntax summary (for docs/diagnostics, not matching). */
  readonly syntax: string;
  /** Reconciliation fixture: extracting `source` must yield exactly `writes`. */
  readonly example: {
    readonly source: string;
    readonly writes: ReadonlyArray<{ field: string; object?: string }>;
  };
}

export const HOOK_BODY_WRITE_PATTERNS: readonly HookBodyWritePattern[] = [
  {
    id: 'input-property-assign',
    syntax: "ctx.input.<field> = … | ctx.input['<field>'] ⟨op⟩= …",
    example: {
      // Compound (`+=`) and logical (`??=`) assignment operators write their
      // LHS exactly like `=` does — the example pins the whole operator range.
      source: "ctx.input.total = 0; ctx.input['status'] ??= 'open'; ctx.input.retries += 1;",
      writes: [{ field: 'total' }, { field: 'status' }, { field: 'retries' }],
    },
  },
  {
    id: 'input-object-assign',
    syntax: 'Object.assign(ctx.input, { <field>: … })',
    example: {
      source: "Object.assign(ctx.input, { total: 5, 'status': 'open', discount });",
      writes: [{ field: 'total' }, { field: 'status' }, { field: 'discount' }],
    },
  },
  {
    // ACTION-only shape (the hook sandbox context has no `ctx.record` at all).
    // Declared here because this ledger is the extractor's shape inventory, not
    // any one rule's; every consumer declares which shapes it consumes.
    id: 'record-property-assign',
    syntax: "ctx.record.<field> = … | ctx.record['<field>'] ⟨op⟩= …",
    example: {
      source: "ctx.record.stage = 'won'; ctx.record['amount'] += 1;",
      writes: [{ field: 'stage' }, { field: 'amount' }],
    },
  },
  {
    id: 'api-crud-literal',
    syntax:
      "ctx.api.object('<object>').insert({…}) | .create({…}) | .update({…}) | .updateById(id, {…})",
    example: {
      // Real ObjectRepository signatures: the record payload is argument 0 for
      // insert/create/update and argument 1 for updateById. (`update(data)` —
      // NOT `update(id, data)`; the id travels inside the payload/options.)
      source:
        "await ctx.api.object('audit_log').insert({ event: 'won' }); " +
        "await ctx.api.object('crm_deal').updateById(id, { stage: 'won' });",
      writes: [
        { field: 'event', object: 'audit_log' },
        { field: 'stage', object: 'crm_deal' },
      ],
    },
  },
];

/** A ledger pattern a given rule does NOT consume, and why. */
export interface BodyWritePatternExclusion {
  /** The {@link HOOK_BODY_WRITE_PATTERNS} entry id being excluded. */
  readonly id: string;
  /** Why the shape does not mean the same thing on this rule's surface. */
  readonly reason: string;
}

/**
 * The ledger shapes THIS rule consumes.
 *
 * Declared rather than implied: before the ledger carried a shape the hook
 * surface does not have, every write with no `object` was necessarily a
 * `ctx.input` write, and the rule could branch on that alone. It no longer can
 * — a `record-property-assign` write also carries no object, and would have
 * been reported as "the hook writes 'stage' to its input", which is false.
 * Each consumer declaring its own subset is what stops the next added shape
 * from silently landing in a branch that was never written for it.
 */
export const HOOK_BODY_WRITE_PATTERN_IDS: readonly string[] = [
  'input-property-assign',
  'input-object-assign',
  'api-crud-literal',
];

/** Ledger shapes this rule leaves alone, each with its reason. */
export const HOOK_BODY_WRITE_EXCLUSIONS: readonly BodyWritePatternExclusion[] = [
  {
    id: 'record-property-assign',
    reason:
      'a hook sandbox context has no `ctx.record` at all — `buildSandboxContext` never sets it (a hook’s ' +
      'record IS `ctx.input`), so the expression throws at run time rather than silently no-op’ing. A loud ' +
      'failure the author sees on the first run is not this advisory rule’s business',
  },
];

const HOOK_APPLICABLE_IDS: ReadonlySet<string> = new Set(HOOK_BODY_WRITE_PATTERN_IDS);

/**
 * `ctx.api.object(name)` write methods → index of the record-payload argument.
 * Mirrors `ObjectRepository` in packages/objectql (the surface hooks actually
 * receive): `upsert` exists only on the last-resort engine facade actions may
 * fall back to, never on the hook path, so it is deliberately absent.
 */
const API_WRITE_METHODS: ReadonlyMap<string, number> = new Map([
  ['insert', 0],
  ['create', 0],
  ['update', 0],
  ['updateById', 1],
]);

/**
 * Wrapper keys of the flat-input proxy (`installFlatInput` in
 * packages/objectql/src/hook-wrappers.ts). `ctx.input.data = …` replaces the
 * whole record payload and `id`/`options`/`ast` address the operation
 * envelope — none is a record-FIELD write, so none is ever flagged.
 */
const INPUT_ENVELOPE_KEYS: ReadonlySet<string> = new Set(['id', 'options', 'ast', 'data']);

/**
 * Columns always legitimately writable by automation without appearing in
 * `object.fields`: the package-shared registry-injected columns
 * (`system-fields.ts`, #4330) plus the UNION of its sibling rules' local
 * exemptions (`_id`/`name`/`space` from validate-translation-references,
 * `name`/`owner`/`record_type` from validate-flow-template-paths) — because
 * the cost asymmetry is the same everywhere: over-inclusion is at worst a
 * missed finding, under-inclusion is a false one.
 *
 * Exported for `validate-action-body-writes.ts` and
 * `validate-flow-node-writes.ts` (not re-exported from the package barrel). The
 * three rules are this same check on the three surfaces that write literal
 * field keys, so they must agree on what is implicitly writable — a second copy
 * of this extension would drift exactly the way the five hand-copied lists
 * #4330 collapsed did.
 *
 * ⛔ [#8663] This set is OBJECT-INDEPENDENT and therefore only half an answer.
 * It says a name COULD be implicitly writable somewhere; it cannot say whether
 * the platform actually provisioned storage for it on the object being written.
 * On an ADR-0015 `external` object the two diverge — the registered anchor has
 * no column behind it — so every consumer pairs this membership test with
 * {@link unprovisionedAnchorWriteConsequence}'s check rather than treating a
 * hit here as the end of the question. The pairing is why the union may stay
 * generous: over-inclusion here no longer buys silence on a federated object.
 */
export const IMPLICIT_FIELDS: ReadonlySet<string> = new Set([
  ...SYSTEM_FIELDS,
  '_id', 'name', 'space', 'owner', 'record_type',
]);

/**
 * [#8663] The CONSEQUENCE clause every unprovisioned-anchor WRITE diagnostic
 * states — one wording across the three write surfaces (hook body, action body,
 * flow node), paired with `unprovisionedAnchorCause` / `unprovisionedAnchorHint`
 * from `system-fields.ts` the way #8340's four read-axis rules pair with them.
 *
 * Shared rather than re-typed for #8340's reason: the sentence is the finding's
 * evidentiary content, and a rule that re-words it drifts from its siblings and
 * from the runtime it reports. It is shared HERE rather than in
 * `system-fields.ts` because the consequence is specific to the write axis —
 * that module's own note reserves the per-site consequence to the site, and the
 * "site" for this family is the family, not any one of its three files.
 *
 * ## Every clause below is measured, not inferred (#8663)
 *
 * The card that produced this rule asserted a structural resemblance to the
 * read-axis gap and explicitly declined to guess the runtime behaviour. Measured
 * end to end on a write-enabled (`external.allowWrites` + `external.writable`)
 * federated object bound to a real remote SQLite table:
 *
 *  - the engine's own write-path validator PASSES the anchor — it is in the
 *    registered schema, because `applySystemFields` injects it on a federated
 *    object exactly as on a local one;
 *  - a genuinely undeclared name in the same position is REFUSED upstream by
 *    that validator (`INVALID_FIELD`), on insert and on update alike, and never
 *    reaches a driver at all;
 *  - so the injected anchor is the ONLY payload key that reaches the remote
 *    database raw, where SQLite answers `SQLITE_ERROR: table … has no column
 *    named owner_id` — an untyped driver error (no ADR-0112 `code`/`status`)
 *    that aborts the WHOLE statement, taking the correctly named fields of the
 *    same payload with it. On a schemaless remote the key is persisted instead.
 *
 * That is the #4271 driver split, reached through the one door the platform's
 * own upstream refusal cannot close — which is why this is a finding and not a
 * duplicate of the unknown-field rule next to it.
 */
export function unprovisionedAnchorWriteConsequence(): string {
  return (
    `so the value can never land: the anchor exists only in the registered schema, which is what carries ` +
    `it PAST the write-path validator that refuses an undeclared name outright (INVALID_FIELD). The remote ` +
    `database is what rejects it — on a SQL remote with an untyped driver error ('no such column') that ` +
    `aborts the whole statement, so the correctly named fields in the same payload never land either; on a ` +
    `schemaless remote the key is persisted into a column no read surface returns (#4271).`
  );
}

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Coerce an array-or-name-keyed-map collection to an array (name injected). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter((x): x is AnyRec => isRec(x));
  if (isRec(v)) {
    return Object.entries(v).map(([name, def]) => ({
      name,
      ...(isRec(def) ? def : {}),
    }));
  }
  return [];
}

/**
 * object name → its declared field names (both `fields` authoring shapes).
 *
 * Exported for `validate-action-body-writes.ts` only (see
 * {@link IMPLICIT_FIELDS} for why the two rules share rather than copy).
 */
export function indexObjectFields(stack: AnyRec): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const obj of asArray(stack.objects)) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const names = new Set<string>();
    for (const f of asArray(obj.fields)) {
      if (typeof f.name === 'string' && f.name) names.add(f.name);
    }
    out.set(name, names);
  }
  return out;
}

/**
 * The declared field names of `objectName` — but ONLY when they are a sound
 * basis for judging "this name resolves to nothing". Otherwise `undefined`.
 *
 * Two different unknowns collapse to one answer on purpose, because every
 * caller in this family owes them the same silence:
 *
 *   • the object is not in this stack — another package declares it, and a
 *     field map we cannot see cannot be judged;
 *   • the object is here but declares NO fields at all — an external object or
 *     a datasource-introspected schema whose columns are resolved at runtime.
 *     Its field map is not empty, it is *unknown*, and an empty Set answers
 *     `has(anything) === false`, which reads as "no such field" for EVERY write
 *     to it. That is a false-positive generator, and a false positive kills an
 *     advisory lint (#4383).
 *
 * The distinction is unused today — no rule in the family wants to act on one
 * and not the other — so collapsing it here is what stops the guard from being
 * hand-copied per call site and forgotten at one of them, which is exactly how
 * it went missing from the hook and action rules while
 * `validate-searchable-fields` (skip #2) and `validate-flow-node-writes` both
 * had it. A future caller that genuinely needs to tell them apart should read
 * the index directly and say why.
 */
export function judgeableFieldsOf(
  index: ReadonlyMap<string, Set<string>>,
  objectName: string,
): Set<string> | undefined {
  const declared = index.get(objectName);
  if (!declared || declared.size === 0) return undefined;
  return declared;
}

/** One statically-extracted field write found in an L2 body. */
export interface ExtractedHookBodyWrite {
  /** Which {@link HOOK_BODY_WRITE_PATTERNS} entry matched. */
  patternId: string;
  /** Target object name; `undefined` = the hook's own target object(s). */
  object?: string;
  /** The `ctx.api` method for diagnostics (`insert`/`create`/`update`/`updateById`). */
  method?: string;
  field: string;
}

/** Everything one parse of an L2 body yields. */
export interface ExtractedHookBodyWriteSet {
  /** Every literal write the {@link HOOK_BODY_WRITE_PATTERNS} ledger declares. */
  writes: ExtractedHookBodyWrite[];
  /**
   * `ctx.record` is handed to something as a VALUE somewhere in the body — an
   * argument, an assignment RHS, a spread, a return — rather than only having
   * its properties read and written, or being truthiness/type tested.
   *
   * The action rule needs this to tell a dead snapshot write from a live one:
   * `ctx.record.stage = 'won'; await ctx.api.object('d').update(ctx.record)`
   * builds a payload and persists it, so the assignment is not a no-op. When
   * this is true, no record write in the body can be judged, and none is
   * reported. (One-level aliasing — `const r = ctx.record` — reads as an
   * escape too, which is the safe direction: it suppresses findings.)
   */
  ctxRecordEscapes: boolean;
  /**
   * [#10653] Set when the body did not parse, so `writes` is whatever error
   * recovery left readable rather than the body's actual write set.
   *
   * Absent means one of two things, and they are not the same: the body parsed,
   * or the cheap pre-filter above rejected it before any parse. The filter is a
   * raw-text scan for `ctx` / `Object`, and a body containing neither cannot
   * match any pattern however it parses — so a skipped parse claims nothing and
   * hides nothing.
   *
   * ## Whose fault an unparseable body is — asked, not assumed
   *
   * The body is parsed inside a synthesised wrapper (`async function __body(ctx)
   * { … }`) because that is the shape the runtime compiles it into
   * (`new AsyncFunction('ctx', source)`). So a parse failure here could in
   * principle be the WRAPPER's fault rather than the author's, and blaming the
   * author for the checker's own bug is the failure this whole change is about.
   * It cannot be: the wrapper is a constant, and `validate-hook-body-writes.
   * test.ts` pins that it parses clean around an empty body and around every
   * example in the pattern ledger. Any diagnostic therefore comes from the
   * body — and its position is reported in the BODY's own coordinates (the
   * wrapper's line is subtracted, and the result is clamped so it can never
   * point at a line the author did not write).
   */
  parseFailure?: SourceParseFailure;
}

/**
 * Extract every literal field write the pattern ledger declares from an L2
 * body's source. Parse-only (the source is never executed), error-tolerant
 * (a body with syntax errors simply yields fewer matches), and lazy: the
 * TypeScript compiler is not loaded when no pattern can possibly match.
 *
 * Thin projection of {@link extractHookBodyWriteSet} — use that one when the
 * `ctx.record` liveness signal matters, so the body is parsed once, not twice.
 */
export function extractHookBodyWrites(source: string): ExtractedHookBodyWrite[] {
  return extractHookBodyWriteSet(source).writes;
}

/** {@link extractHookBodyWrites} plus the `ctx.record` liveness signal, one parse. */
export function extractHookBodyWriteSet(source: string): ExtractedHookBodyWriteSet {
  // Every recognizable pattern begins at a `ctx` or `Object` identifier — a
  // body containing neither cannot match, and must not pay the compiler load.
  if (!/\bctx\b/.test(source) && !/\bObject\b/.test(source)) {
    return { writes: [], ctxRecordEscapes: false };
  }

  const tsc = loadTypeScript();
  // The runtime wraps a hook body as `new AsyncFunction('ctx', source)` — a
  // FUNCTION BODY, not a module. Parse it in the same context so bare
  // `return` / `await` mean what they mean at run time.
  //
  // [#10653] Checked: this call cannot throw, so an unparseable body used to
  // reach the walk below as a partially recovered tree and come back as "fewer
  // matches" — indistinguishable from a body that genuinely writes nothing. The
  // walk is unchanged; the verdict on the parse now rides out with the set.
  // The wrapper adds exactly one line ahead of the author's source, which
  // `synthesizedLinesBefore` takes back off the reported position.
  const { sourceFile: sf, failure: parseFailure } = createSourceFileChecked(
    tsc,
    'hook-body.ts',
    `async function __body(ctx) {\n${source}\n}`,
    {
      target: tsc.ScriptTarget.Latest,
      setParentNodes: false,
      scriptKind: tsc.ScriptKind.TS,
      synthesizedLinesBefore: 1,
    },
  );

  const writes: ExtractedHookBodyWrite[] = [];
  /** Every `ctx.record` reference, and the subset that is only an access base. */
  const recordRefs: ts.Node[] = [];
  const consumedRecordRefs = new Set<ts.Node>();

  /** `node` is exactly `ctx.<prop>`. */
  const isCtxDot = (node: ts.Node, prop: string): boolean =>
    tsc.isPropertyAccessExpression(node) &&
    tsc.isIdentifier(node.expression) &&
    node.expression.text === 'ctx' &&
    node.name.text === prop;

  /** The literal field name of an LHS rooted at `ctx.<prop>`, if any. */
  const fieldOfCtxLhs = (lhs: ts.Expression, prop: string): string | undefined => {
    if (tsc.isPropertyAccessExpression(lhs) && tsc.isIdentifier(lhs.name) && isCtxDot(lhs.expression, prop)) {
      return lhs.name.text;
    }
    if (tsc.isElementAccessExpression(lhs) && isCtxDot(lhs.expression, prop)) {
      const arg = lhs.argumentExpression;
      if (tsc.isStringLiteral(arg) || tsc.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
    }
    return undefined; // computed key / nested path — statically opaque
  };

  /** Literal keys of an object-literal expression (spreads/computed skipped). */
  const literalObjectKeys = (node: ts.Expression): string[] => {
    if (!tsc.isObjectLiteralExpression(node)) return [];
    const keys: string[] = [];
    for (const p of node.properties) {
      if (tsc.isPropertyAssignment(p)) {
        if (tsc.isIdentifier(p.name) || tsc.isStringLiteral(p.name)) keys.push(p.name.text);
      } else if (tsc.isShorthandPropertyAssignment(p)) {
        keys.push(p.name.text);
      }
      // spread / computed / method members are statically opaque — skipped
    }
    return keys;
  };

  const visit = (node: ts.Node): void => {
    // Pattern: input-property-assign. FirstAssignment..LastAssignment spans
    // `=` and every compound/logical assignment operator (`+=`, `??=`, …) —
    // each writes its LHS.
    if (
      tsc.isBinaryExpression(node) &&
      node.operatorToken.kind >= tsc.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= tsc.SyntaxKind.LastAssignment
    ) {
      const inputField = fieldOfCtxLhs(node.left, 'input');
      if (inputField !== undefined && !INPUT_ENVELOPE_KEYS.has(inputField)) {
        writes.push({ patternId: 'input-property-assign', field: inputField });
      }
      // Pattern: record-property-assign. No envelope-key filter — `ctx.record`
      // is a plain snapshot of the record, not the flat-input proxy, so it
      // carries no operation envelope to exclude.
      const recordField = fieldOfCtxLhs(node.left, 'record');
      if (recordField !== undefined) {
        writes.push({ patternId: 'record-property-assign', field: recordField });
      }
    }

    // `ctx.record` liveness, for the rule that judges whether a record write
    // can possibly matter. A reference is CONSUMED when the position it sits in
    // cannot hand the object to anything that might persist it; every other
    // position — an argument, an assignment RHS, a spread, a return — can.
    //
    //   1. the base of a property/element access: `ctx.record.id`,
    //      `ctx.record.x = 1`, `ctx.record['k']`;
    //   2. a truthiness or type test. `ctx.record && ctx.record.id` is the
    //      defensive idiom real action bodies are written with (the showcase's
    //      own `mark_done` opens with it), and reading a test as an escape
    //      would suppress the finding on most bodies that have one. A test
    //      reads the reference and yields a boolean — or, for `&&`/`||`/`??`,
    //      yields the LEFT operand only when it is falsy, which is null or
    //      undefined and persists nothing either way. Only the left operand is
    //      a test: `x || ctx.record` really does evaluate to the object.
    if (tsc.isPropertyAccessExpression(node) || tsc.isElementAccessExpression(node)) {
      if (isCtxDot(node.expression, 'record')) consumedRecordRefs.add(node.expression);
    }
    if (tsc.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        (op === tsc.SyntaxKind.AmpersandAmpersandToken ||
          op === tsc.SyntaxKind.BarBarToken ||
          op === tsc.SyntaxKind.QuestionQuestionToken) &&
        isCtxDot(node.left, 'record')
      ) {
        consumedRecordRefs.add(node.left);
      }
    }
    if (tsc.isPrefixUnaryExpression(node) && node.operator === tsc.SyntaxKind.ExclamationToken) {
      if (isCtxDot(node.operand, 'record')) consumedRecordRefs.add(node.operand);
    }
    if (tsc.isTypeOfExpression(node) && isCtxDot(node.expression, 'record')) {
      consumedRecordRefs.add(node.expression);
    }
    if (
      (tsc.isIfStatement(node) || tsc.isWhileStatement(node) || tsc.isDoStatement(node)) &&
      isCtxDot(node.expression, 'record')
    ) {
      consumedRecordRefs.add(node.expression);
    }
    if (tsc.isConditionalExpression(node) && isCtxDot(node.condition, 'record')) {
      consumedRecordRefs.add(node.condition);
    }
    if (isCtxDot(node, 'record')) recordRefs.push(node);

    if (tsc.isCallExpression(node)) {
      const callee = node.expression;

      // Pattern: input-object-assign.
      if (
        tsc.isPropertyAccessExpression(callee) &&
        tsc.isIdentifier(callee.expression) &&
        callee.expression.text === 'Object' &&
        callee.name.text === 'assign' &&
        node.arguments.length >= 2 &&
        isCtxDot(node.arguments[0], 'input')
      ) {
        // Later Object.assign sources overwrite earlier ones but never remove
        // a key, so every literal key is genuinely written regardless of the
        // non-literal arguments around it.
        for (const arg of node.arguments.slice(1)) {
          for (const field of literalObjectKeys(arg)) {
            if (!INPUT_ENVELOPE_KEYS.has(field)) {
              writes.push({ patternId: 'input-object-assign', field });
            }
          }
        }
      }

      // Pattern: api-crud-literal — ctx.api.object('<lit>').<method>(payload…).
      if (tsc.isPropertyAccessExpression(callee) && tsc.isIdentifier(callee.name)) {
        const payloadIndex = API_WRITE_METHODS.get(callee.name.text);
        const recv = callee.expression;
        if (
          payloadIndex !== undefined &&
          tsc.isCallExpression(recv) &&
          tsc.isPropertyAccessExpression(recv.expression) &&
          recv.expression.name.text === 'object' &&
          isCtxDot(recv.expression.expression, 'api') &&
          recv.arguments.length === 1
        ) {
          const objArg = recv.arguments[0];
          const objectName =
            tsc.isStringLiteral(objArg) || tsc.isNoSubstitutionTemplateLiteral(objArg)
              ? objArg.text
              : undefined; // dynamic object name — statically opaque
          const payload = node.arguments[payloadIndex];
          if (objectName && payload !== undefined) {
            for (const field of literalObjectKeys(payload)) {
              writes.push({
                patternId: 'api-crud-literal',
                object: objectName,
                method: callee.name.text,
                field,
              });
            }
          }
        }
      }
    }

    tsc.forEachChild(node, visit);
  };
  visit(sf);
  return {
    writes,
    ctxRecordEscapes: recordRefs.some((ref) => !consumedRecordRefs.has(ref)),
    ...(parseFailure ? { parseFailure } : {}),
  };
}

/**
 * Validate L2 hook-body writes against target-object field declarations.
 * Pure `(stack) => Finding[]` (ADR-0019); safe on pre- or post-parse stacks.
 */
export function validateHookBodyWrites(stack: AnyRec): HookBodyWriteFinding[] {
  const findings: HookBodyWriteFinding[] = [];
  const hooks = asArray(stack.hooks);
  if (hooks.length === 0) return findings;

  // Built lazily: a stack whose hooks are all L1/handler-based never pays it.
  let objectFields: Map<string, Set<string>> | null = null;
  // [#8663] `objectName -> its unprovisioned injected anchors`. Empty for every
  // ordinary stack (only an ADR-0015 `external` object contributes an entry), so
  // the lookup below doubles as the "nothing to say here" fast path.
  let anchors: ReadonlyMap<string, ReadonlySet<string>> | null = null;

  hooks.forEach((hook, hookIndex) => {
    const body = hook.body;
    if (!isRec(body) || body.language !== 'js') return;
    const source = body.source;
    if (typeof source !== 'string' || source.trim() === '') return;

    // [#10653] The SET, not the thin projection: the parse verdict rides with it,
    // and it must be read BEFORE the `writes.length === 0` return below — an
    // unparseable body is the one case where an empty write set means "not
    // read" rather than "nothing written".
    const extracted = extractHookBodyWriteSet(source);
    const hookName = typeof hook.name === 'string' && hook.name ? hook.name : `#${hookIndex}`;
    if (extracted.parseFailure) {
      findings.push({
        severity: 'warning',
        rule: HOOK_BODY_SOURCE_UNPARSEABLE,
        where: `hook "${hookName}" › body`,
        path: `hooks[${hookIndex}].body.source`,
        message:
          `L2 body did not parse (${describeParseFailure(extracted.parseFailure)}), so its write set was ` +
          `read from a partially recovered tree — an undeclared field write in the unread part is not reported.`,
        hint: PARSE_FAILURE_HINT,
      });
    }

    const writes = extracted.writes.filter((w) => HOOK_APPLICABLE_IDS.has(w.patternId));
    if (writes.length === 0) return;

    objectFields ??= indexObjectFields(stack);
    anchors ??= indexUnprovisionedAnchors(stack);

    // The hook's own target set, for `ctx.input` writes. A wildcard target has
    // no single object to check against; a target whose fields cannot be judged
    // ({@link judgeableFieldsOf} — cross-package, or declaring no fields at all)
    // gives nothing to resolve against — either way `ctx.input` writes are
    // skipped, not guessed.
    const targets = (Array.isArray(hook.object) ? hook.object : [hook.object]).filter(
      (o): o is string => typeof o === 'string' && o.trim() !== '',
    );
    const targetSets = targets.map((t) => judgeableFieldsOf(objectFields!, t));
    // ALL targets must be judgeable, not just one: the finding below fires only
    // when a field is missing from EVERY target, and an unjudgeable target is
    // one the field might well exist on. One opaque target therefore makes the
    // whole "missing everywhere" claim unsound, not merely narrower (#4383).
    const inputJudgeable =
      targets.length > 0 && !targets.includes('*') && targetSets.every((s) => s !== undefined);

    const where = `hook "${hookName}" › body`;
    const path = `hooks[${hookIndex}].body.source`;
    const reported = new Set<string>();

    for (const w of writes) {
      const dedupeKey = `${w.object ?? ''}\u0000${w.field}`;
      if (reported.has(dedupeKey)) continue;

      if (w.object === undefined) {
        // ctx.input write → the hook's own object(s). Flag only a field
        // missing on EVERY named target (a multi-target body may branch per
        // object, so a partial miss is not statically wrong).
        if (!inputJudgeable) continue;
        if (IMPLICIT_FIELDS.has(w.field)) {
          // [#8663] The membership test above answered "addressable somewhere",
          // not "provisioned HERE". Ask the second question before going silent.
          //
          // EVERY target must be unprovisioned, mirroring the everywhere-miss
          // rule this branch already applies to the existence finding: a
          // multi-target body may branch per object (`if (ctx.object === …)`),
          // so an anchor that is real on one target is a legitimate write there
          // and the claim "this can never land" would be false.
          if (!targets.every((t) => anchors!.get(t)?.has(w.field))) continue;
          reported.add(dedupeKey);
          const anchorObj = targets.length === 1 ? targets[0] : targets.join(', ');
          findings.push({
            severity: 'warning',
            rule: HOOK_BODY_WRITE_UNPROVISIONED_ANCHOR,
            where,
            path,
            message:
              `body writes '${w.field}' to its input, and ${unprovisionedAnchorCause(anchorObj, w.field)} — ` +
              unprovisionedAnchorWriteConsequence(),
            hint: unprovisionedAnchorHint(anchorObj, w.field),
          });
          continue;
        }
        if (targetSets.some((s) => s!.has(w.field))) continue;

        reported.add(dedupeKey);
        const objDesc =
          targets.length === 1
            ? `object '${targets[0]}'`
            : `none of its target objects (${targets.join(', ')})`;
        const declares = targets.length === 1 ? 'declares no such field' : 'declare that field';
        findings.push({
          severity: 'warning',
          rule: HOOK_BODY_WRITE_UNKNOWN_FIELD,
          where,
          path,
          message:
            `body writes '${w.field}' to its input, but ${objDesc} ${declares}. The sandboxed script runs ` +
            `clean and the value is copied back onto the record payload unfiltered — on a SQL driver the ` +
            `stray column then fails the WHOLE write with a driver-level error far from here; on a ` +
            `schemaless driver (memory, MongoDB) it is persisted as an undeclared key (#4271).`,
          hint: fixHint(w.field, unionCandidates(targetSets)),
        });
      } else {
        // ctx.api write → the named object.
        const known = judgeableFieldsOf(objectFields!, w.object);
        if (!known) continue; // cross-package, or no declared fields — cannot judge
        // An AUTHOR-declared column wins outright: on a federated object it maps
        // a remote column the author vouches for (#7859's direction), so it is
        // never an unprovisioned anchor and never either finding.
        if (known.has(w.field)) continue;
        if (IMPLICIT_FIELDS.has(w.field)) {
          if (!anchors!.get(w.object)?.has(w.field)) continue;
          reported.add(dedupeKey);
          findings.push({
            severity: 'warning',
            rule: HOOK_BODY_WRITE_UNPROVISIONED_ANCHOR,
            where,
            path,
            message:
              `body calls ctx.api.object('${w.object}').${w.method ?? 'update'}(…) writing '${w.field}', and ` +
              `${unprovisionedAnchorCause(w.object, w.field)} — ${unprovisionedAnchorWriteConsequence()}`,
            hint: unprovisionedAnchorHint(w.object, w.field),
          });
          continue;
        }

        reported.add(dedupeKey);
        findings.push({
          severity: 'warning',
          rule: HOOK_BODY_WRITE_UNKNOWN_FIELD,
          where,
          path,
          message:
            `body calls ctx.api.object('${w.object}').${w.method ?? 'update'}(…) writing '${w.field}', but ` +
            `object '${w.object}' declares no such field. The write-path validator skips the unknown key — ` +
            `on a SQL driver the whole call then fails with a driver-level error far from here; on a ` +
            `schemaless driver (memory, MongoDB) the stray key is persisted (#4271).`,
          hint: fixHint(w.field, [...known]),
        });
      }
    }
  });

  return findings;
}

/** Every field name declared across the (all-known) target sets, deduplicated. */
function unionCandidates(targetSets: ReadonlyArray<Set<string> | undefined>): string[] {
  const out = new Set<string>();
  for (const s of targetSets) for (const f of s ?? []) out.add(f);
  return [...out];
}

/** Did-you-mean (declared + system columns as candidates) plus the fix. */
function fixHint(field: string, declared: string[]): string {
  const suggestion = formatSuggestion(findClosestMatches(field, [...declared, ...IMPLICIT_FIELDS]));
  return (
    (suggestion ? `${suggestion} ` : '') +
    `Fix the field name, or declare '${field}' on the object. Only the literal write patterns in ` +
    `HOOK_BODY_WRITE_PATTERNS are checked — computed keys, spreads and aliased input are not — and this ` +
    `warning never blocks a build.`
  );
}
