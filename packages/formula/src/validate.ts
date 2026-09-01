/**
 * Shared expression validator (ADR-0032 §Decision 1/5).
 *
 * One validator, used by every author surface — `objectstack build`,
 * `registerFlow`/metadata registration, and the agent-callable
 * `validate_expression` tool — so a malformed expression is caught the same
 * way everywhere, with a message written for **self-correction** (Decision 1d):
 * it states what is wrong AND the correct form.
 *
 * Field roles map to dialects (Decision 2):
 *   - `predicate`  → bare CEL returning bool (`record.rating >= 4`)
 *   - `value`      → bare CEL of any type   (`daysFromNow(3)`)
 *   - `template`   → text with `{{ path }}` holes (`Hot lead: {{ record.name }}`)
 *
 * The #1 author error (human or LLM) is wrapping a field reference in single
 * `{…}` braces inside a CEL field — `{x}` parses as a CEL map literal and fails.
 * This validator detects that specific mistake and returns the exact fix.
 */

import {
  celEngine,
  firstUndeclaredReference,
  firstTypeMismatch,
  inferCelType,
  parseCelToAstWithReason,
  type FieldCelType,
} from './cel-engine';
import { templateEngine } from './template-engine';

export type FieldRole = 'predicate' | 'value' | 'template';

/**
 * Loose input accepted by the validator: a bare string, or any object exposing
 * `dialect`/`source` (the Expression envelope, or a not-yet-narrowed value from
 * a `config.condition` / `edge.condition` field). Kept structural so call sites
 * need not pre-narrow to the strict {@link Expression} dialect union.
 */
export type ExprInput = string | { dialect?: string; source?: string } | null | undefined;

/** Optional schema context for field-existence checks (Decision 1b, v1). */
export interface ExprSchemaHint {
  /** Object the expression is authored against (for error text). */
  objectName?: string;
  /** Known top-level field names, so `record.<field>` can be checked. */
  fields?: readonly string[];
  /**
   * #1928 tier 4 — field name → spec field type (`'text'`, `'currency'`,
   * `'boolean'`, `'date'`, …). Enables the advisory type-soundness check: a
   * text or boolean field used with an arithmetic/ordering operator against a
   * number faults at runtime and the expression silently evaluates to `null`,
   * so it is surfaced as a NON-blocking warning. Absent ⇒ the check is skipped.
   * Only consulted for `scope: 'record'` sites (where refs are `record.<field>`).
   */
  fieldTypes?: Readonly<Record<string, string>>;
  /**
   * Evaluation scope of the authoring site — determines whether a bare top-level
   * identifier is legal (#1928):
   *  - `'record'`    → the record is bound only as the `record` namespace, with
   *                    no field flattening (`Field.formula`, object validation
   *                    predicates). A bare `amount` resolves to nothing and the
   *                    expression silently evaluates to `null` / never fires, so
   *                    it MUST be written `record.amount`. We flag bare refs.
   *  - `'flattened'` → the record's own fields are spread to top-level alongside
   *                    flow variables (flow / automation conditions), so bare
   *                    `status` is correct and is NOT an error. Flow variables
   *                    are not schema-knowable, so a non-field bare identifier
   *                    can't be soundly told apart from a typo — but when one is
   *                    a near-miss of a known field we emit a non-blocking
   *                    did-you-mean *warning*. (Default.)
   */
  scope?: 'record' | 'flattened';
  /**
   * ADR-0068 D4 — the closed catalog of valid role names (built-in + declared).
   * When supplied, a role-membership predicate testing a role NOT in this set
   * (e.g. `'org_admni' in current_user.positions`) is flagged as an error. Closes
   * the AI-hallucination hole where a model invents a plausible-but-nonexistent
   * role that then silently never matches. Absent => role checks are skipped.
   */
  roleCatalog?: readonly string[];
}

export interface ExprValidationError {
  /** Self-correcting message: what is wrong + the correct form. */
  message: string;
  /** The offending source, echoed for location. */
  source: string;
}

