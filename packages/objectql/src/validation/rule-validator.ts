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
 *    is rejected. Needs the **prior** record (see plumbing note below). On
 *    insert, if the rule declares `initialStates`, the created value must be one
 *    of them (the FSM entry point, #3165); otherwise insert is a no-op.
 *  - `script` / `cross_field` — CEL predicates. If the predicate evaluates
 *    TRUE the rule is violated. These share the prior-record gap with
 *    `state_machine` (a PATCH carries only changed fields), so they are
 *    evaluated against the *merged* record `{ ...previous, ...patch }`.
 *  - `format` — a single field's value against a regex and/or a named format
 *    (`email` / `url` / `phone` / `json`). Only runs when the write touches
 *    the field and the value is non-empty (emptiness is the field-shape
 *    validator's job, not the format rule's).
 *  - `json_schema` — a JSON field validated against a JSON Schema via ajv,
 *    with `ajv-formats` registered so the standard `format` keyword (`email`,
 *    `uri`, `uuid`, `date-time`, …) is actually enforced (#5029).
 *  - `conditional` — evaluates the `when` CEL predicate and then recurses into
 *    `then` (true) or `otherwise` (false). The nested rule's violation message
 *    is surfaced; the *outer* conditional's `severity` decides whether it
 *    blocks (so `when`-gated guards can be advisory as a unit).
 *
 * Every variant declared by `ValidationRuleSchema` is enforced here — the
 * schema deliberately excludes anything that would need I/O or a handler model
 * (uniqueness → DB index, async → form layer, custom → lifecycle hook). The
 * engine invokes this evaluator on insert, single-id update, and — per matched
 * row — multi-row (`multi: true`) update (#3106), so no declared rule is a
 * silent no-op on the write path. The `events` enum admits only `insert`/`update`
 * to match: `delete` carries no record payload to validate, so it was removed
 * from the spec rather than advertised-but-unenforced (#3184). Guard deletions
 * with a `beforeDelete` lifecycle hook instead.
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
 * ## Fail-CLOSED for unevaluable predicates (#4649)
 *
 * A validation exists to reject a write, so "the rule could not be checked"
 * must never resolve to "the write goes through". Until #4649 a CEL predicate
 * that faulted was logged at WARN and **skipped**: the rule stayed declared,
 * listed in the metadata, and enforced nothing — on exactly the records whose
 * shape triggered the fault. That inverts the guarantee the rule was written
 * to give, and the only signal was a line in a log.
 *
 * Two changes close it, and they are load-bearing together:
 *
 *  1. **The record a predicate sees is TOTAL** — every field the object
 *     declares is present, `null` when absent from both the payload and the
 *     prior record ({@link materializeDeclaredFields}). This already held on
 *     insert (#1871); #4649 extends it to update and to the `previous`
 *     binding, so a predicate written against the object's DECLARED shape
 *     always has a value to read no matter what the driver returned. Without
 *     it, step 2 would 422 every legitimate predicate on any driver that
 *     stores only written columns.
 *  2. **What still faults is rejected** — a predicate that cannot be evaluated
 *     over a total record references something the object does not declare (an
 *     author typo, an unbound variable, a parse error). That is a broken rule,
 *     and a broken *validation* fails closed: the write is rejected with a
 *     message naming the rule and the offending key. Without step 1 this alone
 *     would be unacceptable; without step 2 a typo'd predicate returns to
 *     silently doing nothing.
 *
 * `severity` still governs blocking: an unevaluable `warning`/`info` rule is
 * logged, never thrown — advisory rules stay advisory.
 *
 * Deliberately NOT changed here: a broken `regex` (`format`), an uncompilable
 * JSON Schema (`json_schema`), the FIELD-level predicates (`requiredWhen` /
 * `readonlyWhen` / option `visibleWhen`), and the defensive `catch` around a
 * rule that THROWS all keep their existing fail-open policy — #4649 scoped
 * itself to the object-level validation predicates it was filed about, and a
 * thrown exception is an engine fault the author has no remedy for (rejecting
 * on it would brick every write with nothing to fix). Step 1 makes the
 * field-level predicates evaluate far more often anyway, since their fault mode
 * was the same missing key.
 *
 * ## `readonlyWhen`: the UNBOUND-ROOT case is fail-CLOSED (#4889)
 *
 * One carve-out was added to the paragraph above, and only one. A
 * `readonlyWhen` predicate that faults because it names a scope ROOT this
 * operation did not bind — `parent.status == 'paid'` with no master-detail
 * header in hand — is not a broken predicate; it is a supported construct the
 * evaluation site could not answer, and answering "not locked" writes a field
 * the author declared frozen. That single case now resolves to LOCKED. Every
 * OTHER `readonlyWhen` fault (undeclared key, null overload, parse error) keeps
 * the fail-open policy this section describes, and `requiredWhen` / option
 * `visibleWhen` are untouched. See {@link isReadonlyWhenLocked}.
 *
 * This is a NARROWING of ADR-0058 D5's "non-security predicate ⇒ fail soft"
 * line, recorded as an addendum on that ADR alongside the same narrowing #4649
 * and #4775 made at the two neighbouring write gates. Do not widen it back on
 * the grounds that it reads inconsistent with D5's table — the table is what
 * was amended, and ADR-0057 D10 (server enforces, client is courtesy) is why.
 *
 * ## `requiredWhen`: the SCOPE is bound, the SEMANTICS are not changed (#4977)
 *
 * `requiredWhen` sits on the same field as `readonlyWhen`, is evaluated by this
 * same module, and had the same hole one slot over: nothing bound `parent`, so
 * ``requiredWhen: P`parent.status == 'sent'` `` — "once the header is Sent every
 * line must carry a description" — evaluated in the inline grid and was a no-op
 * on the server. The write was accepted with the field empty.
 *
 * Note this is the MIRROR of #4889's failure mode, not the same one: a
 * `readonlyWhen` failing open WROTE a field that should have been frozen; a
 * `requiredWhen` failing open ACCEPTS a record that should have been rejected.
 * Both are `declared ≠ enforced` (PD #10) on one declaration site.
 *
 * The maintainer's ruling (2026-08-06) is deliberately narrower than #4889's:
 *
 *  - **Bind the scope.** The engine resolves the master-detail header with the
 *    same `resolveMasterDetailParent(s)` helpers #4889 added and passes it as
 *    {@link EvaluateRulesOptions.parent}; the requirement is now enforced where
 *    it is documented to be enforced, on insert, single-id update and bulk.
 *  - **Do NOT copy the fail-CLOSED carve-out.** An unevaluable predicate — an
 *    unresolvable header included — stays fail-OPEN: logged, skipped, the write
 *    proceeds. Rejecting it (a 422 on a write whose header is merely unreadable
 *    at that moment) is a louder failure than the `readonlyWhen` case, where the
 *    cost of the conservative answer is one refused field. That is option B of
 *    #4977 and it was explicitly NOT taken; it is reserved for the next review
 *    of ADR-0058 D5.
 *  - **Catch it at BUILD time instead.** `@objectstack/lint`'s
 *    `validate-expressions` rejects a `parent`-scoped `requiredWhen` on an object
 *    that declares no single `master_detail`, so the unbindable declaration —
 *    the one a runtime fail-open would silently swallow forever — never ships.
 *
 * Bound for the FIELD predicate only. The object-level `script` / `cross_field`
 * rules evaluated further down this same function do NOT get the root: they are
 * fail-CLOSED since #4649, so binding a new root there would flip writes they
 * reject today into accepted ones. Pinned by test.
 *
 * One consequence worth knowing before writing a predicate: because a declared
 * field is now always present, `has(record.<declared field>)` is uniformly TRUE
 * (a materialised `null` is a present key holding null — this is CEL's rule,
 * and it is what the insert path has always done). `has()` therefore guards
 * against an UNDECLARED key, not against an empty value; test emptiness with
 * `record.x == null`. Pinned by test so the app-side `has(...)` idiom cannot be
 * broken silently from under it.
 *
 * ## `readonlyWhen` sees a TOTAL record too (#4953)
 *
 * The paragraph above ("Deliberately NOT changed here") is about the fail-open
 * POLICY, and that policy is still what the field-level predicates use. What
 * changed in #4953 is the other half — what the predicate is evaluated
 * AGAINST. `materializeDeclaredFields` was wired into two seams and not the
 * third: the strip functions on the write path merged `{ ...previous, ...data }`
 * and evaluated it raw, so a `readonlyWhen` faulted (and, failing open, WROTE
 * the field it was declared to freeze) on exactly the rows whose driver did not
 * echo back the column its predicate reads — while `requiredWhen`, on the same
 * field, in this same file, read a total record and worked. The maintainer's
 * ruling (2026-08-06) unifies the SERVER seams: totality is a platform
 * guarantee wherever the server evaluates, and the cross-process bindings
 * (objectui action `visible`/`disabled`) stay sparse and are documented as
 * such. See {@link readonlyWhenBindings} for the exact bindings, the
 * ground-truth rule they obey, and the verdicts that move in BOTH directions.
 *
 * ## Prior-record plumbing
 *
 * `state_machine` and the field-spanning predicates are meaningful only with
 * the record's prior state. The engine fetches it once (see
 * `engine.update`) and threads it in via `opts.previous`. On `insert` there
 * is no prior state, so `state_machine`'s TRANSITION check is a no-op — but its
 * `initialStates` entry-point check (#3165) does run against the created value.
 * On a
 * multi-row update the engine reads the row-scoped match set (the same AST the
 * write binds, shared with the `readonlyWhen` bulk strip) and calls the
 * evaluator once per matched row — one payload, N priors (#3106).
 */

import { ExpressionEngine, collectCelRootIdentifiers } from '@objectstack/formula';
import type { Expression } from '@objectstack/spec';
import { AUDIT_PROVENANCE_FIELDS, RUNTIME_OWNED_FIELD_TYPES } from '@objectstack/spec/data';
import Ajv, { type ValidateFunction } from 'ajv';
// #5029 — `format` is NOT built into ajv 8; it ships in this separate package.
// See the `const ajv` note below for why the runtime registers it.
import addFormats from 'ajv-formats';
import {
  ValidationError,
  buildFieldError,
  resolveFieldLabel,
  type FieldValidationError,
  type ValidationMessageContext,
} from './record-validator.js';
// Shared with the declarative hook-condition gate (#4770) so the two surfaces
// that evaluate CEL against "the record" cannot drift apart on what that record
// contains — see the module's own doc comment.
import { materializeDeclaredFields } from '../declared-fields.js';
import { describeCelFault, unknownVariableOf } from '../cel-fault.js';

type Mode = 'insert' | 'update';

interface BaseRule {
  type: string;
  name: string;
  message: string;
  active?: boolean;
  events?: Array<'insert' | 'update'>;
  priority?: number;
  severity?: 'error' | 'warning' | 'info';
}

interface StateMachineRule extends BaseRule {
  type: 'state_machine';
  field: string;
  transitions: Record<string, string[]>;
  /** States a record may be CREATED in (#3165). When set, an insert whose state
   *  field value is outside this list is rejected — the FSM entry point. */
  initialStates?: string[];
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
  /** Prior state overlaid with the PATCH, made TOTAL over the declared fields
   *  (#4649) — see {@link materializeDeclaredFields}. */
  merged: Record<string, unknown>;
  /** The prior record, likewise made total (a COPY — the engine's own
   *  `hookContext.previous` must not gain materialised nulls). */
  previous: Record<string, unknown> | undefined;
  mode: Mode;
  logger: EvaluateRulesOptions['logger'];
  /** Declared fields — the source of a violation's display label (#3957). */
  fields: Record<string, ConditionalFieldDef> | undefined;
  /** Locale + translation hooks for the BUILT-IN messages (#3957). */
  messages: ValidationMessageContext | undefined;
}

/**
 * Shared ajv instance. `strict: false` tolerates author-written JSON Schemas
 * that use vendor keywords; `compile` results are memoised per schema object
 * (see `jsonSchemaCache`) so we don't recompile on every write.
 *
 * ## Why `addFormats` (#5029)
 *
 * In ajv 8 the `format` keyword is **not built in** — it lives in the separate
 * `ajv-formats` package. Without it, and under `strict: false`, an unknown
 * format is not an error: ajv logs one line at compile time and **ignores the
 * keyword**. So a rule declaring
 * `{ email: { type: 'string', format: 'email' } }` compiled fine, ran on every
 * write, enforced `type` and `required` — and enforced *nothing* for `format`,
 * for every record, forever. The failure was PARTIAL, which is what made it
 * nastier than an uncompilable schema (#4762): the rule visibly rejects bad
 * `type` / `required` payloads in dev, so it reads as working while the
 * `format` half never fires. Same #4649 family, one level in: declared ≠
 * enforced with only a stderr line — naming no rule and no object — as signal.
 *
 * Registering the plugin makes the declaration true. The **default (full)**
 * format set is used deliberately: `fast` mode trades correctness for speed on
 * exactly the formats authors reach for most (`email`, `uri`, `date-time`), and
 * a format that "mostly" matches is the same declared ≠ enforced defect with a
 * smaller hole. Cost of doing this at all: it is a behaviour change on deployed
 * data — records that passed while `format` was inert can now be rejected at
 * write time. That is the point, and the changeset says so loudly.
 *
 * `format` remains *tolerant of a typo* by construction: under `strict: false`
 * an unrecognised format name (`'emial'`) is still logged-and-ignored rather
 * than rejected. Registering the standard set does not change that, and this
 * PR deliberately does not either — flipping it is an authoring-time question
 * for the publish gate, filed separately.
 *
 * The #4762 publish gate (`@objectstack/lint`'s
 * `validate-rule-compilability.ts`) compiles with the SAME ajv environment on
 * purpose, so it registers the same plugin; its parity test reads this file's
 * source and goes red if these two lines drift apart.
 */
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
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
  /**
   * [#4977] The master-detail header this write's field `requiredWhen`
   * predicates read as `parent` — the SAME binding, resolved by the SAME engine
   * helpers, that #4889 gave `readonlyWhen`. Only the engine owns a driver, so
   * it resolves the header and hands it over; `undefined` leaves `parent`
   * unbound, which is what a non-detail object (or a payload whose predicates
   * never name `parent`) passes.
   *
   * Scoped to the field-level `requiredWhen` block on purpose. It is NOT bound
   * for the object-level `script` / `cross_field` / `conditional` rules that
   * share this call: those have been fail-CLOSED since #4649, so introducing a
   * root there would flip writes those rules reject today into accepted ones —
   * the blast radius #4977's issue body called out and the reason the change was
   * kept out of #4972. Pinned by test.
   */
  parent?: ParentBinding;
  /**
   * [#4977] The header the record hung off BEFORE this write, for the ADR-0113
   * non-regression pre-check only ("did the stored state already violate?").
   *
   * It differs from {@link parent} in exactly one situation: a write that
   * REPOINTS the detail at another master. `parent` is payload-FK-first (the
   * master the write lands on, #4889's rule) and decides the merged verdict;
   * the pre-check asks a question about the STORED row, which hung off the
   * stored FK's master. Binding the landing header there would read a repoint
   * onto a header that turns the requirement ON as a pre-existing violation and
   * let it rest — the acceptance hole this issue exists to close, one case in.
   *
   * Defaults to {@link parent} when omitted: with no repoint the two headers are
   * the same row, and the engine does not pay a second read to prove it.
   */
  previousParent?: ParentBinding;
  /**
   * When true, `state_machine` rules are skipped entirely — both the
   * `initialStates` entry-point check on insert (#3165) and the transition
   * check on update. Set by the engine for CURATED SEED writes
   * (`ExecutionContext.seedReplay`, #3433): a seed is a snapshot of established
   * facts, not a record flowing through its lifecycle, so FSM entry/transition
   * guards do not apply to it. ONLY `state_machine` is skipped; every other
   * rule type still runs (a seed must still satisfy `format`, `cross_field`,
   * `script`, `json_schema`, `conditional`).
   */
  skipStateMachine?: boolean;
  /**
   * Locale + translation hooks for this evaluator's BUILT-IN messages (#3957) —
   * the `requiredWhen` required-check, per-option gating, and the state-machine
   * fallbacks. An author-written `rule.message` is never touched: it is already
   * in whatever language its author chose.
   */
  messages?: ValidationMessageContext;
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
 * The master-detail header a `parent`-scoped predicate reads (#4889). `null`
 * means "this operation could not resolve one" — which is NOT the same as
 * "there is none to read": see {@link isReadonlyWhenLocked} for why the two
 * resolve to opposite verdicts.
 */
export type ParentBinding = Record<string, unknown> | null | undefined;

/**
 * The two CEL roots a field `readonlyWhen` predicate reads — `record` (the
 * prior row overlaid with the PATCH) and `previous` — made TOTAL over the
 * object's DECLARED fields (#4953).
 *
 * ## Why this seam had to join the other two
 *
 * `materializeDeclaredFields` existed since #1871/#4649 and was wired into
 * exactly two evaluation seams: {@link evaluateValidationRules} (object rules,
 * field `requiredWhen`, option `visibleWhen`) and the declarative hook
 * `condition`s in `hook-wrappers.ts`. `readonlyWhen` — declared on the SAME
 * field as `requiredWhen`, evaluated by THIS module, one function away — merged
 * `{ ...previous, ...data }` and evaluated it raw. So one field's two
 * predicates disagreed about what "the record" contains: ``requiredWhen:
 * P`record.b != null` `` was a working guard while ``readonlyWhen:
 * P`record.b != null` `` on the same field faulted whenever the driver did not
 * return `b` — and a faulting `readonlyWhen` is fail-OPEN, so the field the
 * author declared frozen was written. Whether it was written depended on which
 * columns a driver happened to echo back, which is not something an author can
 * see or control (#4953; maintainer ruling 2026-08-06: the SERVER seams are
 * unified, the cross-process ones are deferred).
 *
 * The `parent` root is deliberately NOT materialised here. #4889 owns that
 * binding's semantics — an ABSENT `parent` is the signal that makes the
 * unbound-root branch of {@link isReadonlyWhenLocked} reachable, and the header
 * is a row of a DIFFERENT object whose declared fields this function does not
 * have.
 *
 * [#6457] That last clause is why the header IS materialised — just not here.
 * A RESOLVED-but-sparse header reproduced this same trap one root over (the
 * fault is `No such key`, not `Unknown variable`, because `parent` IS bound ⇒
 * ordinary fail-OPEN ⇒ the declared lock is let through), and the fix went to
 * the only place holding both the master's schema and the just-read header:
 * `ObjectQL.resolveMasterDetailParent(s)` (`engine.ts#materializeParentHeader`),
 * which serves this seam and the `requiredWhen` one below from one resolution.
 * This function's own contract is unchanged — hand it a sparse header and it
 * still fails open — and the ABSENT-parent signal above is untouched, because
 * materialisation is only ever applied to a header row that EXISTS.
 *
 * ## Consequences, both directions (measured, not asserted)
 *
 * A total record makes a predicate that used to fault evaluate for real, so
 * verdicts move — the point of the change, and in both directions:
 *
 *  - ``record.b == null`` / ``record.b != null`` / ``previous.b == null`` on a
 *    row the driver returned without `b`: fault → fail-open → the change was
 *    WRITTEN. Now they evaluate, and a TRUE predicate strips the change. This
 *    is enforcement being restored, and it is the direction the ruling asked
 *    for.
 *  - ``has(record.b)`` becomes uniformly TRUE and ``!has(record.b)`` uniformly
 *    FALSE for a DECLARED field, because a materialised `null` is a present key
 *    holding null (CEL's own rule). A ``readonlyWhen: !has(record.b)`` that
 *    used to lock the field therefore stops locking it. That is the same
 *    consequence #4649 documented for the validation seam and
 *    `declared-fields.ts` states as the contract — `has()` guards against an
 *    UNDECLARED key, not against an empty value; test emptiness with
 *    `!= null`. Pinned by test in both spellings so this is a recorded
 *    consequence rather than a discovery.
 *
 * Ordering comparisons still fault over a total record (`null < null` is `no
 * such overload`), so the fail-open branch is not dead — the very reason
 * `@objectstack/lint`'s null-guard gate exists.
 *
 * ## Only materialise when the persisted state is IN HAND
 *
 * Same rule {@link evaluateValidationRules} applies with its `groundTruth`
 * flag, and the reason `declared-fields.ts` states: defaulting a declared field
 * to `null` when the prior row was NOT read does not materialise an absent
 * value, it FABRICATES one that contradicts the stored row. `previous` absent
 * (never fetched, or a single-id update whose row is gone) therefore leaves
 * both bindings exactly as they were. The engine reads the prior row whenever
 * the object declares a `readonlyWhen` field ({@link needsPriorRecord} →
 * `fieldsNeedPrior`), so the materialised branch is the normal one. INSERT is
 * exempt from the strip entirely (`engine.ts`), so unlike the validation seam
 * there is no insert case to answer here.
 */
function readonlyWhenBindings(
  data: Record<string, unknown>,
  prior: Record<string, unknown> | undefined | null,
  fields: Record<string, ConditionalFieldDef>,
): { merged: Record<string, unknown>; previous: Record<string, unknown> | undefined } {
  const previous = prior ?? undefined;
  const merged: Record<string, unknown> = { ...(previous ?? {}), ...data };
  if (!previous) return { merged, previous };
  return {
    merged: materializeDeclaredFields(merged, fields),
    // COPIED before materialising: the caller's object is the engine's
    // `hookContext.previous`, which after-hooks observe — it must not gain
    // materialised nulls (the same copy `evaluateValidationRules` makes).
    previous: materializeDeclaredFields({ ...previous }, fields),
  };
}

/**
 * Strip fields whose `readonlyWhen` CEL predicate is TRUE for the (merged)
 * record from an UPDATE payload — the field is locked, so an incoming change is
 * ignored (the persisted value is kept) rather than rejected. Returns the same
 * object when nothing is locked, else a shallow copy with the locked keys
 * removed.
 *
 * `parent` (#4889) is the master-detail header row, bound for a detail object
 * so a `parent.<field>` predicate — the documented "once the header invoice is
 * Paid, its lines are frozen" lock — evaluates here and not only in the client
 * grid. The engine resolves it (it owns the driver) and passes it in; pass
 * `undefined` when the object is not a detail or the payload's predicates never
 * name `parent`, and the binding is simply absent.
 *
 * A predicate that faults is fail-open (the change is allowed through) EXCEPT
 * when the fault is an unbound scope root — see {@link isReadonlyWhenLocked}.
 *
 * The `record` / `previous` bindings are TOTAL over the object's declared
 * fields (#4953) — see {@link readonlyWhenBindings}.
 */
export function stripReadonlyWhenFields(
  objectSchema: { fields?: Record<string, ConditionalFieldDef> } | undefined | null,
  data: Record<string, unknown> | undefined | null,
  previous: Record<string, unknown> | undefined | null,
  logger?: EvaluateRulesOptions['logger'],
  parent?: ParentBinding,
): Record<string, unknown> | undefined | null {
  const fields = objectSchema?.fields;
  if (!fields || !data) return data;
  const view = readonlyWhenBindings(data, previous, fields);
  let result = data;
  for (const [name, def] of Object.entries(fields)) {
    if (!def?.readonlyWhen || !(name in data)) continue;
    if (isReadonlyWhenLocked(def, view.merged, view.previous, name, logger, parent)) {
      if (result === data) result = { ...data };
      delete (result as Record<string, unknown>)[name];
      logger?.warn?.(`Field '${name}' is read-only (readonlyWhen) — ignoring incoming change`);
    }
  }
  return result;
}

/**
 * Evaluate one field's `readonlyWhen` predicate against a (merged) record.
 * TRUE ⇒ the field is locked for that record and the incoming change must be
 * dropped. Shared by the single-id ({@link stripReadonlyWhenFields}) and bulk
 * ({@link stripReadonlyWhenFieldsMulti}) strips.
 *
 * ## Two faults, two answers (#4889)
 *
 * Until #4889 every fault took one exit — WARN and `false`, "not locked" — and
 * that single answer had to serve two very different situations:
 *
 *  - **The predicate is broken on this record.** A typo'd key, a `null`
 *    ordering overload, a parse error. The author has a bug; the field is not
 *    demonstrably locked; the historical (and deliberate, documented) policy is
 *    fail-OPEN. Unchanged here — an engine fault the author cannot act on must
 *    not brick every write to the object.
 *
 *  - **The predicate names a ROOT this operation did not bind.** `parent.status
 *    == 'paid'` where no master-detail header was resolved. The expression is
 *    well-formed and spec-sanctioned; nothing about the RECORD says the field
 *    is unlocked — we simply could not ask. Waving it through inverts the
 *    guarantee: a field the author declared locked is written, the API answers
 *    200, and the client grid still draws the cell as read-only, so the UI and
 *    the database disagree with nobody told. ADR-0057 D10 puts enforcement on
 *    the server; a lock that fails open leaves enforcement in the courtesy
 *    layer. So an unbound root resolves to LOCKED — conservative toward the
 *    author's declared intent, and the direction #4649 (validation predicates)
 *    and #4775 (hook conditions) already took for their own unevaluable case.
 *
 * The two are distinguishable without guessing: cel-js says `Unknown variable:
 * <root>` for the second and `No such key` / an overload / a parse fault for
 * the first ({@link unknownVariableOf}). This is a LAST resort, not the plan —
 * `@objectstack/lint` rejects a `parent`-scoped `readonlyWhen` on an object with
 * no master-detail relation at build time, so the common authoring mistake never
 * reaches a runtime this branch has to judge.
 */
function isReadonlyWhenLocked(
  def: ConditionalFieldDef,
  merged: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  name: string,
  logger?: EvaluateRulesOptions['logger'],
  parent?: ParentBinding,
): boolean {
  const res = ExpressionEngine.evaluate<boolean>(toExpression(def.readonlyWhen!), {
    record: merged,
    previous,
    // Bound ONLY when resolved. An absent binding is what makes the unbound-root
    // fault below reachable, and that fault is the signal — binding `null` here
    // would turn it into a `No such key` and re-open the fail-open hole.
    ...(parent != null ? { extra: { parent } } : {}),
  });
  if (!res.ok) {
    const unbound = unknownVariableOf(res.error);
    if (unbound) {
      logger?.warn?.(
        `readonlyWhen for '${name}' reads '${unbound}', which is not bound for this operation — ` +
          `treating the field as LOCKED (the declared lock is not waived because it could not be evaluated). ` +
          `A 'parent'-scoped predicate needs the object to declare exactly one master_detail relationship.`,
      );
      return true;
    }
    logger?.warn?.(`readonlyWhen for '${name}' failed to evaluate — change allowed through`);
    return false;
  }
  return res.value === true;
}

/**
 * True when at least one `readonlyWhen` predicate the UPDATE payload touches
 * reads the `parent` root (#4889) — the gate the engine uses to decide whether
 * to resolve the master-detail header at all, so an object with no
 * parent-scoped lock pays nothing.
 *
 * Decided from the parsed CEL AST ({@link collectCelRootIdentifiers}), not a
 * substring scan, so a field literally named `parent_id` or a string constant
 * `'parent'` cannot be mistaken for the binding. A predicate that does not
 * parse answers `false`: it will fault at evaluation, where the fail-open /
 * fail-closed judgment already lives — this gate does not duplicate it.
 */
export function hasParentScopedReadonlyWhenInPayload(
  objectSchema: { fields?: Record<string, ConditionalFieldDef> } | undefined | null,
  data: Record<string, unknown> | undefined | null,
): boolean {
  const fields = objectSchema?.fields;
  if (!fields || !data) return false;
  for (const [name, def] of Object.entries(fields)) {
    if (!def?.readonlyWhen || !(name in data)) continue;
    if (readsParentRoot(def.readonlyWhen)) return true;
  }
  return false;
}

/**
 * True when at least one field declares a `requiredWhen` predicate that reads
 * the `parent` root (#4977) — the gate the engine uses to decide whether to
 * resolve the master-detail header for {@link evaluateValidationRules}, so an
 * object with no parent-scoped requirement pays no extra read.
 *
 * The `readonlyWhen` twin ({@link hasParentScopedReadonlyWhenInPayload}) filters
 * by the payload; this one deliberately does NOT, and the asymmetry is the point
 * rather than an oversight. `readonlyWhen` judges an incoming CHANGE, so a field
 * the payload never touches cannot be locked out of anything. `requiredWhen`
 * judges the MERGED record: the whole failure it exists to catch is a field left
 * empty — i.e. absent from the payload — while the predicate says it must be
 * filled. Filtering by `name in data` here would skip exactly the writes the
 * rule is for.
 *
 * Same AST-based root reader as its twin ({@link readsParentRoot} over
 * `collectCelRootIdentifiers`), so a field named `parent_id` or the string
 * literal `'parent'` cannot be mistaken for the binding, and build-time lint,
 * the `readonlyWhen` gate and this gate can never disagree about what "reads
 * `parent`" means.
 */
export function hasParentScopedRequiredWhen(
  objectSchema: { fields?: Record<string, ConditionalFieldDef> } | undefined | null,
): boolean {
  const fields = objectSchema?.fields;
  if (!fields) return false;
  for (const def of Object.values(fields)) {
    if (!def?.requiredWhen) continue;
    if (readsParentRoot(def.requiredWhen)) return true;
  }
  return false;
}

/** Parsed-root memo — metadata predicates are a small, fixed set of sources. */
const parentRootCache = new Map<string, boolean>();

/** Does this predicate's CEL source reference the `parent` root? */
function readsParentRoot(cond: string | Expression): boolean {
  const expr = toExpression(cond);
  if (expr.dialect !== 'cel') return false;
  const source = typeof expr.source === 'string' ? expr.source : '';
  if (!source) return false;
  const cached = parentRootCache.get(source);
  if (cached !== undefined) return cached;
  const roots = collectCelRootIdentifiers(source);
  const answer = roots.ok && roots.roots.includes(PARENT_ROOT);
  parentRootCache.set(source, answer);
  return answer;
}

/** The CEL scope root a master-detail header is bound under (`cel-engine.ts`). */
const PARENT_ROOT = 'parent';

/**
 * True when the UPDATE payload writes at least one field that declares a
 * `readonlyWhen` predicate. A cheap gate the engine uses to decide whether the
 * bulk update path must fetch its matched rows for
 * {@link stripReadonlyWhenFieldsMulti} — no `readonlyWhen` field in the payload
 * ⇒ no fetch, no cost.
 */
export function hasReadonlyWhenInPayload(
  objectSchema: { fields?: Record<string, ConditionalFieldDef> } | undefined | null,
  data: Record<string, unknown> | undefined | null,
): boolean {
  const fields = objectSchema?.fields;
  if (!fields || !data) return false;
  for (const [name, def] of Object.entries(fields)) {
    if (def?.readonlyWhen && name in data) return true;
  }
  return false;
}

/**
 * Multi-row counterpart of {@link stripReadonlyWhenFields} (#3042). A bulk
 * `updateMany` applies ONE payload to every matched row, but `readonlyWhen` is a
 * PER-ROW predicate — a single merged prior is not enough. Given the matched
 * rows' prior state (the engine reads them with the SAME row-scoped AST the
 * write binds — one query), a `readonlyWhen` field is dropped from the batch
 * when its predicate is TRUE for AT LEAST ONE matched row: a bulk write cannot
 * lock the field for some rows and write it for others, so a field locked in any
 * target row is fail-safe-dropped for all (narrow the `where` to reach the rows
 * where it is unlocked). A field NO matched row locks is written normally — a
 * legitimate bulk edit of an unlocked conditional field is unaffected. A broken
 * predicate is fail-open for that row. INSERT is exempt (update path only),
 * symmetric with the single-id strip.
 *
 * `parentForRow` (#4889) supplies each matched row's master-detail header, since
 * N rows can hang off N different masters — the bulk counterpart of the
 * single-id `parent` binding. The engine batch-reads the headers once and hands
 * over a lookup; `undefined` (or a resolver returning nothing) leaves the
 * binding absent for that row, which {@link isReadonlyWhenLocked} reads as
 * LOCKED for a predicate that needs it.
 *
 * Each matched row's `record` / `previous` bindings are made TOTAL over the
 * declared fields (#4953, {@link readonlyWhenBindings}) exactly as on the
 * single-id path — a bulk write must not judge the same predicate by a
 * different record shape than a one-row write does. The views are built ONCE
 * per row (they do not depend on which field is being judged) and only when a
 * `readonlyWhen` field is actually in the payload, so a batch that touches none
 * still pays nothing.
 *
 * Returns the same object when nothing is stripped, else a shallow copy with the
 * locked keys removed.
 */
export function stripReadonlyWhenFieldsMulti(
  objectSchema: { fields?: Record<string, ConditionalFieldDef> } | undefined | null,
  data: Record<string, unknown> | undefined | null,
  priorRows: ReadonlyArray<Record<string, unknown>> | undefined | null,
  logger?: EvaluateRulesOptions['logger'],
  parentForRow?: (row: Record<string, unknown> | undefined) => ParentBinding,
): Record<string, unknown> | undefined | null {
  const fields = objectSchema?.fields;
  if (!fields || !data) return data;
  const rows = priorRows ?? [];
  // Built lazily: a payload writing no `readonlyWhen` field never reaches the
  // `.some()` below, and then no row view is materialised at all.
  let views: Array<ReturnType<typeof readonlyWhenBindings>> | null = null;
  const rowViews = () => (views ??= rows.map((row) => readonlyWhenBindings(data, row, fields)));
  let result = data;
  for (const [name, def] of Object.entries(fields)) {
    if (!def?.readonlyWhen || !(name in data)) continue;
    const lockedInSomeRow = rowViews().some((view, i) =>
      isReadonlyWhenLocked(
        def,
        view.merged,
        view.previous,
        name,
        logger,
        // Resolved per (field, row) exactly as before — the header lookup is
        // the caller's, and its call pattern is not this change's business.
        parentForRow?.(rows[i] ?? undefined),
      ),
    );
    if (lockedInSomeRow) {
      if (result === data) result = { ...data };
      delete (result as Record<string, unknown>)[name];
      logger?.warn?.(
        `Field '${name}' is read-only (readonlyWhen) in ≥1 matched row — ignoring incoming change on bulk update`,
      );
    }
  }
  return result;
}

/**
 * Field types whose VALUE the runtime owns end to end, whether or not the
 * author ever wrote `readonly: true` on them (#5503).
 *
 * Exactly one member today: `autonumber`. The engine has always documented the
 * ownership (`applyAutonumbers`: "the runtime owns the value, not the client")
 * and both record validators act on it — a `required` autonumber is exempt from
 * the missing-value check on insert AND update precisely because the client is
 * not supposed to supply it. What was missing was the other half: nothing on
 * the write path stopped a client from supplying it anyway, so a plain REST
 * caller could POST a record number of their choosing (bypassing the sequence)
 * and PATCH an existing one (forging a business identifier). Declaring the
 * ownership here makes it enforced rather than merely asserted — the same
 * `declared ≠ enforced` correction as #4447 (`created_at`), one type over.
 *
 * Deliberately NOT `formula`: a formula field IS computed on read from a plan
 * (`applyFormulaPlan`) and never stored from the write payload, so there is no
 * caller value to strip in the first place.
 *
 * Deliberately NOT `summary` either — but for a COMPLETELY DIFFERENT reason,
 * and conflating the two is what this note exists to prevent (#6014). A roll-up
 * `summary` is NOT computed on read: it is a real stored column the runtime
 * maintains. `ObjectQL.recomputeSummaries` writes it with an ordinary
 * `update(parent, { [summaryField]: value })` after any child write, and since
 * #5749 / PR #6013 `initializeSummaryFields` also seeds it at parent INSERT.
 * Reads hit that stored column directly — which is exactly why
 * `["task_count","=",0]` is an in-database comparison, and why a never-seeded
 * `null` silently dropped rows from it (#5749). So `summary` satisfies BOTH
 * clauses a naive membership rule would use — persisted AND runtime-issued —
 * and is STILL excluded. Persistence and runtime ownership do not decide it.
 *
 * What decides it is the third clause: a runtime-owned type must have NO
 * legitimate caller-supplied value. `autonumber` qualifies — a client-chosen
 * record number bypasses the sequence and forges a business identifier nothing
 * later corrects. `summary` does not qualify: the value is a derived cache of
 * the child aggregate, self-healing on the next child write, and supplying an
 * initial value is a SUPPORTED authoring path — `initializeSummaryFields`
 * deliberately keeps a caller-supplied one ("author supplied a value"), so
 * historical imports and seed data may carry pre-computed totals.
 *
 * DO NOT "fix the code to match this comment" by adding `summary` here. The
 * insert-side strip ({@link stripRuntimeOwnedFields}) judges against the RAW
 * caller payload (its keys AND their values, #6339) and runs in
 * `engine.insert` AFTER the seed pass, so a plain
 * (non-`isSystem`, non-`preserveAudit`) import of a parent carrying
 * `task_count: 42` would lose the 42 to the strip and get no 0 from the seed
 * either — the seed already skipped that field precisely BECAUSE the caller
 * supplied it. The column lands `null`, the exact state #6013 was written to
 * eliminate, and the write still reports success. Only `isSystem: true` (whole
 * pass skipped) or `preserveAudit: true` (kept by {@link isPreservableUnderAudit},
 * since a summary field is not `system: true`) would survive it.
 *
 * Keep this set to types whose value is (a) persisted, (b) issued by the
 * runtime, and (c) never legitimately supplied by a caller.
 *
 * The set itself now lives in `@objectstack/spec` (`RUNTIME_OWNED_FIELD_TYPES`,
 * #5628) — the protocol's one statement of the ownership — because a SECOND
 * consumer needs it: the DataProtocol create ingress, whose `readonly` strip
 * carries a NARROWER exemption set than this module's (no `preserveAudit`), and
 * which therefore has to recognise these types to stay out of their way. A
 * literal copied over there is the drift `AUDIT_TIMELINE_FIELDS` below stopped
 * paying for. This module keeps the reasoning; the membership is imported.
 */

/**
 * Whether the runtime owns this field's value outright — i.e. the field is
 * IMPLICITLY read-only on the write path even with no `readonly: true` flag.
 * See {@link RUNTIME_OWNED_FIELD_TYPES}. #5503.
 */
export function isRuntimeOwnedField(def: { type?: string } | undefined | null): boolean {
  return def?.type != null && RUNTIME_OWNED_FIELD_TYPES.has(String(def.type));
}

/**
 * Strip CALLER-SUPPLIED writes to read-only fields from an UPDATE payload
 * (#2948). Unlike `readonlyWhen` (conditional, handled above), a
 * static `readonly` field was never enforced on the server write path: the
 * record validator only SKIPS it from validation, so a user-context update
 * could overwrite audit stamps, provenance, or any other read-only column. We
 * STRIP the change (symmetric with `readonlyWhen`) rather than reject it, for
 * compatibility.
 *
 * "Read-only" here has TWO sources, at equal rank (#5503):
 *  - the AUTHOR-declared `readonly: true` flag; and
 *  - an IMPLICITLY read-only, RUNTIME-OWNED field type
 *    ({@link isRuntimeOwnedField}) — today exactly `autonumber`, whose value the
 *    engine or the driver's persistent sequence issues. Before #5503 only the
 *    first source was read here, so a plain PATCH could rewrite any record
 *    number: the same defect as #4447 (`created_at` forgeable by a normal
 *    PATCH), except the field carried no flag for this loop to notice.
 *
 * Three guards keep every legitimate write intact:
 *  - `supplied` KEY presence — only keys the CALLER sent are candidates. Server
 *    stamps applied by beforeUpdate hooks or write middleware (e.g. `updated_by`
 *    / `updated_at`, plugin.ts) land in `data` but are absent from `supplied`,
 *    so they survive. A caller that *explicitly* forges e.g. `updated_by` simply
 *    has it dropped for that request (the last-modified stamp is left unchanged
 *    — safe).
 *  - `supplied` VALUE identity (#5591) — the key must still hold THE CALLER'S
 *    OWN VALUE. This is the half that used to be missing, and its absence is
 *    what made the guard above conditional on an accident. See below.
 *  - system context — the caller passes this strip only for NON-system writes;
 *    system-context writes (import, seed replay, approvals, lifecycle hooks —
 *    all `isSystem: true`) legitimately set read-only columns and skip it.
 *
 * ### Why `supplied` carries VALUES, not just keys (#5591)
 *
 * This strip runs AFTER `beforeUpdate`, so by the time it looks at a key, the
 * value sitting there may no longer be the caller's — a hook may have written
 * its own. The guard used to be a key SET, which cannot tell those apart, so
 * `delete data[name]` deleted whatever was there: on a payload that merely
 * ECHOED a read-only key back, the hook's write died with it.
 *
 * Measured downstream (objectstack#5591, from hotcrm#788): a REST caller reads a
 * whole `crm_knowledge_article`, flips `status` to `published`, and PUTs the
 * whole record back — `published_at: null` included, because that is what it
 * read. The publish hook stamps `published_at` on the draft→published
 * transition; the strip then deleted the hook's timestamp because the caller had
 * echoed the key. The row committed as `status = "published"` with
 * `published_at = null`, which every list and report ordering by `published_at`
 * is undefined on. The same hook's `last_reviewed_at` — a read-only field the
 * caller had NOT echoed — landed normally in the same write. Two hook-derived
 * writes, one alive and one dead, decided by nothing but whether the caller's
 * payload happened to carry a same-named key.
 *
 * So the rule is: **strip the value the CALLER SUBMITTED, never the value that
 * happens to be there when the strip runs.** A key whose value a hook has
 * replaced is a PLATFORM write, and platform writes to read-only columns are
 * legitimate by construction — that is the same contract #4903 pins from the
 * other side (a read-only key a hook ADDS lands, because it is not caller
 * supplied). #5591 only makes the two agree.
 *
 * This does NOT relax #2948 / #3003 / #3015 in any direction: a caller-supplied
 * read-only value that no hook touched is still dropped, byte for byte the same
 * verdict as before. What changed is exclusively the case where a hook already
 * overwrote the key — where the value being deleted was never the caller's.
 *
 * KNOWN LIMIT, deliberately not papered over: the snapshot is SHALLOW, so a hook
 * that mutates a caller-supplied object or array IN PLACE
 * (`data.some_json.x = 1`) is indistinguishable from a hook that did nothing —
 * identity is unchanged — and the field is still stripped. No comparison can see
 * that without deep-cloning every write payload, which this path will not pay
 * for. The fallback is the pre-#5591 behaviour (strip), i.e. fail-safe; a hook
 * that means to write a read-only column should ASSIGN a value to it.
 *
 * `options.preserveAudit` (#3493) relaxes the strip for an opt-in "historical"
 * import that reinstates the original timeline: a caller-supplied read-only
 * field is KEPT when {@link isPreservableUnderAudit} allows it — the
 * audit/timestamp family or any author-declared business field (including a
 * runtime-owned `autonumber`, so a migration may reinstate the legacy record
 * numbers it is carrying over — #5503).
 * Platform-managed `system` columns outside that family (`organization_id` /
 * tenancy, generated columns) stay stripped, so the relaxation reinstates facts
 * without becoming a tenancy-forging backdoor. It is a WHITELIST, deliberately
 * narrower than the blanket `isSystem` exemption above.
 *
 * Returns the same object when nothing is stripped, else a shallow copy with the
 * offending keys removed.
 *
 * ### What the strip LOGS, and why it stays at `warn` (#4903)
 *
 * A dropped field is the #4632 second-class shape: the caller is told the write
 * succeeded, the database disagrees about one column, and the server log is the
 * only trace. So the message must carry the CONSEQUENCE (committed without the
 * field) and the REMEDY, not just the fact — a bare "ignoring incoming change"
 * is what made os-project-titanwind-ehr#750 read as "only cron can't write".
 *
 * It stays at `warn`, one level for every caller, because THIS SEAM CANNOT TELL
 * THE TWO CALLERS APART. The strip runs on `!context.isSystem`, and
 * `ExecutionContext` carries no origin / channel / transport marker — `isSystem`
 * is the only trust bit, and it is precisely the exemption. A hostile REST body
 * forging `created_by` and a trusted cron plugin writing a computed column
 * arrive here indistinguishable (an absent context is not proof of server code
 * either: a plugin may legitimately act as a user, and an unauthenticated REST
 * write also has no principal). Escalating to `error` would therefore let any
 * client fill the error log on demand; demoting to `debug` would re-hide the
 * silent-drop. `warn` + a message that names both remedies is the honest single
 * level. Changing this means giving `ExecutionContext` a real origin marker
 * first — not guessing from the absence of a principal.
 *
 * [#8214] The level did not move; two of the message's CLAIMS did. Under
 * `options.strictReadonlyWrites` the write is refused outright, so the line no
 * longer says the update was committed without the field, and the
 * `preserveAudit` remedy is now offered per-field, derived from
 * {@link isPreservableUnderAudit} rather than described in prose. Both are
 * argued on {@link StripWarningOptions}; both keep the line naming the field,
 * the consequence, and a remedy that is TRUE for the case that printed.
 *
 * ### ...and the one key it does NOT log: the write's ADDRESS (#8141)
 *
 * `options.addressKey` names the key that carries the ADDRESS of the row this
 * call is already writing — the caller passes it only when it has established
 * that fact, and only the by-id update branch can (`idAddressesThisRow` in
 * `engine.ts`, #8093: the payload `id` equals the bound row's key). That key is
 * still STRIPPED, byte for byte as before; what it no longer does is log.
 *
 * The three claims the message makes are all false for that key, and #8093
 * measured them: on `PATCH /data/sys_user_preference/rec_1` with the body
 * `{"value":[…]}` — no `id` key in it at all — the REST ingress folds the path
 * id into the payload (`metadata-protocol`'s `updateData`, #6479, so a body
 * `id` cannot bind a row other than the one the URL, the OCC check and the
 * receipt all name), the fold lands before the `suppliedValues` snapshot, and
 * this strip then logged that a caller-supplied `id` was DROPPED and the update
 * COMMITTED WITHOUT IT. The caller supplied nothing, lost nothing, and the
 * update carried out everything it asked for. Worse, the message's remedy told
 * that caller to pass `{ context: { isSystem: true } }` — which would exempt it
 * from this strip ENTIRELY, a strictly worse posture adopted to silence a line
 * that should never have printed.
 *
 * Why this is a fix and not a mute: it fires on every single-record `PATCH` of
 * every object declaring `id` as `readonly: true`, i.e. every platform object
 * (the console's recents trace alone emits one per org switch), and the level
 * argument directly above is that `warn` is worth keeping so REAL forgery
 * attempts stay visible. A per-call flood of a line that cannot be acted on is
 * what trains a reader to skip the channel — the log-side twin of the amber
 * toast #8093 stopped, and of #3431 / #3794 one field over.
 *
 * Deliberately scoped to the LOG and to ONE key:
 *  - any other read-only key in the same payload still logs, unchanged in
 *    wording and level — a caller that forged `created_by` alongside the
 *    address is still named;
 *  - an `id` that does NOT equal the bound row is not an address, so the caller
 *    never passes it here and it still logs;
 *  - the multi branch and the insert-side sibling pass no `addressKey` at all
 *    (nothing addresses a row by key there), so their behaviour is identical to
 *    before this option existed;
 *  - and the payload handed to the driver is unchanged everywhere. Removing the
 *    address BEFORE the read-only pass would change what drivers receive for
 *    objects whose `id` is not readonly, which #6435 ruled an explicitly
 *    separate decision.
 */
export function stripReadonlyFields(
  objectSchema: { name?: string; fields?: Record<string, ConditionalFieldDef> } | undefined | null,
  data: Record<string, unknown> | undefined | null,
  supplied: Readonly<Record<string, unknown>>,
  logger?: EvaluateRulesOptions['logger'],
  options?: { preserveAudit?: boolean; addressKey?: string; strictReadonlyWrites?: boolean },
): Record<string, unknown> | undefined | null {
  const fields = objectSchema?.fields;
  if (!fields || !data) return data;
  const preserveAudit = options?.preserveAudit === true;
  const addressKey = options?.addressKey;
  const strict = options?.strictReadonlyWrites === true;
  let result = data;
  for (const [name, def] of Object.entries(fields)) {
    // [#5503] `readonly: true` is the AUTHOR-declared lock; a runtime-owned
    // type (`autonumber`) is the IMPLICIT one. Both mean the same thing to a
    // caller: you do not get to write this column.
    const runtimeOwned = isRuntimeOwnedField(def);
    if (!def?.readonly && !runtimeOwned) continue;
    if (!(name in (result as Record<string, unknown>))) continue;
    // Own-property, never `in`: a field name is `^[a-z_][a-z0-9_]*$`, which
    // admits `constructor` / `valueOf` — inherited from `Object.prototype` on
    // any plain snapshot, so `in` would call a hook stamp caller-supplied and
    // strip it.
    if (!Object.prototype.hasOwnProperty.call(supplied, name)) continue; // server-stamped, not caller-supplied — keep
    // [#5591] ...and it must still BE the caller's value. A hook that
    // overwrote this key wrote a PLATFORM value; deleting that is what put
    // `status = published` rows in the database with `published_at = null`.
    // `Object.is`, not `===`, on purpose: `===` reports NaN !== NaN, which
    // would read a caller-forged NaN as "a hook rewrote it" and KEEP the
    // forgery — the one input where the loose operator inverts the verdict.
    if (!Object.is((result as Record<string, unknown>)[name], supplied[name])) continue;
    if (preserveAudit && isPreservableUnderAudit(name, def)) continue; // historical import reinstates it
    if (result === data) result = { ...data };
    delete (result as Record<string, unknown>)[name];
    // [#8141] STRIPPED, then not logged: this key is the write's address, and
    // every claim the message makes about it is false — the caller did not
    // supply it, lost nothing, and the update committed everything it asked
    // for. Placed AFTER the delete, never as an early `continue` above it: the
    // strip must stay (a same-value primary-key write is a no-op on SQL but a
    // rejection on stores with immutable primary keys, #6435), and only the
    // caller can know a key is an address — this helper never guesses one.
    if (addressKey !== undefined && name === addressKey) continue;
    // [#8214] Both facts the message is allowed to state, computed HERE from
    // what this pass actually knows. `preserveAuditApplies` is the same
    // predicate the `continue` above consults — and reaching this line proves
    // the flag was OFF (a preservable field under `preserveAudit` never gets
    // here), so offering it is a remedy that would really have worked.
    const warnOptions: StripWarningOptions = {
      strict,
      preserveAuditApplies: isPreservableUnderAudit(name, def),
    };
    logger?.warn?.(
      def?.readonly
        ? readonlyStripWarning(name, objectSchema?.name, warnOptions)
        : runtimeOwnedStripWarning(name, String(def?.type), objectSchema?.name, warnOptions),
    );
  }
  return result;
}

/**
 * Strip CALLER-SUPPLIED writes to RUNTIME-OWNED fields ({@link
 * isRuntimeOwnedField}) only — the INSERT-side counterpart of
 * {@link stripReadonlyFields} (#5503).
 *
 * Why a separate, narrower function rather than reusing the one above: INSERT is
 * deliberately exempt from the author-declared static-`readonly` strip inside
 * the engine (#3413). A create may legitimately seed read-only columns, and the
 * trusted internal writers (identity provisioning, the metadata repository, the
 * event-log cursor) call `engine.insert` DIRECTLY — which is why that strip
 * lives at the DataProtocol ingress instead (`stripReadonlyForInsert`, #3043).
 * Runtime-owned fields carry none of that ambiguity: nobody may seed a record
 * number on create, because the engine (or the driver's persistent sequence)
 * issues it. So this one CAN live in the engine, and living there is the point —
 * it runs before the payload is dispatched, which covers the SQL driver's
 * `supports.autonumber` path without the driver participating at all.
 *
 * Same guards as the update strip, and — since #6339 — the same THREE of them:
 * the CALLER must have sent the key, the key must still hold THE CALLER'S OWN
 * VALUE, and the `preserveAudit` whitelist is honoured so a historical import
 * may reinstate the legacy record numbers it is migrating. `isSystem` writes
 * never reach here — the caller gates on that, exactly as it does for the
 * update strip.
 *
 * ### Why `supplied` carries VALUES, not just keys (#6339)
 *
 * The insert-side twin of #5591, found while measuring it, and wrong for the
 * identical reason. This strip runs AFTER `beforeInsert` (`engine.insert` calls
 * it on the post-hook rows), so "the caller named this key" and "this key still
 * holds the caller's value" are different facts, and only the second licenses a
 * `delete`. With a key SET the delete took whatever value was standing there —
 * so a `beforeInsert` hook that re-issues or normalizes a record number lost its
 * write to any caller that had ALSO submitted that key, and the record fell back
 * to the sequence value.
 *
 * Measured (objectstack#6339, real ObjectQL + in-memory driver, one object
 * `{ title: text, code: autonumber }` and one hook writing `ctx.input.data.code`):
 *
 * - caller omits `code`  ⇒ committed `code` = the hook's value  (hook write lives)
 * - caller sends `code`  ⇒ committed `code` = `"1"`             (hook write dies)
 *
 * The two differ in nothing but whether the caller's payload happened to carry a
 * same-named key — and the first outcome is the one {@link
 * runtimeOwnedStripWarning} promises IN PROSE to every hook author: "A
 * beforeInsert/beforeUpdate hook does NOT need either — hook-written keys are
 * not caller-supplied." The key-set judgement made that sentence true only by
 * accident, so this is the code being brought to its own documented contract.
 *
 * NOT a relaxation of #5503: a caller-seeded record number that no hook rewrote
 * is still dropped, still warns with the same text, and still reports through
 * `onFieldsDropped` / `strictReadonlyWrites`. What changed is exclusively the
 * case where the value being deleted was never the caller's.
 *
 * KNOWN LIMIT, identical to the update side's and deliberately not papered over:
 * the snapshot is SHALLOW, so a hook that mutates a caller-supplied object IN
 * PLACE is indistinguishable from a hook that did nothing, and the field is
 * still stripped. That fallback is the pre-#6339 behaviour, i.e. fail-safe; a
 * hook meaning to own a runtime-owned column should ASSIGN to it. (An
 * `autonumber` value is a scalar in every supported shape, so this limit is
 * theoretical here in a way it is not for the update path's `json` columns.)
 */
export function stripRuntimeOwnedFields(
  objectSchema: { name?: string; fields?: Record<string, ConditionalFieldDef> } | undefined | null,
  data: Record<string, unknown> | undefined | null,
  supplied: Readonly<Record<string, unknown>>,
  logger?: EvaluateRulesOptions['logger'],
  options?: { preserveAudit?: boolean; strictReadonlyWrites?: boolean },
): Record<string, unknown> | undefined | null {
  const fields = objectSchema?.fields;
  if (!fields || !data) return data;
  const preserveAudit = options?.preserveAudit === true;
  const strict = options?.strictReadonlyWrites === true;
  let result = data;
  for (const [name, def] of Object.entries(fields)) {
    if (!isRuntimeOwnedField(def)) continue;
    if (!(name in (result as Record<string, unknown>))) continue;
    // Own-property, never `in`: a field name is `^[a-z_][a-z0-9_]*$`, which
    // admits `constructor` / `valueOf` — inherited from `Object.prototype` on
    // any plain snapshot, so `in` would call a hook stamp caller-supplied and
    // strip it.
    if (!Object.prototype.hasOwnProperty.call(supplied, name)) continue; // hook/middleware stamp — keep
    // [#6339] ...and it must still BE the caller's value. A hook that overwrote
    // this key wrote a PLATFORM value, and deleting that is what sent records
    // to the database holding a sequence number the hook had just replaced.
    // `Object.is`, not `===`: `===` reports NaN !== NaN, which would read a
    // caller-forged NaN as "a hook rewrote it" and KEEP the forgery — the one
    // input where the loose operator inverts the verdict.
    if (!Object.is((result as Record<string, unknown>)[name], supplied[name])) continue;
    if (preserveAudit && isPreservableUnderAudit(name, def)) continue; // historical import reinstates it
    if (result === data) result = { ...data };
    delete (result as Record<string, unknown>)[name];
    // [#8214] The insert side carried the same false "COMMITTED WITHOUT IT"
    // claim under `strictReadonlyWrites`, and the card marked that UNVERIFIED.
    // Measured on `origin/main`, real `ObjectQL` + a recording driver, one
    // `autonumber` seeded by the caller: `refusedCode
    // ERR_READONLY_FIELD_REJECTED`, `driverCreates 0`, `warnLines 1`,
    // `claimsCommitted true`. It reproduces — `engine.insert` throws after this
    // pass and before any driver dispatch, exactly as `update` does.
    logger?.warn?.(
      runtimeOwnedStripWarning(name, String(def?.type), objectSchema?.name, {
        strict,
        preserveAuditApplies: isPreservableUnderAudit(name, def),
      }),
    );
  }
  return result;
}

/**
 * What the strip knows about the write at the moment it composes a line (#8214).
 *
 * Both members exist for the same reason and follow the same rule: **a strip
 * message may state only what is true of the call in front of it.** Neither is
 * a wording preference — each replaces a sentence that was measurably false for
 * a real caller.
 *
 * Both default to `false`, and the default is the CONSERVATIVE reading, not the
 * common one: an unset flag never claims a commit that may not happen and never
 * advertises a remedy that may not work. A caller that knows better says so.
 * #8141 is the standing reason — its defect was a line offering `isSystem` to a
 * caller for whom that exemption was the strictly worse posture, and a message
 * that guesses optimistically reproduces it.
 */
export interface StripWarningOptions {
  /**
   * The write passed `options.strictReadonlyWrites` (#5126), so the drop this
   * line reports will REFUSE the whole write instead of shrinking it.
   *
   * Measured on `origin/main` before this option existed (real `ObjectQL` + a
   * recording driver, by-id update of an object with a `readonly` field,
   * `{ strictReadonlyWrites: true }`): `refusedCode ERR_READONLY_FIELD_REJECTED`,
   * `driverWrites 0`, `warnLines 1`, and the one line said the update was
   * "COMMITTED WITHOUT IT". Nothing was written and the log promised a partial
   * commit — the #4632 shape inverted, sending a reader to hunt for a row that
   * was never touched. The INSERT side reproduced identically
   * (`runtimeOwnedStripWarning`, `driverCreates 0`), which is why this option
   * is shared by both messages rather than being an update-path patch.
   *
   * ⚠️ The strip is NOT the seam that decides the refusal, so this flag is the
   * caller's assertion, not a derivation: `assertNoStrictDrops()` in `engine.ts`
   * throws afterwards. It is safe to state as fact here because the two are
   * driven off the SAME drop — a field this function is called for is a field
   * `reportDroppedFields` records and `assertNoStrictDrops` then refuses on,
   * including the `addressKey` case, which is excluded from both channels by
   * one predicate (#8141). Adding a drop path that skips one channel and not
   * the other would falsify this line; keep the two fed from one fact.
   */
  readonly strict?: boolean;
  /**
   * `{ context: { preserveAudit: true } }` (#3493) would have KEPT this exact
   * field — so naming it is a remedy the reader can act on.
   *
   * DERIVED from {@link isPreservableUnderAudit} at the call site, never from a
   * hand-written description of the whitelist. That is the whole point: the
   * whitelist is `AUDIT_TIMELINE_FIELDS` plus any non-`system` field, and its
   * second limb is under active revision (#8215 — it currently sweeps in a
   * platform object's own primary key). A sentence DESCRIBING the whitelist
   * becomes false the day that lands; a sentence gated on the predicate narrows
   * with it, automatically and with no second declaration to forget.
   *
   * It is also why the remedy is targeted rather than blanket. `preserveAudit`
   * does not help every stripped `readonly` field: a non-audit `system` column
   * (`organization_id` — tenancy) is stripped under `preserveAudit` too, and
   * measured, today's blanket-free wording is right about that one by accident.
   * Offering the flag there would repeat #8141's defect one exemption over.
   */
  readonly preserveAuditApplies?: boolean;
}

/**
 * The `preserveAudit` remedy sentence, emitted only when the flag would really
 * have kept the field this line names. See {@link StripWarningOptions}.
 */
function preserveAuditRemedySentence(options?: StripWarningOptions): string {
  if (options?.preserveAuditApplies !== true) return '';
  return (
    ` A historical import restoring this record's own earlier values does NOT need that blanket ` +
    `exemption: pass the narrower historical-import context { context: { preserveAudit: true } } ` +
    `(#3493), which reinstates THIS field while the rest of the strip stays in force.`
  );
}

/**
 * The "observe instead of reading this log" sentence. Under strict the write is
 * refused, so "detect drops programmatically" is not the remedy on offer —
 * dropping strict is. Same sentence the refusal error itself ends on, so the
 * log line and `ReadonlyFieldRejectedError` point the same way.
 */
function observeInsteadSentence(options?: StripWarningOptions): string {
  return options?.strict === true
    ? ` To let the strip happen and merely observe it instead of refusing the write, drop ` +
        `options.strictReadonlyWrites and pass options.onFieldsDropped (#3407).`
    : ` To detect drops programmatically instead of reading ` +
        `this log, pass options.onFieldsDropped (#3407).`;
}

/**
 * The message the runtime-owned strip logs per dropped field (#5503). Exported
 * so the pin test asserts the CONTRACT of this text rather than its wording.
 *
 * Deliberately distinct from {@link readonlyStripWarning}: the author never
 * wrote `readonly: true` on an `autonumber` field, so "this field is read-only"
 * alone reads as a bug report against their own metadata. The message has to
 * name WHY the value is refused (the runtime issues it) and WHICH legitimate
 * writer paths still may set it. Same `warn` level, for the same reason spelled
 * out on {@link readonlyStripWarning}: this seam cannot tell a hostile forged
 * body from a trusted server-side writer that simply forgot to declare itself.
 *
 * [#8214] Its `preserveAudit` clause is now gated on
 * {@link StripWarningOptions.preserveAuditApplies} rather than printed
 * unconditionally. The clause was RIGHT for every field measured — a declared
 * `autonumber` is not `system`, so the whitelist keeps it — and it stays
 * printed for those. What changed is that the two sibling messages now derive
 * their remedy set from ONE predicate instead of each carrying its own opinion,
 * which is the disagreement #8214 was filed about.
 */
export function runtimeOwnedStripWarning(
  field: string,
  type: string,
  object?: string,
  options?: StripWarningOptions,
): string {
  const on = object ? ` on '${object}'` : '';
  const audit = options?.preserveAuditApplies === true;
  const consequence =
    options?.strict === true
      ? `DROPPED and the write is being REFUSED ENTIRELY — the runtime issues this value from its ` +
        `sequence, and this write passed options.strictReadonlyWrites, so NOTHING is written: not ` +
        `this column, and not the fields that would have survived the strip. The call throws ` +
        `ERR_READONLY_FIELD_REJECTED rather than returning success (#5126).`
      : `DROPPED and the write is being COMMITTED WITHOUT IT — the runtime issues this value from its ` +
        `sequence, so the call returns success while the column holds the generated number, not the one ` +
        `sent (#5503).`;
  return (
    `Field '${field}'${on} is a runtime-owned '${type}' field: the caller-supplied value was ` +
    consequence +
    ` Server-side code that legitimately sets it (seed replay, a migration) must ` +
    `declare itself trusted by passing { context: { isSystem: true } }` +
    (audit
      ? `; a data import reinstating ` +
        `legacy record numbers uses the historical-import context ({ context: { preserveAudit: true } }, ` +
        `#3493), which reinstates THIS field while the rest of the strip stays in force. ` +
        `A beforeInsert/beforeUpdate hook does NOT need either — hook-written keys are not ` +
        `caller-supplied.`
      : `. A beforeInsert/beforeUpdate hook does NOT need it — hook-written keys are not ` +
        `caller-supplied.`) +
    observeInsteadSentence(options) +
    ` Forged record numbers from untrusted client input are ` +
    `expected here and need no action.`
  );
}

/**
 * The message {@link stripReadonlyFields} logs per dropped field (#4903).
 * Exported so the pin test asserts the CONTRACT of this text — consequence,
 * `isSystem` remedy, `onFieldsDropped` remedy — rather than its wording.
 *
 * ### [#8214] Two claims that were false, and are now conditioned on the fact
 *
 * 1. **The commit.** "COMMITTED WITHOUT IT" is the DEFAULT strip's consequence
 *    and stays byte-identical there. Under `strictReadonlyWrites` it was a lie:
 *    nothing is written at all. See {@link StripWarningOptions.strict} for the
 *    measurement. The line is NOT dropped in strict mode — the level argument
 *    below is that `warn` exists so real forgery attempts stay visible, and a
 *    forged write that got REFUSED is the case that most deserves a line. Only
 *    the claim of a commit goes.
 * 2. **The remedy.** The message named `{ context: { isSystem: true } }`, the
 *    BLANKET exemption from the whole strip, and never `preserveAudit` (#3493),
 *    the narrower whitelist this strip actually honours three lines up. An
 *    import that forgot the flag read this line and was steered to the strictly
 *    worse posture — the identical failure #8141 fixed one remedy over. It is
 *    offered per-field rather than always, and derived rather than described;
 *    {@link StripWarningOptions.preserveAuditApplies} argues both.
 *
 * What did NOT change, deliberately: the level (`warn`), and the requirement
 * that every surviving line name the FIELD, the CONSEQUENCE and a REMEDY THAT
 * IS TRUE FOR THAT CASE. And the write's own address still logs nothing at all
 * (#8141) — in strict mode as well, since `addressKey` is consulted before this
 * message is composed in either mode.
 */
export function readonlyStripWarning(
  field: string,
  object?: string,
  options?: StripWarningOptions,
): string {
  const on = object ? ` on '${object}'` : '';
  const consequence =
    options?.strict === true
      ? `the caller-supplied value was DROPPED and the update is being REFUSED ENTIRELY — this ` +
        `write passed options.strictReadonlyWrites, so NOTHING is written: not this column, and ` +
        `not the fields that would have survived the strip. The call throws ` +
        `ERR_READONLY_FIELD_REJECTED rather than returning success (#5126).`
      : `the caller-supplied value was DROPPED and the update ` +
        `is being COMMITTED WITHOUT IT — the call returns success while this column keeps its stored ` +
        `value (#2948).`;
  return (
    `Field '${field}'${on} is read-only: ` +
    consequence +
    ` Server-side code that legitimately writes read-only columns (a plugin, a cron / ` +
    `background job persisting a system-computed value) must declare itself trusted by passing ` +
    `{ context: { isSystem: true } } on the write; a beforeUpdate hook does NOT need this because ` +
    `hook-written keys are not caller-supplied.` +
    preserveAuditRemedySentence(options) +
    observeInsteadSentence(options) +
    ` Forged read-only keys from untrusted client ` +
    `input are expected here and need no action.`
  );
}

/**
 * The audit / attribution family — the "original timeline" a historical import
 * (`preserveAudit`) is allowed to reinstate even though these columns are
 * `system` + `readonly`. DERIVED from the spec's `AUDIT_PROVENANCE_FIELDS`
 * (#3786) — the same tuple the registry's injection table is keyed by — so
 * this set and the injected columns cannot drift apart. The old literal here
 * carried a "kept in sync with the registry" comment and no mechanism.
 */
const AUDIT_TIMELINE_FIELDS: ReadonlySet<string> = new Set(AUDIT_PROVENANCE_FIELDS);

/**
 * Whether a caller-supplied `readonly` field may be REINSTATED by an opt-in
 * historical import (`preserveAudit`), rather than stripped (#3493). Allows:
 *  - the audit/timestamp family (`created_*` / `updated_*`) — the timeline the
 *    feature exists to preserve; and
 *  - author-declared business `readonly` fields (`closed_at`, `resolved_by`, …),
 *    i.e. anything NOT flagged `system: true`.
 * Still strips platform-managed `system` columns outside the audit family
 * (`organization_id` / tenancy, generated columns): a historical import may
 * reinstate established facts, but must not forge tenancy or system-generated
 * values.
 */
function isPreservableUnderAudit(name: string, def: ConditionalFieldDef): boolean {
  if (AUDIT_TIMELINE_FIELDS.has(name)) return true;
  return def.system !== true;
}

/**
 * A rule needs the prior record if it reasons about the transition or compares
 * against unchanged fields (`state_machine` / `cross_field` / `script`), or if
 * it is a `conditional` — its `when` predicate is evaluated against the MERGED
 * record, which is only a faithful view of the record with the prior state in
 * hand. `format` and `json_schema` only inspect the incoming value, so they
 * never need it.
 */
function ruleNeedsPrior(r: unknown): boolean {
  if (r == null || typeof r !== 'object') return false;
  const type = (r as BaseRule).type;
  if (type === 'state_machine' || type === 'cross_field' || type === 'script') {
    return true;
  }
  if (type === 'conditional') {
    const c = r as ConditionalRule;
    // #4649 — a `conditional` needs the prior record as soon as it declares a
    // `when`, not merely when a BRANCH does. `when` is evaluated against the
    // merged record, so without the prior state it reads a PATCH as if it were
    // the whole record: a `when` referencing an unchanged field used to fault
    // (and skip the rule), and under fail-closed evaluation it would reject
    // legitimate partial updates instead. Fetching is what makes the merged
    // record total, and totality is what makes fail-closed safe.
    return c.when != null || ruleNeedsPrior(c.then) || ruleNeedsPrior(c.otherwise);
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
  /** Author-declared display label, used to name the field in messages (#3957). */
  label?: string;
  // The ONLY predicate slot. The retired `conditionalRequired` alias (#3754 /
  // #3855) is no longer read here: every path that hands this validator a
  // STORED field definition now replays the ADR-0087 conversion chain at
  // rehydration (#3903 — `applyConversionsToStoredItem`, retired entries
  // included), so a pre-17 row arrives with the alias already lowered into
  // `requiredWhen`. Authored metadata never carried it (FieldSchema
  // tombstones the key). A caller handing raw, unconverted legacy input is
  // off-contract — PD #12: no consumer-side dialect fallback returns here.
  requiredWhen?: string | Expression;
  readonlyWhen?: string | Expression;
  /** Static, unconditional read-only flag (`field.readonly`). #2948. */
  readonly?: boolean;
  /** Auto-injected platform/audit field (`field.system`). Distinguishes the
   *  audit family / tenancy columns from author-declared business fields when
   *  a historical import (`preserveAudit`) relaxes the readonly strip. #3493. */
  system?: boolean;
  /** Field type — scopes per-option `visibleWhen` enforcement to choice fields. */
  type?: string;
  /** select/multiselect/radio/checkboxes options; an option may gate itself with `visibleWhen`. */
  options?: Array<ConditionalFieldOption | null | undefined>;
}

/**
 * Choice fields whose picked value(s) are drawn from `options`. Includes the
 * multi-value `checkboxes` (its client widget cascades identically to
 * `multiselect`, objectui#2715) so its gated options are enforced server-side too.
 */
const CHOICE_FIELD_TYPES = new Set(['select', 'multiselect', 'radio', 'checkboxes']);

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
    (f) => f && (f.requiredWhen || f.readonlyWhen || fieldHasOptionVisibility(f)),
  );
}

/** Normalize an author-time ExpressionInput into the canonical envelope. */
function toExpression(cond: string | Expression): Expression {
  return typeof cond === 'string' ? { dialect: 'cel', source: cond } : cond;
}

/**
 * Per-option authorization / cascade enforcement (objectui#2284).
 *
 * A `select` / `multiselect` / `radio` / `checkboxes` option may gate itself with
 * a `visibleWhen` CEL predicate, evaluated against the live record + `current_user`
 * (the same predicate the client uses to hide the option). Client-side hiding is
 * UX, not a security boundary — a caller can still submit a hidden value — so on
 * write we re-evaluate the predicate for the *picked* value(s) and reject any
 * that resolve cleanly to FALSE. This enforces both role/context gating
 * (`'admin' in current_user.positions`) and cascade integrity (`record.country ==
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
  messages: ValidationMessageContext | undefined,
): void {
  if (!fields) return;
  const user = (currentUser ?? undefined) as any;
  for (const [name, def] of Object.entries(fields)) {
    if (!fieldHasOptionVisibility(def) || !(name in data)) continue;
    const raw = data[name];
    if (raw === undefined || raw === null || raw === '') continue;
    const picked = Array.isArray(raw) ? raw : [raw];
    for (const value of picked) {
      // Match by string form, mirroring the enum validator (record-validator
      // compares `String(...)`). A numeric option value sent/stored as a string
      // (or vice-versa) must still hit its gate, not silently fail-open.
      const opt = def.options!.find((o) => o != null && String(o.value) === String(value));
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
        errors.push(buildFieldError({
          field: name,
          code: 'invalid_option',
          def,
          value: String(value),
          messageKey: 'option_unavailable',
        }, messages));
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

  const priorRecord = opts.previous ?? undefined;
  // Is the record's persisted state actually in hand? On insert there is
  // nothing to know (absence genuinely means "no value"); on update we know it
  // only when the engine fetched the prior row. Without it, defaulting a field
  // to `null` would not be materialising an absent value — it would be
  // FABRICATING one that contradicts the stored row, so we leave the record as
  // it is and let the (rare) unevaluable predicate fail closed. `ruleNeedsPrior`
  // makes this path unreachable for every rule that reads the merged record.
  const groundTruth = mode === 'insert' || priorRecord !== undefined;
  // The `previous` CEL binding is made total too (#4649): a predicate reading
  // `previous.x` for a declared column the driver did not return would
  // otherwise fault — and now that faults are rejections, that would 422 a
  // perfectly good rule. Copied, never mutated in place: the same object is the
  // engine's `hookContext.previous`, which after-hooks observe.
  const previous = mode === 'update' && priorRecord
    ? materializeDeclaredFields({ ...priorRecord }, fields)
    : priorRecord;
  // Merged view used by predicate rules: prior state overlaid with the PATCH,
  // so a rule referencing an unchanged field still sees its persisted value.
  const merged: Record<string, unknown> = { ...(previous ?? {}), ...data };
  // #1871 (insert) / #4649 (update) — a field the payload omits is absent from
  // the CEL scope, so `record.x == null` sees a missing key (which does not
  // equal null) and aborts the whole predicate. Default declared-but-absent
  // fields to null so an omitted optional reads as null, identically on insert
  // and update: what a predicate can read is the object's DECLARED shape, not
  // whatever subset of columns this driver happened to return.
  if (groundTruth) materializeDeclaredFields(merged, fields);
  const ctx: RuleContext = { data, merged, previous, mode, logger: opts.logger, fields, messages: opts.messages };

  const errors: FieldValidationError[] = [];

  // Field-level conditional rules (B2): a field whose `requiredWhen`
  // predicate is TRUE over the merged record must have a value — enforced
  // server-side so the rule can't be bypassed. (`readonlyWhen` is handled by
  // stripReadonlyWhenFields on the write path, not here.) A broken predicate
  // is fail-open (logged, skipped).
  //
  // ADR-0113 non-regression: reject iff the MERGED state violates AND the
  // PRE state complied. A write may not take the record from compliant to
  // violating — nulling the field, or flipping the condition true without
  // providing it — but a pre-existing violation (a legacy row from before
  // the rule tightened) does not block writes that leave it in place. This
  // is the same invariant `required` enforces, with the condition
  // generalized from "always true"; it is what makes tightening a
  // conditional contract on a deployed object safe (#3929's objection).
  if (hasFieldRules && fields) {
    // [#4977] `parent` — the master-detail header — bound for the field-level
    // `requiredWhen` predicates exactly as #4889 binds it for `readonlyWhen`,
    // and bound ONLY when the engine actually resolved one. An absent binding
    // is left absent rather than bound to `null`: `null.status` would fault as
    // `No such key` and lose the "which root was unbound" diagnostic below.
    const parentScope = opts.parent != null ? { extra: { parent: opts.parent } } : {};
    // The pre-check's header (see `EvaluateRulesOptions.previousParent`). Same
    // row as `parent` unless this write repoints the detail at another master.
    const prevParent = opts.previousParent !== undefined ? opts.previousParent : opts.parent;
    const prevParentScope = prevParent != null ? { extra: { parent: prevParent } } : {};
    for (const [name, def] of Object.entries(fields)) {
      const pred = def?.requiredWhen;
      if (!pred) continue;
      const res = ExpressionEngine.evaluate<boolean>(toExpression(pred), { record: merged, previous, ...parentScope });
      if (!res.ok) {
        // Fail-OPEN, unchanged (#4977 ruling: bind the scope, keep the
        // evaluation semantics). An unevaluable `requiredWhen` — including one
        // whose `parent` the engine could not resolve — is logged and skipped,
        // NOT turned into a rejection: that is option B, deliberately not taken
        // here and left to the next review of ADR-0058 D5. All that changes is
        // the diagnostic: an unbound ROOT is named, because "the header could
        // not be read" and "the author typo'd a key" are different faults with
        // different remedies and only one line of signal to tell them apart.
        const unbound = unknownVariableOf(res.error);
        opts.logger?.warn?.(
          unbound
            ? `requiredWhen for '${name}' reads '${unbound}', which is not bound for this operation — ` +
              `skipped (the requirement is NOT enforced for this write). ` +
              `A 'parent'-scoped predicate needs the object to declare exactly one master_detail relationship.`
            : `requiredWhen for '${name}' failed to evaluate — skipped`,
        );
        continue;
      }
      if (res.value === true && isMissing(merged[name])) {
        // Pre-state check (update only; on insert the pre state complies
        // vacuously). If the predicate cannot be evaluated over the previous
        // record, treat the pre state as COMPLIANT — enforcement stays on
        // unless a legacy violation is proven.
        if (mode === 'update' && previous) {
          const pre = ExpressionEngine.evaluate<boolean>(toExpression(pred), { record: previous, previous, ...prevParentScope });
          const preViolated = pre.ok && pre.value === true && isMissing(previous[name]);
          if (preViolated) continue; // legacy rows rest
        }
        errors.push(buildFieldError({ field: name, code: 'required', def }, opts.messages));
      }
    }
  }

  // Per-option authorization / cascade gating (objectui#2284): reject a written
  // choice value whose option `visibleWhen` resolves cleanly to FALSE against the
  // merged record + `current_user`. Complements the client-side hiding, which is
  // not a security boundary.
  evaluateOptionVisibility(fields, data, merged, previous, opts.currentUser, errors, opts.logger, opts.messages);

  const ordered = (hasRules ? rules! : [])
    .filter((r): r is BaseRule => r != null && typeof r === 'object')
    .filter((r) => r.active !== false)
    // Seed writes (#3433) skip `state_machine` entirely: curated seed data is a
    // snapshot of established facts, not a record flowing through its lifecycle,
    // so neither the `initialStates` entry-point (insert) nor the transition
    // (update) guard applies. Every other rule type still runs.
    .filter((r) => !(opts.skipStateMachine && r.type === 'state_machine'))
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
      return checkStateMachine(rule as StateMachineRule, ctx.mode, ctx.data, ctx.previous, ctx);
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
 * State-machine check.
 *
 * On UPDATE (with a prior record): if the state field changed, the new value
 * must appear in `transitions[oldValue]`. Lenient where it cannot reason (no
 * prior record, unchanged value, or a prior state with no declared transitions)
 * so it never blocks legitimate or legacy data.
 *
 * On INSERT: if the rule declares `initialStates` (#3165), the state field's
 * (defaulted) value must be one of them — the FSM entry point, since a `select`
 * field alone permits ANY declared option as an initial value (a record could
 * otherwise be born already `approved`). Absent `initialStates`, insert is a
 * no-op (legacy behavior); a missing/empty value is left to required-validation.
 */
function checkStateMachine(
  rule: StateMachineRule,
  mode: Mode,
  data: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  ctx?: Pick<RuleContext, 'fields' | 'messages'>,
): FieldValidationError | null {
  // An author-written `rule.message` wins untouched — it is already in the
  // language its author chose. Only the FALLBACK is ours to localize (#3957).
  const fallback = (
    code: 'invalid_initial_state' | 'invalid_transition',
    constraint: Record<string, unknown>,
    value?: string,
  ): FieldValidationError => {
    const def = ctx?.fields?.[rule.field];
    if (rule.message) {
      return {
        field: rule.field,
        code,
        message: rule.message,
        label: resolveFieldLabel(rule.field, def, ctx?.messages),
      };
    }
    return buildFieldError({ field: rule.field, code, def, constraint, value }, ctx?.messages);
  };
  if (mode === 'insert') {
    const initial = rule.initialStates;
    if (!Array.isArray(initial) || initial.length === 0) return null; // no initial-state contract → legacy no-op
    if (!(rule.field in data)) return null; // absent → required-validation's job
    const value = data[rule.field];
    if (value === undefined || value === null || value === '') return null; // empty → not an initial state to check
    if (!initial.includes(String(value))) {
      return fallback('invalid_initial_state', { allowed: initial.join(', ') }, String(value));
    }
    return null;
  }
  if (!previous) return null;
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
    return fallback('invalid_transition', { from: fromKey, to: String(to) });
  }
  return null;
}

/**
 * The rejection a predicate that CANNOT BE EVALUATED produces (#4649).
 *
 * Not a violation — the rule never got to say yes or no — but it rejects the
 * write all the same, because a validation whose verdict is unknown may not be
 * read as "allowed". The message names the rule and, when the fault is a
 * missing key, that key plus the two ways to fix it; `constraint` carries the
 * same facts machine-readably so a client need not parse prose.
 *
 * The wire `code` stays `rule_violation`: the field-error catalog (ADR-0114,
 * `packages/spec`) is closed and a broken rule is still "a declared rule
 * rejected this write" from every consumer's point of view. `constraint.reason`
 * is what distinguishes the two for anyone who cares.
 *
 * The fault is READ by the shared `cel-fault.ts` helper (#4775), which words
 * the same two sentences for the hook-`condition` surface next door. Two
 * evaluators that reject a write for the same reason must not describe it in
 * two dialects — the same argument that made `materializeDeclaredFields`
 * shared.
 */
function unevaluableRuleError(
  ruleName: string,
  field: string,
  error: { kind: string; message: string },
  what: 'predicate' | 'when-predicate',
): FieldValidationError {
  const { summary, missingKey, nullOverload, detail } = describeCelFault(error, {
    what,
    undeclaredKeyFix: "fix the rule's condition, or declare the field",
  });
  return {
    field,
    code: 'rule_violation',
    message:
      `Validation rule '${ruleName}' could not be evaluated (${summary}) — write rejected.${detail}`,
    constraint: {
      rule: ruleName,
      reason: 'unevaluable',
      fault: summary,
      ...(missingKey ? { missingKey } : {}),
      ...(nullOverload ? { hint: 'null-comparison' } : {}),
    },
  };
}

/**
 * CEL predicate check (`script` / `cross_field`). The predicate expresses the
 * *failure* condition: if it evaluates TRUE the rule is violated. A predicate
 * that cannot be evaluated — over a record already made total for every
 * declared field — is a broken rule, and a broken validation is **fail-closed**
 * (#4649): it rejects the write rather than waving it through.
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

  const field = rule.fields?.[0] ?? '_record';

  if (!result.ok) {
    // Still logged — the operator needs the fault in the log even though the
    // caller now gets it in the response. Note the verb: rejected, not skipped.
    logger?.warn?.(
      `Validation rule '${rule.name}' predicate failed to evaluate (${result.error.kind}: ${result.error.message}) — write rejected (#4649)`,
    );
    return unevaluableRuleError(rule.name, field, result.error, 'predicate');
  }

  if (result.value === true) {
    return {
      field,
      code: 'rule_violation',
      message: rule.message,
    };
  }
  return null;
}

// Linear-time email check. Domain labels exclude '.', so the quantifiers on
// either side of each '.' can't overlap — this avoids the polynomial
// backtracking (ReDoS) of the naive `[^\s@]+\.[^\s@]+` shape while still
// requiring a local part, an '@', and a dotted domain.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
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
 * `evaluateRule`. An un-evaluable `when` is **fail-closed** (#4649) for the same
 * reason a `script` predicate is: neither branch ran, so the guard the author
 * declared did not happen, and a validation that did not happen must not read as
 * a pass. The nested rule supplies the violation (field/code/message) when the
 * `when` DOES evaluate; the *outer* conditional's `severity` governs whether
 * either outcome blocks (handled by the caller).
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
      `Validation rule '${rule.name}' when-predicate failed to evaluate (${result.error.kind}: ${result.error.message}) — write rejected (#4649)`,
    );
    return unevaluableRuleError(rule.name, '_record', result.error, 'when-predicate');
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
