// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Validation-Rule Evaluator (ADR-0020)
 *
 * Where `record-validator.ts` checks field *shape* (types, lengths, option
 * membership), this module enforces the object-level **business rules**
 * declared in `ObjectSchema.validations` — the discriminated union of
 * `state_machine`, `cross_field`, `script`, … rules.
 *
 * Until ADR-0020 these rules were pure declaration: nothing on the write
 * path ever read `objectSchema.validations`, so a `state_machine` rule that
 * said "an account can't jump from churned straight back to prospect"
 * silently allowed exactly that. This evaluator closes that gap.
 *
 * ## What runs here
 *
 *  - `state_machine` — the headline guardrail. On update, if the state field
 *    changed and the new value is not in `transitions[oldValue]`, the write
 *    is rejected. Needs the **prior** record (see plumbing note below).
 *  - `script` / `cross_field` — CEL predicates. If the predicate evaluates
 *    TRUE the rule is violated. These share the prior-record gap with
 *    `state_machine` (a PATCH carries only changed fields), so they are
 *    evaluated against the *merged* record `{ ...previous, ...patch }`.
 *  - `format` — a single field's value against a regex and/or a named format
 *    (`email` / `url` / `phone` / `json`). Only runs when the write touches
 *    the field and the value is non-empty (emptiness is the field-shape
 *    validator's job, not the format rule's).
 *  - `json_schema` — a JSON field validated against a JSON Schema via ajv.
 *  - `conditional` — evaluates the `when` CEL predicate and then recurses into
 *    `then` (true) or `otherwise` (false). The nested rule's violation message
 *    is surfaced; the *outer* conditional's `severity` decides whether it
 *    blocks (so `when`-gated guards can be advisory as a unit).
 *
 * Every variant declared by `ValidationRuleSchema` is enforced here — the
 * schema deliberately excludes anything that would need I/O or a handler model
 * (uniqueness → DB index, async → form layer, custom → lifecycle hook), so
 * there are no silent no-ops.
 *
 * ## Execution-control semantics (from `BaseValidationSchema`)
 *
 *  - `active: false`        → rule skipped entirely.
 *  - `events`               → rule only runs for the matching write context
 *                             (`insert` / `update`). `delete` is not a write
 *                             payload context here.
 *  - `priority`             → rules evaluated low-number-first (stable).
 *  - `severity`             → only `error` blocks the write. `warning` / `info`
 *                             are logged (best-effort) and never throw.
 *
 * ## Fail-open for *broken* rules, fail-closed for *violated* rules
 *
 * A CEL predicate that cannot be evaluated (parse error, references an
 * unbound variable, …) is a broken rule, not a violated one — it is logged
 * and skipped rather than bricking every write to the object. A predicate
 * that evaluates cleanly to "violated", or a transition that is definitively
 * illegal, is fail-closed (the write is rejected).
 *
 * ## Prior-record plumbing
 *
 * `state_machine` and the field-spanning predicates are meaningful only with
 * the record's prior state. The engine fetches it once (see
 * `engine.update`) and threads it in via `opts.previous`. On `insert` there
 * is no prior state, so `state_machine` is a no-op (the field-level select
 * check already constrains the initial value to a declared option).
 */

import { ExpressionEngine } from '@objectstack/formula';
import type { Expression } from '@objectstack/spec';
import Ajv, { type ValidateFunction } from 'ajv';
import { ValidationError, type FieldValidationError } from './record-validator.js';

type Mode = 'insert' | 'update';

interface BaseRule {
  type: string;
  name: string;
  message: string;
  active?: boolean;
  events?: Array<'insert' | 'update' | 'delete'>;
  priority?: number;
  severity?: 'error' | 'warning' | 'info';
}

interface StateMachineRule extends BaseRule {
  type: 'state_machine';
  field: string;
  transitions: Record<string, string[]>;
}

interface PredicateRule extends BaseRule {
  type: 'script' | 'cross_field';
  condition: string | Expression;
  fields?: string[];
}

interface FormatRule extends BaseRule {
  type: 'format';
  field: string;
  regex?: string;
  format?: 'email' | 'url' | 'phone' | 'json';
}

interface JsonSchemaRule extends BaseRule {
  type: 'json_schema';
  field: string;
  schema: Record<string, unknown>;
}