export interface ExprValidationResult {
  ok: boolean;
  errors: ExprValidationError[];
  /**
   * Non-blocking advisories (#1928 tier 3): a likely-typo'd field reference in a
   * flattened flow condition. Never affects `ok` — callers surface these without
   * failing the build, since a bare identifier there may legitimately be a flow
   * variable.
   */
  warnings: ExprValidationError[];
}

/**
 * #1928 / #3306 — spec field type → the CEL type it is declared as for the
 * type-soundness check. Pinned to a concrete type ONLY where a specific misuse
 * always faults the runtime; numbers/currency/percent, selects (option values
 * may be numeric codes), lookups, media, JSON stay `dyn` because the runtime
 * rescues them. Any field type absent from this map is treated as `dyn`. Keeping
 * the map narrow is the source of the check's near-zero false-positive rate.
 */
const SPEC_TYPE_TO_CEL: Readonly<Record<string, FieldCelType>> = {
  // Free text — arithmetic / ordering against a number is (almost) always a bug.
  text: 'string', textarea: 'string', email: 'string', url: 'string',
  phone: 'string', markdown: 'string', html: 'string', richtext: 'string',
  // Booleans — arithmetic / ordering against a number ALWAYS faults at runtime.
  boolean: 'bool', toggle: 'bool',
  // Dates — ARITHMETIC against a number always nulls (`date − date + 1`, `date + n`,
  // #3306). Only arithmetic is flagged; ordering / equality / concatenation of a
  // date field are runtime-tolerated (see `firstTypeMismatch`).
  date: 'timestamp', datetime: 'timestamp',
};

/** Map an object's field-type hints onto the CEL types the soundness check uses. */
function toCelFieldTypes(fieldTypes: Readonly<Record<string, string>>): Record<string, FieldCelType> {
  const out: Record<string, FieldCelType> = {};
  for (const [name, specType] of Object.entries(fieldTypes)) {
    out[name] = SPEC_TYPE_TO_CEL[specType] ?? 'dyn';
  }
  return out;
}

/**
 * #1928 / #3306 — a type-soundness verdict for an expression, or `null` when
 * sound. Two categories, with different severities:
 *  - `date-arith` (**error**): arithmetic on a date field against a number
 *    (`date − date + 1`, `today() + 30`) — always nulls at runtime and never
 *    recovers, so it blocks the build.
 *  - `type-mismatch` (**warning**): a text/boolean field used with an
 *    arithmetic/ordering operator against a number — nulls unless the text value
 *    happens to be numeric, so it stays advisory.
 * `scope` selects `record.<field>` vs bare field binding, shaping the message.
 */
function typeSoundnessIssue(
  source: string,
  fieldTypes: Readonly<Record<string, string>>,
  scope: 'record' | 'flattened',
): { issue: ExprValidationError; severity: 'error' | 'warning' } | null {
  const mismatch = firstTypeMismatch(source, toCelFieldTypes(fieldTypes), scope);
  if (!mismatch) return null;
  const ref = mismatch.field
    ? (scope === 'record' ? `\`record.${mismatch.field}\`` : `\`${mismatch.field}\``)
    : null;
  if (mismatch.category === 'date-arith') {
    const subject = ref ? `${ref} is a date` : 'a date field';
    return {
      severity: 'error',
      issue: {
        source,
        message:
          `date arithmetic \`${mismatch.operands}\` — ${subject}, and CEL can't do arithmetic on ` +
          `dates: this faults at runtime, so the field silently evaluates to null. Use ` +
          `\`daysBetween(a, b)\` for the span in whole days, and \`daysFromNow(n)\` / ` +
          `\`addDays(d, n)\` / \`addMonths(d, n)\` to shift a date.`,
      },
    };
  }
  const held = mismatch.celType === 'bool' ? 'a boolean' : 'text';
  const subject = ref ? `${ref} holds ${held}` : `${held === 'a boolean' ? 'a boolean' : 'a text'} field`;
  return {
    severity: 'warning',
    issue: {
      source,
      message:
        `type mismatch \`${mismatch.operands}\` — ${subject} but is used with \`${mismatch.operator}\` ` +
        `against a number. This faults at runtime, so the expression silently evaluates to null ` +
        `(unless the value happens to be numeric). Use a number field, or drop the arithmetic/comparison.`,
    },
  };
}

/** A bare `{x}` that is NOT part of a `{{x}}` mustache hole. */
const SINGLE_BRACE_RE = /(?:^|[^{])\{\s*([A-Za-z_$][\w.$]*)\s*\}(?!\})/;
/** `record.<field>` / `previous.<field>` head references for field-existence. */
const RECORD_REF_RE = /\b(?:record|previous)\.([A-Za-z_$][\w$]*)/g;

/** The dialect a field role expects (Decision 2). */
export function expectedDialect(role: FieldRole): 'cel' | 'template' {
  return role === 'template' ? 'template' : 'cel';
}

function toSource(input: ExprInput): { dialect?: string; source: string } {
  if (input == null) return { source: '' };
  if (typeof input === 'string') return { source: input };
  return { dialect: input.dialect, source: input.source ?? '' };
}

function bracesHint(source: string): string | null {
  const m = SINGLE_BRACE_RE.exec(source);
  if (!m) return null;
  const ref = m[1];
  return (
    `it looks like a \`{${ref}}\` template brace was used inside a CEL expression — ` +
    `\`{…}\` parses as a CEL map literal and fails. Write the bare reference instead, e.g. \`${ref}\`.`
  );
}

/**
 * The prescription for a **bounds** refusal — an expression that is perfectly
 * good CEL and merely too big for the platform's parse budget (#7073).
 *
 * Until #7073 every `celEngine.compile` refusal got the same dialect trailer
 * ("`predicate`s are bare CEL (e.g. `record.rating >= 4`)"), byte for byte,
 * including this class. That sentence is actively wrong here: the source is
 * already bare CEL, so an author who obeys the last sentence they were given —
 * an LLM author above all — rewrites the dialect, learns nothing, and comes
 * back with the same 80-clause conjunction. The front half of the message
 * (cel-js's own `Exceeded maxAstNodes (256)`) was right all along; only the
 * prescription lied.
 *
 * The class comes from `celEngine.compile`'s own `kind: 'bounds'`; WHICH bound
 * and its value come from {@link parseCelToAstWithReason}, the same
 * reason-carrying entrance `@objectstack/lint`'s RLS gate reads (#6778 /
 * PR #6831 — the consumer-side instance of this same defect family). Called
 * WITHOUT `admitOverLimit`, so it takes neither the unbounded parse nor the
 * overrun measurement: this path needs only the bound's NAME, and a refusal
 * must not pay to re-parse a source it has just judged too large.
 *
 * ### Why the remedies are generic
 *
 * `validateExpression` is ADR-0032's shared validator: one message serves all
 * ~10 expression slots (flow/automation conditions, `Field.formula`, validation
 * rules, `visibleWhen`, `sharingRules[].condition`, the `validate_expression`
 * tool …). Their COMBINATION semantics differ, so PR #6831's RLS-specific
 * sentence ("splitting the top-level `&&` widens the grant") is not portable —
 * it is true for a security predicate and false, or merely meaningless, for a
 * formula value. Shrinking and denormalising are safe everywhere; splitting is
 * offered only with the caveat that the site decides what splitting means.
 */
function boundsHint(source: string): string | null {
  const parsed = parseCelToAstWithReason(source);
  // `celEngine.compile` said `bounds`, and both verdicts are graded by the same
  // `classifyCelFault`, so this holds — but a narrowing that ever stopped
  // holding must degrade to the old trailer, never to a wrong bound name.
  if (parsed.ok || parsed.kind !== 'bounds') return null;
  const { limit, limitValue } = parsed.overrun;
  const bound =
    limit && limitValue != null
      ? `the \`${limit}\` budget (limit ${limitValue})`
      : "one of the platform's parse budgets";
  return (
    `this is valid CEL that exceeds ${bound} — a SIZE fault, not a dialect mistake, so ` +
    `re-spelling the expression will not fix it. Shrink it (fewer clauses, shallower nesting, ` +
    `fewer list elements), or precompute the heavy part into a stored field and reference that ` +
    `field instead. Splitting it into several expressions changes how they combine at this ` +
    `authoring site, so check that site's semantics before doing that.`
  );
}