interface ConditionalRule extends BaseRule {
  type: 'conditional';
  when: string | Expression;
  then: BaseRule;
  otherwise?: BaseRule;
}

/**
 * Context threaded through every rule evaluation. `data` is the raw incoming
 * write (a PATCH on update); `merged` overlays it on the prior record so a
 * predicate referencing an unchanged field still sees its persisted value.
 * Field-scoped rules (`state_machine`, `format`, `json_schema`) key off `data`
 * to decide whether the write actually touched their field.
 */
interface RuleContext {
  data: Record<string, unknown>;
  merged: Record<string, unknown>;
  previous: Record<string, unknown> | undefined;
  mode: Mode;
  logger: EvaluateRulesOptions['logger'];
}

/**
 * Shared ajv instance. `strict: false` tolerates author-written JSON Schemas
 * that use vendor keywords; `compile` results are memoised per schema object
 * (see `jsonSchemaCache`) so we don't recompile on every write.
 */
const ajv = new Ajv({ allErrors: true, strict: false });
const jsonSchemaCache = new WeakMap<object, ValidateFunction>();

export interface EvaluateRulesOptions {
  /** Prior persisted record (update only). Absent on insert. */
  previous?: Record<string, unknown> | null;
  /** Optional logger for non-blocking diagnostics (broken rules, warnings). */
  logger?: { warn?: (msg: string, meta?: any) => void };
  /**
   * The acting user (ADR-0068 EvalUser shape), surfaced to per-option
   * `visibleWhen` predicates as `current_user` so role/context-gated options can
   * be enforced server-side (objectui#2284). Absent on system/unauthenticated
   * writes — role predicates then reference an unbound `current_user`, fault,
   * and fail-open (see {@link evaluateOptionVisibility}).
   */
  currentUser?: { id?: string; roles?: string[]; organizationId?: string | null; [k: string]: unknown } | null;
}

/**
 * Returns true when the object declares at least one validation rule whose
 * correct evaluation needs the prior record (so the engine knows whether the
 * extra fetch on the update path is worth it).
 */
export function needsPriorRecord(
  objectSchema: { validations?: unknown[]; fields?: Record<string, ConditionalFieldDef> } | undefined | null,
): boolean {
  const rules = objectSchema?.validations;
  const ruleNeeds = Array.isArray(rules) && rules.some((r) => ruleNeedsPrior(r));
  return !!(ruleNeeds || fieldsNeedPrior(objectSchema?.fields));
}

/**
 * Strip fields whose `readonlyWhen` CEL predicate is TRUE for the (merged)
 * record from an UPDATE payload — the field is locked, so an incoming change is
 * ignored (the persisted value is kept) rather than rejected. Returns the same
 * object when nothing is locked, else a shallow copy with the locked keys
 * removed. A broken predicate is fail-open (the change is allowed through).
 */
export function stripReadonlyWhenFields(
  objectSchema: { fields?: Record<string, ConditionalFieldDef> } | undefined | null,
  data: Record<string, unknown> | undefined | null,
  previous: Record<string, unknown> | undefined | null,
  logger?: EvaluateRulesOptions['logger'],
): Record<string, unknown> | undefined | null {
  const fields = objectSchema?.fields;
  if (!fields || !data) return data;
  const merged = { ...(previous ?? {}), ...data };
  let result = data;
  for (const [name, def] of Object.entries(fields)) {
    if (!def?.readonlyWhen || !(name in data)) continue;
    const res = ExpressionEngine.evaluate<boolean>(toExpression(def.readonlyWhen), {
      record: merged,
      previous: previous ?? undefined,
    });
    if (!res.ok) {
      logger?.warn?.(`readonlyWhen for '${name}' failed to evaluate — change allowed through`);
      continue;
    }
    if (res.value === true) {
      if (result === data) result = { ...data };
      delete (result as Record<string, unknown>)[name];
      logger?.warn?.(`Field '${name}' is read-only (readonlyWhen) — ignoring incoming change`);
    }
  }
  return result;
}

/**
 * A rule needs the prior record if it reasons about the transition or compares
 * against unchanged fields (`state_machine` / `cross_field` / `script`), or if
 * it is a `conditional` whose branches (or `when`) recursively do. `format` and
 * `json_schema` only inspect the incoming value, so they never need it.
 */