/**
 * cel-js's unknown-call vocabulary, both of its spellings — a bare call
 * (`` `found no matching overload for 'totallyBogusFn(int, int)'` ``) and a
 * receiver call (`` `…for 'dyn.nosuchmethod(string)'` ``). Both are emitted from
 * one template family in `cel-js/lib/operators.js`, and the name we want is the
 * segment immediately before the argument list, after any receiver-type prefix.
 *
 * Anchored on the closing `)'` so the greedy receiver prefix cannot run past the
 * call into the source excerpt cel-js appends on the following lines.
 */
const NO_OVERLOAD_RE = /found no matching overload for '(?:.*[.])?([A-Za-z_$][\w$]*)\(.*?\)'/;

/**
 * The nearest advertised callable to `name`, or `undefined` when nothing is
 * close enough that a suggestion beats silence.
 *
 * Deliberately STRICTER than {@link nearestName}'s shared budget, and that
 * difference is the entire reason this function exists rather than a call to
 * the shared one. `nearest` spends `max(2, floor(name.length / 3))` edits —
 * right for a field name checked against the handful of fields on one object,
 * measurably wrong against this catalog: `nearestName('can', CEL_STDLIB_FUNCTIONS)`
 * answers `'min'`. Two edits on a three-character name, jumping from a
 * permission verb to a numeric function — a confident suggestion across an
 * unrelated namespace, which is worse than silence. An author who takes it (an
 * LLM author above all, following the last sentence it was handed) writes
 * `min(object, verb)` and is further from working than before it asked.
 *
 * The budget here is proportional rather than floored: at most one edit per
 * three characters of the LONGER name, so at least two thirds of a suggestion
 * must already be typed. That keeps the case that makes suggesting worthwhile
 * (`isBlnk` → `isBlank`, one edit in seven) and refuses the measured hazard
 * (`can` → `min`, two edits in three). Both are pinned in `validate.test.ts`;
 * a change to this budget that loses either is a regression, not a tuning.
 *
 * The distance metric stays the module's one {@link levenshtein} — only the
 * acceptance budget is class-specific, which is what the hazard is about.
 */
function nearestCallable(name: string): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of CEL_STDLIB_FUNCTIONS) {
    const distance = levenshtein(name, candidate);
    if (distance > Math.floor(Math.max(name.length, candidate.length) / 3)) continue;
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = candidate;
  }
  return best;
}

/**
 * The prescription for the **unknown-name** arm of a `type` refusal — an
 * expression that is perfectly good CEL and merely calls something by a name
 * that resolves to nothing in this position.
 *
 * The second leg of the repair {@link boundsHint} made for the `bounds` class
 * (#7073). Until this hint, every unknown-function refusal ended with the same
 * dialect trailer ("`predicate`s are bare CEL (e.g. `record.rating >= 4`)"),
 * and that sentence is actively wrong here for exactly the reason it was wrong
 * for `bounds`: the source already IS bare CEL and parses fine. An author who
 * obeys the last sentence they were given rewrites the dialect, learns nothing,
 * and comes back with the same unresolvable name. The front half (cel-js's own
 * `found no matching overload for '…'`) was right all along and is kept
 * verbatim; only the prescription lied.
 *
 * ### Why the name must be checked against the advertised catalog first
 *
 * cel-js emits ONE message shape for two different faults: a name that resolves
 * to nothing (`upperr(record.name)`) and a real function handed arguments no
 * overload accepts (`upper(1, 2)` → `found no matching overload for
 * 'upper(int, int)'`). Telling the second author that `upper` "is not a
 * callable name" would be a fresh false statement in place of a merely useless
 * one, so an advertised name falls through to the existing trailer untouched.
 *
 * ### Why the wording is "not a callable name HERE"
 *
 * {@link CEL_STDLIB_FUNCTIONS} is a curated bare-callable subset, not an oracle
 * for existence — 33 further names cel-js registers are callable only on a
 * receiver (`record.name.split(',')` works; bare `split(…)` faults here and
 * lands in this arm). So the message may say the name cannot be called in this
 * position, and may point at what IS advertised, but must not claim the name
 * does not exist. For the same reason it names no size: what the catalog
 * contains is being adjudicated separately, and a message asserting a count
 * would be falsified by that ruling.
 */
function unknownFunctionHint(celMessage: string): string | null {
  const name = NO_OVERLOAD_RE.exec(celMessage)?.[1];
  if (!name || CEL_STDLIB_FUNCTIONS.includes(name)) return null;
  const suggestion = nearestCallable(name);
  return (
    `\`${name}\` is not a callable name here — a NAME fault, not a dialect mistake, so ` +
    `re-spelling the expression will not fix it.` +
    (suggestion ? ` Did you mean \`${suggestion}\`?` : '') +
    ` The callable names this platform advertises for authoring are the \`functions\` list ` +
    `\`introspectScope\` returns (\`CEL_STDLIB_FUNCTIONS\`) — pick one of those, or precompute ` +
    `the value in a stored field and reference that field instead.`
  );
}

function checkFieldExistence(source: string, schema: ExprSchemaHint | undefined, errors: ExprValidationError[]): void {
  if (!schema?.fields || schema.fields.length === 0) return;
  const known = new Set(schema.fields);
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  RECORD_REF_RE.lastIndex = 0;
  while ((m = RECORD_REF_RE.exec(source)) !== null) {
    const field = m[1];
    if (seen.has(field) || known.has(field)) continue;
    seen.add(field);
    const suggestion = nearest(field, schema.fields);
    errors.push({
      source,
      message:
        `unknown field \`${field}\`${schema.objectName ? ` on \`${schema.objectName}\`` : ''}` +
        (suggestion ? ` — did you mean \`${suggestion}\`?` : ''),
    });
  }
}

/** Cheap edit-distance suggestion for typo'd field names. */
/**
 * The closest candidate to `name`, or `undefined` when nothing is close enough
 * to be worth suggesting.
 *
 * The public face of the same edit-distance heuristic this module already uses
 * for unknown field refs and unknown roles, exported so other "did you mean?"
 * diagnostics reuse one threshold instead of each inventing their own — an
 * author (increasingly an agent) should not get a suggestion here and silence
 * there for the same class of typo.
 */
export function nearestName(name: string, candidates: readonly string[]): string | undefined {
  return nearest(name, candidates);
}

function nearest(name: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[m];
}