function ruleNeedsPrior(r: unknown): boolean {
  if (r == null || typeof r !== 'object') return false;
  const type = (r as BaseRule).type;
  if (type === 'state_machine' || type === 'cross_field' || type === 'script') {
    return true;
  }
  if (type === 'conditional') {
    const c = r as ConditionalRule;
    // `when` is evaluated against the merged record; the branches may need prior
    // state. Be conservative and fetch if either branch does.
    return ruleNeedsPrior(c.then) || ruleNeedsPrior(c.otherwise);
  }
  return false;
}

/** Field-level conditional rules (B2): a field is required / read-only when its
 *  CEL predicate is TRUE over the record. */
interface ConditionalFieldOption {
  value?: unknown;
  /** Per-option visibility predicate (CEL) — objectui#2284. */
  visibleWhen?: string | Expression;
}

interface ConditionalFieldDef {
  requiredWhen?: string | Expression;
  conditionalRequired?: string | Expression; // back-compat alias of requiredWhen
  readonlyWhen?: string | Expression;
  /** Field type — scopes per-option `visibleWhen` enforcement to choice fields. */
  type?: string;
  /** Select/multiselect/radio options; an option may gate itself with `visibleWhen`. */
  options?: Array<ConditionalFieldOption | null | undefined>;
}

/** Choice fields whose picked value(s) are drawn from `options`. */
const CHOICE_FIELD_TYPES = new Set(['select', 'multiselect', 'radio']);

/** True when a choice field carries at least one option gated by `visibleWhen`. */
function fieldHasOptionVisibility(def: ConditionalFieldDef | undefined | null): boolean {
  if (!def || !CHOICE_FIELD_TYPES.has(String(def.type))) return false;
  return Array.isArray(def.options) && def.options.some((o) => o != null && o.visibleWhen != null);
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** True when any field declares a conditional rule that needs the merged/prior
 *  record to evaluate (so the engine fetches `previous` on update). Per-option
 *  `visibleWhen` counts too — a cascade predicate can reference an unchanged
 *  sibling that only `previous` supplies (objectui#2284). */
function fieldsNeedPrior(fields: Record<string, ConditionalFieldDef> | undefined): boolean {
  if (!fields) return false;
  return Object.values(fields).some(
    (f) => f && (f.requiredWhen || f.conditionalRequired || f.readonlyWhen || fieldHasOptionVisibility(f)),
  );
}

/** Normalize an author-time ExpressionInput into the canonical envelope. */
function toExpression(cond: string | Expression): Expression {
  return typeof cond === 'string' ? { dialect: 'cel', source: cond } : cond;
}

/**
 * Per-option authorization / cascade enforcement (objectui#2284).
 *
 * A `select` / `multiselect` / `radio` option may gate itself with a
 * `visibleWhen` CEL predicate, evaluated against the live record + `current_user`
 * (the same predicate the client uses to hide the option). Client-side hiding is
 * UX, not a security boundary — a caller can still submit a hidden value — so on
 * write we re-evaluate the predicate for the *picked* value(s) and reject any
 * that resolve cleanly to FALSE. This enforces both role/context gating
 * (`'admin' in current_user.roles`) and cascade integrity (`record.country ==
 * 'cn'`), server-side.
 *
 * Only WRITTEN fields are checked — an unchanged persisted value is left alone.
 * A predicate that can't be evaluated (missing referenced field, unbound
 * `current_user` on a system write) is **fail-open** (logged, allowed), matching
 * every other field rule here: a broken cascade predicate must never brick a
 * write. Authorization gating therefore depends on the engine binding
 * `current_user` on authenticated writes.
 */
function evaluateOptionVisibility(
  fields: Record<string, ConditionalFieldDef> | undefined,
  data: Record<string, unknown>,
  merged: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  currentUser: EvaluateRulesOptions['currentUser'],
  errors: FieldValidationError[],
  logger: EvaluateRulesOptions['logger'],
): void {
  if (!fields) return;
  const user = (currentUser ?? undefined) as any;
  for (const [name, def] of Object.entries(fields)) {
    if (!fieldHasOptionVisibility(def) || !(name in data)) continue;
    const raw = data[name];
    if (raw === undefined || raw === null || raw === '') continue;
    const picked = Array.isArray(raw) ? raw : [raw];
    for (const value of picked) {
      const opt = def.options!.find((o) => o != null && o.value === value);
      // Unknown value (not in options) or an ungated option → nothing to enforce
      // here; an out-of-set value is the enum validator's concern, not ours.
      if (!opt || opt.visibleWhen == null) continue;
      const res = ExpressionEngine.evaluate<boolean>(toExpression(opt.visibleWhen), {
        record: merged,
        previous,
        user,
      });
      if (!res.ok) {
        logger?.warn?.(
          `option visibleWhen for '${name}=${String(value)}' failed to evaluate — allowed through`,
        );
        continue; // fail-open
      }
      if (res.value === false) {
        errors.push({
          field: name,
          code: 'invalid_option',
          message: `${name}: option '${String(value)}' is not available`,
        });
      }
    }
  }
}

/**
 * Evaluate an object's declared validation rules against an incoming write.
 *
 * Throws `ValidationError` (the same envelope `validateRecord` uses, so REST
 * surfaces a single `400 VALIDATION_FAILED`) when one or more `error`-severity
 * rules are violated. Returns void otherwise.
 */
export function evaluateValidationRules(
  objectSchema: { validations?: unknown[]; fields?: Record<string, ConditionalFieldDef> } | undefined | null,
  data: Record<string, unknown> | undefined | null,
  mode: Mode,
  opts: EvaluateRulesOptions = {},
): void {
  if (!data) return;
  const rules = objectSchema?.validations;
  const hasRules = Array.isArray(rules) && rules.length > 0;
  const fields = objectSchema?.fields;
  const hasFieldRules = fieldsNeedPrior(fields);
  if (!hasRules && !hasFieldRules) return;

  const previous = opts.previous ?? undefined;
  // Merged view used by predicate rules: prior state overlaid with the PATCH,
  // so a rule referencing an unchanged field still sees its persisted value.
  const merged: Record<string, unknown> = { ...(previous ?? {}), ...data };
  // #1871 — on INSERT, a field omitted entirely from the payload is absent from
  // the record, so a `record.x == null` predicate sees a missing CEL key (which
  // does not equal null) and silently can't match. Default declared-but-absent
  // fields to null so an omitted optional reads as null — matching an explicit
  // `null` and the UPDATE path (where the prior record already supplies them).
  if (mode === 'insert' && fields) {
    for (const name of Object.keys(fields)) {
      if (!(name in merged)) merged[name] = null;
    }
  }
  const ctx: RuleContext = { data, merged, previous, mode, logger: opts.logger };

  const errors: FieldValidationError[] = [];

  // Field-level conditional rules (B2): a field whose `requiredWhen`
  // (or its `conditionalRequired` alias) predicate is TRUE over the merged
  // record must have a value — enforced server-side so the rule can't be
  // bypassed. (`readonlyWhen` is handled by stripReadonlyWhenFields on the
  // write path, not here.) A broken predicate is fail-open (logged, skipped).
  if (hasFieldRules && fields) {
    for (const [name, def] of Object.entries(fields)) {
      const pred = def?.requiredWhen ?? def?.conditionalRequired;
      if (!pred) continue;
      const res = ExpressionEngine.evaluate<boolean>(toExpression(pred), { record: merged, previous });
      if (!res.ok) {
        opts.logger?.warn?.(`requiredWhen for '${name}' failed to evaluate — skipped`);
        continue;
      }
      if (res.value === true && isMissing(merged[name])) {
        errors.push({ field: name, code: 'required', message: `${name} is required` });
      }
    }
  }

  // Per-option authorization / cascade gating (objectui#2284): reject a written
  // choice value whose option `visibleWhen` resolves cleanly to FALSE against the
  // merged record + `current_user`. Complements the client-side hiding, which is
  // not a security boundary.
  evaluateOptionVisibility(fields, data, merged, previous, opts.currentUser, errors, opts.logger);

  const ordered = (hasRules ? rules! : [])
    .filter((r): r is BaseRule => r != null && typeof r === 'object')
    .filter((r) => r.active !== false)
    .filter((r) => {
      const events = r.events ?? ['insert', 'update'];
      return events.includes(mode);
    })
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const rule of ordered) {
    let violation: FieldValidationError | null = null;
    try {
      violation = evaluateRule(rule, ctx);
    } catch (err) {
      // Defensive: a broken rule must never brick a write.
      opts.logger?.warn?.(`Validation rule '${rule.name}' threw — skipped`, err);
      continue;
    }

    if (!violation) continue;

    const severity = rule.severity ?? 'error';
    if (severity === 'error') {
      errors.push(violation);
    } else {
      opts.logger?.warn?.(
        `Validation rule '${rule.name}' (${severity}): ${violation.message}`,
      );
    }
  }

  if (errors.length > 0) throw new ValidationError(errors);
}

/**
 * Dispatch a single rule to its checker, returning the violation (or null).
 * Shared by the top-level loop and by `checkConditional`, which recurses into
 * its `then` / `otherwise` branch. Unknown types return null — but the schema
 * (`ValidationRuleSchema`) only admits the types handled below, so in practice
 * every declared rule is covered.
 */
function evaluateRule(rule: BaseRule, ctx: RuleContext): FieldValidationError | null {
  switch (rule.type) {
    case 'state_machine':
      return checkStateMachine(rule as StateMachineRule, ctx.mode, ctx.data, ctx.previous);
    case 'script':
    case 'cross_field':
      return checkPredicate(rule as PredicateRule, ctx.merged, ctx.previous, ctx.logger);
    case 'format':
      return checkFormat(rule as FormatRule, ctx.data, ctx.logger);
    case 'json_schema':
      return checkJsonSchema(rule as JsonSchemaRule, ctx.data, ctx.logger);
    case 'conditional':
      return checkConditional(rule as ConditionalRule, ctx);
    default:
      return null;
  }
}

/**
 * State-machine transition check.
 *
 * Only meaningful on update with a prior record: if the state field changed,
 * the new value must appear in `transitions[oldValue]`. Lenient where it
 * cannot reason (no prior record, unchanged value, or a prior state with no
 * declared transitions) so it never blocks legitimate or legacy data.
 */
function checkStateMachine(
  rule: StateMachineRule,
  mode: Mode,
  data: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
): FieldValidationError | null {
  // Insert has no prior state — the field-level select check already
  // constrains the initial value to a declared option.
  if (mode === 'insert' || !previous) return null;
  // The PATCH didn't touch the state field → no transition to validate.
  if (!(rule.field in data)) return null;

  const from = previous[rule.field];
  const to = data[rule.field];
  // No change, or clearing the value → nothing to enforce.
  if (from === to || to === undefined || to === null) return null;

  const fromKey = String(from);
  const allowed = rule.transitions[fromKey];
  // Prior state not described by the FSM (legacy / external write) — cannot
  // reason about its legal targets, so don't block.
  if (!Array.isArray(allowed)) return null;

  if (!allowed.includes(String(to))) {
    return {
      field: rule.field,
      code: 'invalid_transition',
      message:
        rule.message ||
        `Invalid transition for ${rule.field}: ${fromKey} → ${String(to)}`,
    };
  }
  return null;
}

/**
 * CEL predicate check (`script` / `cross_field`). The predicate expresses the
 * *failure* condition: if it evaluates TRUE the rule is violated. An
 * un-evaluable predicate is treated as a broken rule (logged, skipped).
 */
function checkPredicate(
  rule: PredicateRule,
  record: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  logger: EvaluateRulesOptions['logger'],
): FieldValidationError | null {
  const expr = toExpression(rule.condition);
  const result = ExpressionEngine.evaluate<boolean>(expr, {
    record,
    previous: previous ?? undefined,
  });

  if (!result.ok) {
    logger?.warn?.(
      `Validation rule '${rule.name}' predicate failed to evaluate (${result.error.kind}: ${result.error.message}) — skipped`,
    );
    return null;
  }

  if (result.value === true) {
    return {
      field: rule.fields?.[0] ?? '_record',
      code: 'rule_violation',
      message: rule.message,
    };
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Lenient phone matcher: optional leading +, then 7–20 digits with spaces,
// dashes, dots and parens allowed as separators. Intentionally permissive —
// strict national formats belong in a `regex`.
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;

/**
 * Format check (`format`). Validates a single field's value against an optional
 * `regex` and/or a named `format`. Only runs when the write touches the field
 * (mirrors `state_machine`) and the value is non-empty — requiredness and
 * type-shape are the field-level validator's job, so an absent/blank value is
 * not a *format* violation. A malformed `regex` is a broken rule (logged,
 * fail-open), not a violation.
 */
function checkFormat(
  rule: FormatRule,
  data: Record<string, unknown>,
  logger: EvaluateRulesOptions['logger'],
): FieldValidationError | null {
  if (!(rule.field in data)) return null;
  const value = data[rule.field];
  if (value === null || value === undefined || value === '') return null;
  const str = String(value);

  if (rule.regex) {
    let re: RegExp;
    try {
      re = new RegExp(rule.regex);
    } catch {
      logger?.warn?.(`Validation rule '${rule.name}' has an invalid regex — skipped`);
      return null;
    }
    if (!re.test(str)) return formatViolation(rule);
  }

  if (rule.format && !matchesNamedFormat(rule.format, str)) {
    return formatViolation(rule);
  }
  return null;
}

function matchesNamedFormat(format: FormatRule['format'], str: string): boolean {
  switch (format) {
    case 'email':
      return EMAIL_RE.test(str);
    case 'phone':
      return PHONE_RE.test(str);
    case 'url':
      try {
        // eslint-disable-next-line no-new
        new URL(str);
        return true;
      } catch {
        return false;
      }
    case 'json':
      try {
        JSON.parse(str);
        return true;
      } catch {
        return false;
      }
    default:
      return true;
  }
}

function formatViolation(rule: FormatRule): FieldValidationError {
  return { field: rule.field, code: 'invalid_format', message: rule.message };
}

/**
 * JSON Schema check (`json_schema`). Validates a JSON field against the rule's
 * schema via ajv. The field value may be a parsed object or a JSON string (a
 * string that fails to parse is itself a violation). Only runs when the write
 * touches the field and the value is non-null. A schema ajv cannot compile is a
 * broken rule (logged, fail-open).
 */
function checkJsonSchema(
  rule: JsonSchemaRule,
  data: Record<string, unknown>,
  logger: EvaluateRulesOptions['logger'],
): FieldValidationError | null {
  if (!(rule.field in data)) return null;
  let value = data[rule.field];
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { field: rule.field, code: 'invalid_json', message: rule.message };
    }
  }

  let validate = jsonSchemaCache.get(rule.schema);
  if (!validate) {
    try {
      validate = ajv.compile(rule.schema);
    } catch (err) {
      logger?.warn?.(
        `Validation rule '${rule.name}' has an uncompilable JSON Schema — skipped`,
        err,
      );
      return null;
    }
    jsonSchemaCache.set(rule.schema, validate);
  }

  if (!validate(value)) {
    return { field: rule.field, code: 'json_schema_violation', message: rule.message };
  }
  return null;
}

/**
 * Conditional check (`conditional`). Evaluates the `when` predicate against the
 * merged record, then recurses into `then` (true) or `otherwise` (false) via
 * `evaluateRule`. An un-evaluable `when` is a broken rule (logged, fail-open).
 * The nested rule supplies the violation (field/code/message); the *outer*
 * conditional's `severity` governs whether it blocks (handled by the caller).
 */
function checkConditional(
  rule: ConditionalRule,
  ctx: RuleContext,
): FieldValidationError | null {
  const result = ExpressionEngine.evaluate<boolean>(toExpression(rule.when), {
    record: ctx.merged,
    previous: ctx.previous ?? undefined,
  });

  if (!result.ok) {
    ctx.logger?.warn?.(
      `Validation rule '${rule.name}' when-predicate failed to evaluate (${result.error.kind}: ${result.error.message}) — skipped`,
    );
    return null;
  }

  const branch = result.value === true ? rule.then : rule.otherwise;
  if (!branch || branch.active === false) return null;
  return evaluateRule(branch, ctx);
}

/**
 * Introspection helper (ADR-0020 D3.3): given an object's schema, a state
 * field, and a current state, return the legal next states declared by the
 * matching `state_machine` rule. Returns `null` when no such rule exists (so
 * callers can distinguish "no FSM governs this field" from "a dead-end state
 * with zero outgoing transitions", which returns `[]`).
 */
export function legalNextStates(
  objectSchema: { validations?: unknown[] } | undefined | null,
  field: string,
  currentState: string,
): string[] | null {
  const rules = objectSchema?.validations;
  if (!Array.isArray(rules)) return null;
  const rule = rules.find(
    (r): r is StateMachineRule =>
      r != null &&
      typeof r === 'object' &&
      (r as BaseRule).type === 'state_machine' &&
      (r as StateMachineRule).field === field,
  );
  if (!rule) return null;
  return rule.transitions[currentState] ?? [];
}