// ADR-0068 D4 — position-membership predicate heads: a position NAME literal
// used in a membership test against a user subject's `.positions`
// (ADR-0090 D3 rename). Matched names are validated against the closed catalog.
const ROLE_IN_RE = /(['"])([a-z0-9_]+)\1\s+in\s+(?:current_user|user|ctx\.user)\.positions\b/g;
const ROLE_CONTAINS_RE = /(?:current_user|user|ctx\.user)\.positions\s*\.\s*contains\(\s*(['"])([a-z0-9_]+)\1\s*\)/g;
// Bounded quantifiers ({0,N}, not * / *?) keep this linear: a CEL `exists`
// body is tiny in practice, and unbounded greedy/lazy scanners here backtrack
// polynomially (O(n^2)) on adversarial input like repeated `user.positions.exists(`
// (ADR-0068 D4 ReDoS hardening). The pre-`==` class excludes `=` so the bounded
// run stops cleanly before the operator without a lazy quantifier.
const ROLE_EXISTS_RE = /(?:current_user|user|ctx\.user)\.positions\s*\.\s*exists\s*\([^,)]{0,64},[^)=]{0,128}==\s*(['"])([a-z0-9_]+)\1/g;
const ROLE_EQ_RE = /(?:current_user|user|ctx\.user)\.position\s*==\s*(['"])([a-z0-9_]+)\1/g;

/**
 * Flag role-membership predicates referencing a role outside the closed catalog
 * (ADR-0068 D4 — anti-hallucination). No-op when no `roleCatalog` is supplied.
 */
function checkRoleCatalog(
  source: string,
  schema: ExprSchemaHint | undefined,
  errors: ExprValidationError[],
): void {
  const catalog = schema?.roleCatalog;
  if (!catalog || catalog.length === 0) return;
  const known = new Set(catalog);
  const seen = new Set<string>();
  for (const re of [ROLE_IN_RE, ROLE_CONTAINS_RE, ROLE_EXISTS_RE, ROLE_EQ_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const name = m[2];
      if (known.has(name) || seen.has(name)) continue;
      seen.add(name);
      const suggestion = nearest(name, catalog);
      errors.push({
        source,
        message:
          `unknown role \`${name}\` — not a defined role` +
          (suggestion ? `; did you mean \`${suggestion}\`?` : '.') +
          ` Valid roles: ${catalog.join(', ')}.`,
      });
    }
  }
}

/**
 * Validate one expression for a given field role. Never throws — returns a
 * structured result. Call sites decide whether to throw (build/registration)
 * or report (agent tool).
 */
export function validateExpression(
  role: FieldRole,
  input: ExprInput,
  schema?: ExprSchemaHint,
): ExprValidationResult {
  const { dialect, source } = toSource(input);
  const errors: ExprValidationError[] = [];
  const warnings: ExprValidationError[] = [];
  if (!source.trim()) return { ok: true, errors, warnings };

  if (role === 'template') {
    // Templates must be the `template` dialect (or untyped string). Reject a
    // CEL envelope mistakenly placed in a text field.
    if (dialect && dialect !== 'template') {
      errors.push({ source, message: `expected a text template but got a \`${dialect}\` expression.` });
      return { ok: false, errors, warnings };
    }
    const compiled = templateEngine.compile(source);
    if (!compiled.ok) {
      errors.push({ source, message: `invalid template: ${compiled.error.message} (holes use \`{{ path }}\`).` });
    }
    // A single `{x}` in a template is the legacy/deprecated form (ADR-0032 §3).
    const hint = SINGLE_BRACE_RE.test(source) ? bracesHintForTemplate(source) : null;
    if (hint) errors.push({ source, message: hint });
    return { ok: errors.length === 0, errors, warnings };
  }

  // predicate | value → CEL
  if (dialect && dialect !== 'cel') {
    errors.push({ source, message: `expected a CEL expression but got a \`${dialect}\` dialect.` });
    return { ok: false, errors, warnings };
  }
  const compiled = celEngine.compile(source);
  if (!compiled.ok) {
    // #7073 — a bounds refusal gets the SIZE prescription, never the dialect
    // trailer: the source is already bare CEL, so "write bare CEL" is advice
    // that cannot succeed. #13821 routes the `type` class the same way for the
    // same reason, one class per arm. Both are checked before the braces hint
    // because the class is certain (it comes from the engine's own verdict)
    // while the braces hint is a heuristic.
    //
    // A `type` fault that names no unresolvable call — an operator or ternary
    // mismatch (`1 + 'a'`, `no such overload: int + string`), or a real function
    // handed wrong arguments — returns null from `unknownFunctionHint` and keeps
    // the existing trailer: this arm has a name to hand back or it says nothing.
    const classHint =
      compiled.error.kind === 'bounds'
        ? boundsHint(source)
        : compiled.error.kind === 'type'
          ? unknownFunctionHint(compiled.error.message)
          : null;
    const hint = classHint ?? bracesHint(source);
    errors.push({
      source,
      message:
        `invalid CEL ${role}: ${compiled.error.message}` +
        (hint ? ` — ${hint}` : ` — ${role}s are bare CEL (e.g. \`record.rating >= 4\`).`),
    });
  } else {
    checkFieldExistence(source, schema, errors);
    checkRoleCatalog(source, schema, errors);
    if (schema?.scope === 'record') {
      // In a `record`-scoped site a bare top-level identifier is a silent bug —
      // it must be `record.<field>` (#1928). Hard error.
      const bare = firstUndeclaredReference(source);
      if (bare) {
        errors.push({
          source,
          message:
            `bare reference \`${bare}\` — a formula/validation expression binds the record as the ` +
            `\`record\` namespace, not at top level, so \`${bare}\` resolves to nothing and the ` +
            `expression silently evaluates to null. Write \`record.${bare}\`.`,
        });
      } else if (schema.fieldTypes) {
        // #1928 / #3306 — with per-field types in hand, flag a type-unsound
        // operator use that faults at runtime and silently nulls: a text/boolean
        // field arithmetic'd/ordered against a number (advisory warning — a
        // numeric text value can succeed), or date-field arithmetic (hard error —
        // always nulls). Only runs when there is no bare-ref error (the typed
        // check needs the canonical `record.<field>` form).
        const r = typeSoundnessIssue(source, schema.fieldTypes, 'record');
        if (r) (r.severity === 'error' ? errors : warnings).push(r.issue);
      }
    } else if (schema?.fields && schema.fields.length > 0) {
      // Flattened flow/automation condition: the record's fields ARE bound at
      // top-level, so a bare ref is normally correct. But a *non-field* bare
      // identifier is either a flow variable or a typo. When it is a near-miss
      // of a known field, warn (did-you-mean) WITHOUT failing the build —
      // a genuine flow variable won't be edit-distance-close to a field. (#1928)
      const unknown = firstUndeclaredReference(source, schema.fields);
      if (unknown) {
        const suggestion = nearest(unknown, schema.fields);
        if (suggestion) {
          warnings.push({
            source,
            message:
              `\`${unknown}\` is not a field of \`${schema.objectName ?? 'the trigger object'}\` — ` +
              `did you mean \`${suggestion}\`? (flow conditions reference fields bare, e.g. \`${suggestion} == …\`). ` +
              `If \`${unknown}\` is a flow variable this is safe to ignore.`,
          });
        }
      }
      // #1928 / #3306 — the same type-soundness check, for bare-field conditions:
      // a text/boolean field compared/arithmetic'd against a number (advisory), or
      // date-field arithmetic (error). Flow variables stay `dyn` (never flagged);
      // equality/ordering of a date is runtime-safe (never flagged).
      if (schema.fieldTypes) {
        const r = typeSoundnessIssue(source, schema.fieldTypes, 'flattened');
        if (r) (r.severity === 'error' ? errors : warnings).push(r.issue);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function bracesHintForTemplate(source: string): string {
  const m = SINGLE_BRACE_RE.exec(source);
  const ref = m?.[1] ?? 'field';
  return `single-brace \`{${ref}}\` is not a valid template hole — use double braces: \`{{ ${ref} }}\`.`;
}

/**
 * Introspect what an author (esp. an agent) may use in a field (Decision 1e):
 * the expected dialect, the in-scope field references, and the callable
 * functions. Feeds the authoring context so the model does not guess.
 */
export function introspectScope(role: FieldRole, schema?: ExprSchemaHint): {
  dialect: 'cel' | 'template';
  fields: string[];
  roots: string[];
  roles: string[];
  functions: string[];
} {
  return {
    dialect: expectedDialect(role),
    fields: [...(schema?.fields ?? [])],
    roots: ['record', 'previous', 'input', 'os', 'current_user', 'user', 'vars'],
    roles: [...(schema?.roleCatalog ?? [])],
    functions: CEL_STDLIB_FUNCTIONS,
  };
}

/**
 * Coarse value categories a `value`/formula expression can compute. `'unknown'`
 * means cel-js could not prove a concrete type — either a `dyn` result (an
 * ambiguous expression over untyped operands) or one that does not type-check.
 */
export type InferredValueType = 'number' | 'text' | 'boolean' | 'date' | 'unknown';

/** Map a cel-js type-checker type name onto an ObjectStack field value category. */
function celTypeToValueType(celType: string | null): InferredValueType {
  switch (celType) {
    case 'int':
    case 'uint':
    case 'double':
      return 'number';
    case 'string':
      return 'text';
    case 'bool':
      return 'boolean';
    case 'google.protobuf.Timestamp':
      return 'date';
    default:
      // `dyn`, `google.protobuf.Duration`, list/map, null, or un-type-checkable.
      return 'unknown';
  }
}

/**
 * Infer the coarse value type a `value`/formula expression computes — `'number'`,
 * `'text'`, `'boolean'`, `'date'`, or `'unknown'` when cel-js cannot prove a
 * concrete type. `schema.fields` (the host object's field names) are declared so
 * a bare `<field>` reference resolves the same as `record.<field>`.
 *
 * The motivating use is measure-eligibility: a dataset derives a SUM measure for
 * a `formula` field ONLY when this returns `'number'`, so an ambiguous or
 * non-numeric formula never yields an incoherent measure. Conservative by
 * construction — see {@link inferCelType}.
 */
export function inferExpressionType(input: ExprInput, schema?: ExprSchemaHint): InferredValueType {
  const { source } = toSource(input);
  if (!source.trim()) return 'unknown';
  return celTypeToValueType(inferCelType(source, schema?.fields));
}

/**
 * Public catalog of CEL functions available in expressions — what `introspectScope`
 * advertises to authors (incl. AI). Every entry MUST actually resolve at runtime:
 * either registered in `registerStdLib` or a verified cel-js built-in. Drifting this
 * list ahead of the runtime tells the author to call functions that fault (#1928).
 *
 * ## This is a CURATED SUBSET of what the environment resolves — by construction
 *
 * The evaluation `Environment` resolves **72** distinct function names. This list
 * carries 35 of them, and the 37-name gap is NOT staleness. Measured decomposition
 * (`cel-stdlib-drift.test.ts` re-measures all four numbers on every run):
 *
 *   72 registered names
 *    = 39 callable BARE, as `fn(x)`            -> the only shape this list may carry
 *    + 33 callable only on a RECEIVER, `x.fn()` -> structurally ineligible
 *
 *   39 bare-callable
 *    = 27 added by `registerStdLib`   -> ALL advertised (one per registration site)
 *    +  8 cel-js built-ins            -> advertised: has size int string bool double
 *                                        timestamp duration
 *    +  4 cel-js built-ins WITHHELD   -> bytes dyn type uint
 *
 * **Bare-callability is the membership rule, and it is load-bearing.** Every
 * consumer spends an entry as a bare call: objectui's Studio predicate editor
 * inserts a suggestion verbatim as `` `name(` `` (`CelPredicateField.tsx`), and the
 * runtime drift guard in `cel-engine.test.ts` probes each entry with a bare-call
 * expression. So the 33 receiver-only names cel-js registers (`s.split(',')`,
 * `list.map(...)`, `ts.getFullYear()`, `opt.orValue(...)`) can never appear here:
 * flattening them into this list would autocomplete `split(` into an author's
 * predicate, which faults `no matching overload`. Widening this list to "every
 * registered name" is therefore not the safe direction — it is a broken one.
 *
 * The 4 withheld bare-callables are CEL's remaining type-conversion/introspection
 * primitives. They resolve today; they are withheld as an authoring decision (no
 * measured demand, and `dyn`/`uint`/`bytes` mostly widen the ways an AI author can
 * emit something unusable), not because they are unavailable. That withholding is
 * a declared ledger in the drift pin, so adding one is a deliberate edit and a new
 * cel-js built-in cannot arrive unnoticed.
 *
 * ⛔ This list is NOT an oracle for rejecting unknown functions. A gate that
 * rejects what is absent here would reject 37 names that resolve and evaluate
 * today. The unknown-function verdict belongs to the engine's own `check()`
 * (ruling on #13594); `@objectstack/lint` uses that and never reads this list.
 */
export const CEL_STDLIB_FUNCTIONS: string[] = [
  // Dates (registered stdlib)
  'now', 'today', 'daysFromNow', 'daysAgo', 'daysBetween', 'addDays', 'addMonths', 'date', 'datetime',
  // Numbers (registered stdlib)
  'abs', 'round', 'floor', 'ceil', 'min', 'max',
  // Strings (registered stdlib)
  'upper', 'lower', 'trim', 'contains', 'startsWith', 'endsWith', 'matches', 'joinNonEmpty',
  // Collections / null-ish (registered stdlib)
  'isBlank', 'isEmpty', 'coalesce', 'len',
  // cel-js built-ins (verified to resolve)
  'size', 'has', 'int', 'string', 'bool', 'double', 'timestamp', 'duration',
];
