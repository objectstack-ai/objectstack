// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ConditionBuilder — a no-code editor for a CEL predicate (ServiceNow-style),
 * compiling rows of [subject][operator][value] joined by AND/OR into a CEL
 * string emitted via onCommit (empty ⇒ '' ⇒ caller should unset).
 *
 * Stateful by design: rows live in local state so an in-progress row (no
 * subject yet) stays on screen instead of vanishing the moment it compiles to
 * an empty string. The emitted CEL is recomputed from rows on every edit.
 *
 * Safety: on (re)load the builder only adopts an existing expression when it
 * parses AND round-trips byte-for-byte (whitespace-normalised). Anything it
 * can't round-trip cleanly opens in a raw expression textarea, so hand-authored
 * complex CEL is never silently rewritten.
 *
 * The two operators that take no value are TYPED by the field catalog
 * (objectui#11894): on a boolean field they are "is true" / "is false" and
 * compile to the bare subject and its negation, as they always did; on any
 * other declared field they are "is not empty" / "is empty" and compile to a
 * null-or-empty check — see {@link compileRow}.
 */

import * as React from 'react';
import {
  Button, Input, Label,
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@object-ui/components';
import { Plus, X, Code2, ListFilter } from 'lucide-react';
import { BOOLEAN_VALUE_TYPES, expandEmptyOperator, type EmptyOperatorArm } from '@objectstack/spec/data';
import { useObjectFields } from '../previews/useObjectFields.js';
import { CelPredicateField } from '../CelPredicateField.js';
import type { CelLintIssue } from '../celAuthoring.js';
import { t, useMetadataLocale } from '../i18n.js';

type Op = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'truthy' | 'falsy';

/** The quote character a string literal was authored with. Remembered per row
 *  so the builder re-emits the author's own spelling instead of normalising it
 *  (`88b15fddc`) — see {@link fmtValue}. */
type Quote = '"' | "'";

interface Row { subject: string; op: Op; value: string; quote?: Quote }

type OpChoice = { value: Op; labelKey: string } | { value: Op; symbol: string };

/** The operators that compare with a value: a catalogue key for the worded
 *  ones, a bare symbol for `≥` / `≤`, which read the same in every locale
 *  (objectui#10586). */
const COMPARE_OPS: ReadonlyArray<OpChoice> = [
  { value: '==', labelKey: 'engine.inspector.condition.op.equals' },
  { value: '!=', labelKey: 'engine.inspector.condition.op.notEquals' },
  { value: '>', labelKey: 'engine.inspector.condition.op.greaterThan' },
  { value: '<', labelKey: 'engine.inspector.condition.op.lessThan' },
  { value: '>=', symbol: '≥' },
  { value: '<=', symbol: '≤' },
];

/**
 * What the field catalog DECLARES about a subject's value (objectui#11894):
 * `'boolean'`, or the row of the spec's ruled 「is empty」 table the field
 * takes. A subject the catalog does not declare has no answer — `undefined`,
 * never a guess. See {@link declaredSubjectValue}.
 */
type SubjectValue = 'boolean' | EmptyOperatorArm;
type SubjectValueOf = (subject: string) => SubjectValue | undefined;
const NOTHING_DECLARED: SubjectValueOf = () => undefined;

/**
 * The words the two value-less operators take, by what the catalog declares
 * about the row's subject (objectui#11894). The operator VALUES stay `truthy`
 * / `falsy` whatever the subject, so a row keeps its operator when its subject
 * changes and only the wording and the emitted CEL follow the new subject.
 *
 * - `boolean` — "is true" / "is false", compiled to the bare subject and `!`.
 * - `emptiable` — every other declared field: "is not empty" / "is empty".
 * - `undeclared` — a subject the catalog does not type (a context subject, a
 *   flow variable, a field whose catalog row carries no type): the wording it
 *   always had, because which of the two it means cannot be read off anything
 *   this component holds.
 */
const VALUELESS_OP_KEYS: Readonly<Record<'boolean' | 'emptiable' | 'undeclared', { truthy: string; falsy: string }>> = {
  boolean: {
    truthy: 'engine.inspector.condition.op.isTrue',
    falsy: 'engine.inspector.condition.op.isFalse',
  },
  emptiable: {
    truthy: 'engine.inspector.condition.op.isNotEmpty',
    falsy: 'engine.inspector.condition.op.isEmpty',
  },
  undeclared: {
    truthy: 'engine.inspector.condition.op.truthy',
    falsy: 'engine.inspector.condition.op.falsy',
  },
};

/** The operator list one row offers: the compare operators, then the
 *  value-less pair worded for that row's subject (objectui#11894). */
function opChoicesFor(declared: SubjectValue | undefined): ReadonlyArray<OpChoice> {
  const keys = VALUELESS_OP_KEYS[
    declared === undefined ? 'undeclared' : declared === 'boolean' ? 'boolean' : 'emptiable'
  ];
  return [
    ...COMPARE_OPS,
    { value: 'truthy', labelKey: keys.truthy },
    { value: 'falsy', labelKey: keys.falsy },
  ];
}

/** One entry of the field catalog the builder reads its subjects from. */
interface CatalogField {
  name: string;
  label?: string;
  hidden?: boolean;
  /** The field's declared type — the value-less operators are worded and
   *  compiled by it (objectui#11894). Absent ⇒ the subject is undeclared. */
  type?: string;
  /** `multiple: true` — a multi-capable type whose stored value is a list. */
  multiple?: boolean;
}

/**
 * What one catalog field declares about its value (objectui#11894).
 *
 * - A boolean type is a member of the spec's `BOOLEAN_VALUE_TYPES`, read by
 *   reference — the one set CEL's `!` and a bare `&&` operand are well typed
 *   for.
 * - Every other type takes the row of the ruled 「is empty」 table that the
 *   spec's `expandEmptyOperator` assigns it, keyed on the type and `multiple`
 *   — the one function the list filter builder and every server face expand
 *   `$empty` with. ⛔ No local copy of that table.
 * - A `formula` is undeclared: its value takes its `returnType`, which no
 *   catalog row carries. That is the spec's own reading — its boolean comparand
 *   door judges a `formula` by `returnType` and defers one without a readable
 *   one — and it keeps "is true" on a boolean formula compiling as it did.
 * - A row with no type is undeclared too.
 */
function declaredSubjectValue(field: CatalogField): SubjectValue | undefined {
  const { type } = field;
  if (typeof type !== 'string' || type === '' || type === 'formula') return undefined;
  if (BOOLEAN_VALUE_TYPES.has(type)) return 'boolean';
  return expandEmptyOperator({ type, multiple: field.multiple === true }).arm;
}

/**
 * Every subject the catalog types, keyed by the spelling the subject dropdown
 * emits for it — `FIELDPREFIX + name`, and `previous.` + name where the mount
 * offers `previous` — so a stored subject is typed exactly when it names a
 * catalog field. Hidden fields are typed too: a stored row may name one.
 */
function declaredSubjectValues(
  fields: ReadonlyArray<CatalogField>,
  fieldPrefix: string,
  includePrevious: boolean,
): Map<string, SubjectValue> {
  const out = new Map<string, SubjectValue>();
  for (const f of fields) {
    const declared = declaredSubjectValue(f);
    if (declared === undefined) continue;
    out.set(`${fieldPrefix}${f.name}`, declared);
    if (includePrevious) out.set(`previous.${f.name}`, declared);
  }
  return out;
}

/**
 * The context subjects a record-scoped mount site binds. This is the DEFAULT
 * vocabulary — a caller that binds something else declares it via
 * {@link ConditionSubjectVocabulary.context}.
 *
 * ## `org.id` is gone — the objectui#8155 case, one control over (objectui#9855)
 *
 * It was the exact mirror of `app` in `ROW_PREDICATE_ROOTS`
 * (`ConditionalFormattingEditor`): a root this editor ADVERTISED and its own
 * linter REFUSES. `@objectstack/formula`'s `SCOPE_ROOTS` carries no `org`, so
 * at `scope: 'record'` the validator reads `org.id` as a bare field and errors
 * with the nonsense remedy `record.org` — and no host binds one either:
 * `buildExpressionScope` (`ExpressionProvider`) publishes the identity roots
 * and no `org`. Offering it cost the author the write, which is worse than the
 * autocomplete half objectui#9645 closed: that one at least linted clean.
 * `ConditionBuilder.contextSubjects.test.tsx` re-derives the verdict from the
 * engine instead of restating it, so an engine that starts accepting `org`
 * reddens there rather than leaving this paragraph to rot.
 *
 * ⚠️ This does NOT touch {@link REFERENCE_ROOTS}, which still carries `org` —
 * see the note there. Withdrawing an OFFER is not the same act as re-reading
 * an author's own bytes.
 *
 * ## `user.*` STAYS, and that is a measurement rather than an omission
 *
 * The card proposed removing both. `user` is the `os` case of that same
 * objectui#8155 ruling, not the `app` case: the engine ACCEPTS it, and
 * `buildExpressionScope` really does bind it for every predicate evaluated in
 * the browser — so at a client-evaluated mount it is a subject an author can
 * legitimately pick and a row that really matches. Where it is genuinely
 * unbound is the SERVER-evaluated `condition`, and {@link
 * RECORD_CONDITION_ROOTS} states in its own words why this component cannot
 * tell those two apart from anything a mount passes. ⛔ So it is not narrowed
 * by a default here; such a mount declares its own list through {@link
 * ConditionSubjectVocabulary.context}, the way the flow trigger already does.
 *
 * ⚠️ The asymmetry that licensed objectui#9645's narrowing does NOT transfer
 * to this list, which is why the two doors are not one edit. `roots` feeds the
 * raw editor's SUGGESTIONS, so a mount that loses one loses an offer and keeps
 * the spelling; this list is the row builder's ONLY subject control, so
 * dropping an entry drops the author's ability to build that row at all.
 */
const CONTEXT_SUBJECTS = [
  { value: 'record.id', label: 'record.id' },
  { value: 'user.id', label: 'user.id' },
  { value: 'user.email', label: 'user.email' },
  { value: 'user.role', label: 'user.role' },
  { value: 'user.isAdmin', label: 'user.isAdmin' },
];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The subject vocabulary a mount site binds (`88b15fddc`).
 *
 * The builder used to hardcode one: `record.` + field name, plus `record.id` /
 * `user.*` / `org.*`. That is right for every RECORD-scoped site — which is
 * most of the sites that mount it; grep the JSX tag to enumerate them, rather
 * than trusting a figure here, which the census this paragraph used to give
 * had already outlived (AGENTS.md #9) — and wrong for a FLATTENED-scoped one such as
 * the flow designer's entry condition, where the trigger record's fields ARE
 * the top-level evaluation context (bare `status`) and the prior values arrive
 * as `previous.FIELD`. See `flow-scope.ts`, which already computes exactly
 * this shape (`fieldPrefix: onStart ? '' : 'record.'`, `includePrevious`), and
 * objectstack's `packages/formula/src/validate.ts` for the two scopes.
 *
 * Declared, not inferred: the component never guesses a site's scope from the
 * value it is handed. A caller that declares nothing gets the record-scoped
 * default, unchanged.
 */
export interface ConditionSubjectVocabulary {
  /**
   * Prefix put in front of each catalog field name. Defaults to `'record.'`.
   * Pass `''` to declare a flattened scope, where bare `status` is the subject.
   */
  fieldPrefix?: string;
  /**
   * Also offer `previous.FIELD` for each catalog field, plus the whole-record
   * `previous` token — which is what makes the create-path idiom
   * `previous == null` selectable rather than something the author has to
   * recall from help text. Defaults to `false`.
   */
  includePrevious?: boolean;
  /**
   * Replace the context subjects. Defaults to {@link CONTEXT_SUBJECTS}. A
   * flattened site passes its own list rather than inheriting `record.id`,
   * whose root that site does not bind — offering it would make this editor
   * emit the one spelling its own sibling ref-check flags as out of scope.
   */
  context?: ReadonlyArray<{ value: string; label?: string }>;
}

/**
 * Scope roots a value typed into the value box may plainly REFERENCE, rather
 * than name as literal text (objectui#6293).
 *
 * Deliberately the roots this builder's own vocabulary already commits to —
 * not every root the CEL engine advertises:
 *
 *  - `record` / `user` — this component's own subject vocabulary
 *    (`record.<field>` from the field catalog, plus {@link CONTEXT_SUBJECTS}).
 *    A value under one of these is the same identifier the subject dropdown
 *    emits one control to its left.
 *  - `org` — no longer that case, and kept deliberately (objectui#9855).
 *    {@link CONTEXT_SUBJECTS} no longer offers `org.id`, so the dropdown does
 *    not emit it any more; this list stays wider because it answers a
 *    different question. An author who types `org.id` into the VALUE box means
 *    a reference, and quoting it would rebuild exactly the silently-false
 *    predicate objectui#6293 fixed — a loud unknown-variable fault is the
 *    better failure, and the only one a checker can see. That the two
 *    populations must not be merged is already pinned by
 *    `ConditionBuilder.mountRoots.test.tsx`.
 *  - `previous` — the prior persisted record, bound by `evalFieldPredicate`
 *    (`@object-ui/core`) and by the server-side hook / validation evaluators.
 *    This is the change-detection idiom the defect was measured on.
 *  - `current_user` — the canonical spelling of `user` (ADR-0068); the shell
 *    binds one identity object under both names, so which alias the author
 *    happened to type must not decide whether it reads as a reference.
 *  - `parent` — the header row an inline line-item cell compares against,
 *    bound through `evalFieldPredicate`'s `scope` extra.
 *
 * NOT included, on purpose: `data`, `os`, `app`, `features`, `input`, `vars`,
 * `page`. All but `app` are real roots at some surface — `app` is a root at
 * none since objectui#8155 unbound it, and it stays on this list because the
 * list is what this builder does not capture, not what exists. This builder
 * never offers any of them, and over-capturing there fails in the WRONG
 * direction — `data.csv` is
 * a plausible literal, and `data` IS bound, so reading it as a reference would
 * produce another silently-false predicate instead of a loud one. Which roots
 * a mounting surface actually binds is caller-supplied vocabulary
 * (`88b15fddc`), the caller's to declare, not this list's to guess.
 */
export const REFERENCE_ROOTS = ['record', 'previous', 'parent', 'user', 'current_user', 'org'] as const;

/**
 * A dotted path under a declared root — i.e. plainly a reference.
 *
 * Anchored, and dotted identifiers only. "Contains a dot" is NOT the test: a
 * version string (`1.2.3`), a filename, and a path under a root nothing binds
 * all stay literal text.
 */
const REFERENCE_RE = new RegExp(
  `^(?:${REFERENCE_ROOTS.join('|')})(?:\\.[A-Za-z_][A-Za-z0-9_]*)+$`,
);

/**
 * Scope roots the RAW CEL editor ADVERTISES at a mount that declares
 * `scope="record"` (objectui#9645).
 *
 * ## Not the same population as {@link REFERENCE_ROOTS}, and not mergeable
 *
 * `REFERENCE_ROOTS` answers a question about the VALUE BOX — is the text an
 * author typed to the right of an operator a reference or literal text — and
 * is deliberately wider than any one mount's binding: it carries `org` and
 * `parent`, which the engine's record scope does not advertise at all. This
 * list answers what the AUTOCOMPLETE offers. A root belongs here only if the
 * host that evaluates the authored predicate binds it. The two lists overlap
 * without coinciding in either direction, so folding them into one would
 * either advertise roots no host binds or stop quoting values the builder
 * already treats as references.
 *
 * ## Why the engine's own advertisement is the wrong answer here
 *
 * `introspectScope` offers every root ANY predicate site may see, so a mount
 * that forwards no override inherits all of them. That is how a hook
 * `condition` came to suggest `os.user.id`: the suggestion linted CLEAN — the
 * accept set is the engine's `SCOPE_ROOTS`, which carries `os` / `current_user`
 * / `vars` — and objectstack's hook wrapper then evaluated the stored
 * condition against `{ record: record ?? {}, previous }` and threw
 * `HookConditionError`, deliberately fail-LOUD. The editor proposed the root,
 * the linter endorsed it, and the author's write paid for it. The sibling
 * treatment is `ROW_PREDICATE_ROOTS` in `ConditionalFormattingEditor` and
 * `FIELD_RULE_ROOTS` / `FORMULA_ROOTS` in `ObjectFieldInspector`; this is the
 * same treatment at this component's own forwarding site.
 *
 * ## Why one declared list, rather than one derived per mount
 *
 * This component cannot derive it. Nothing a mount passes distinguishes a
 * SERVER-evaluated `condition` from a CLIENT-evaluated `visible`, and their
 * hosts bind different sets: app-shell's `buildExpressionScope` publishes
 * `current_user` / `user` / `ctx` / `os` / `features` to the client evaluator,
 * while the hook wrapper quoted above binds `record` and `previous`. So the
 * default is the set EVERY host of a record-scoped condition binds, and a
 * mount that binds more declares it through the `roots` prop.
 *
 * Narrowing is the safe direction, and the asymmetry is the whole argument:
 * `roots` feeds autocomplete only — the accept set is untouched — so a client
 * mount that wants `os` offered again loses a suggestion until it declares
 * one, never a spelling, while an over-advertised root on a server-evaluated
 * mount costs the author the write. The numbers behind this paragraph are
 * re-derived from the engine by `ConditionBuilder.mountRoots.test.tsx`, which
 * reads `introspectScope` rather than restating its answer.
 */
export const RECORD_CONDITION_ROOTS = ['record', 'previous'];

/**
 * Scope roots a mount ADVERTISES when its predicate is evaluated in the
 * BROWSER — the client half of the ruling {@link RECORD_CONDITION_ROOTS}
 * states for the server (objectui#9856).
 *
 * ## Why the record-scoped default is wrong at these mounts, and only these
 *
 * {@link RECORD_CONDITION_ROOTS} is the set EVERY host of a record-scoped
 * condition binds, which is the only safe answer for a mount whose host this
 * component cannot see. It is not the RIGHT answer for a mount whose host is
 * KNOWN to bind more. An action's `visible` / `disabled` is evaluated in the
 * browser: `buildExpressionScope` (`ExpressionProvider`) publishes the identity
 * roots and the deployment feature flags, and the row arrives separately
 * through `usePredicateRecordContext`. Such a mount forwarding no `roots` loses
 * the offers its own host really answers — the cost objectui#9645 declared on
 * its face and left for this card to pay.
 *
 * Which tier evaluates which metadata type is NOT re-derived here:
 * `CONDITION_HOST_BY_METADATA_TYPE` (`conditionScope.ts`) rules it per type
 * from readings taken at each evaluator, and this list is what its `client`
 * verdict declares.
 *
 * ## Every member, and the producer it is read back from
 *
 * `record` is the one binding `usePredicateRecordContext` makes — it returns
 * `{ record }` and nothing else. The rest are exactly the keys
 * `buildExpressionScope` returns. ⛔ Neither half is retyped from a docblock:
 * `ConditionBuilder.clientMountRoots.test.tsx` rebuilds the list from both
 * producers, so the reading fails when either side moves rather than leaving
 * this paragraph to rot.
 *
 * ## `previous` is deliberately NOT here — this list narrows as well as widens
 *
 * It is the one root this list DROPS relative to the record-scoped default, and
 * the drop is the same ruling as the additions rather than an exception to it.
 * No browser host binds it: `usePredicateRecordContext` binds the row alone and
 * `buildExpressionScope` publishes no `previous`. Offering it here would be the
 * `app` shape objectui#8155 ruled on — an editor advertising a root nothing
 * answers — and the predicate an author built from it could only fault. The
 * pin derives its absence from the two producers rather than asserting it.
 *
 * ## Every member must also LINT clean — the objectui#8167 direction
 *
 * A root advertised here that the `record` scope REFUSES would re-create that
 * defect at the other door: the engine refuses `org` and `app` at this scope
 * today, and an editor that offers what its own linter rejects costs the author
 * the write. So the pin lints each member through the same path the editor
 * uses, rather than snapshotting a list.
 */
export const CLIENT_CONDITION_ROOTS = ['record', 'current_user', 'user', 'ctx', 'os', 'features'];

/**
 * CEL's own word-shaped literals. Spelled like identifiers, bound by nobody, so
 * {@link celRootsMentioned} must not read one as a root.
 */
const CEL_WORD_LITERALS = new Set(['true', 'false', 'null', 'in']);

/** A quoted string, removed before roots are read — see {@link celRootsMentioned}. */
const CEL_STRING_LITERAL_RE = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;

/** A dotted identifier path, matched whole so a member never reads as a root. */
const CEL_IDENT_PATH_RE = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;

/**
 * The scope roots a CEL fragment plainly MENTIONS — the head of every dotted
 * identifier path in it.
 *
 * String literals are removed first, for the reason {@link fmtValue} states one
 * control over: a quoted `'record.status'` is TEXT, and reading it as a
 * reference is the silently-false predicate objectui#6293 fixed. Word-shaped
 * CEL literals are excluded by {@link CEL_WORD_LITERALS}; everything else that
 * heads a dotted path is a root this fragment teaches.
 *
 * Exported because the placeholder pin asserts a RELATION rather than a string
 * — it reads whatever the editor shows and requires every root in it to be
 * offered at that mount. A pin that asserted the literal could not fail on the
 * day someone re-hard-codes one, which is the defect this function exists to
 * make unrepeatable.
 */
export function celRootsMentioned(expr: string): string[] {
  const code = expr.replace(CEL_STRING_LITERAL_RE, ' ');
  const roots = new Set<string>();
  for (const path of code.match(CEL_IDENT_PATH_RE) ?? []) {
    const root = path.split('.')[0];
    if (!CEL_WORD_LITERALS.has(root)) roots.add(root);
  }
  return [...roots];
}

/**
 * The worked CEL example the raw editor teaches, one clause per idea — the
 * source the placeholder is DERIVED from (objectui#9952).
 *
 * ⛔ Not a per-scope table and ⛔ not tagged with the roots each clause uses.
 * Each clause carries its own roots in its own text, and {@link
 * celExampleForRoots} reads them back out with {@link celRootsMentioned}, so a
 * clause cannot claim a root it does not spell.
 */
const CEL_EXAMPLE_CLAUSES = ["record.status != 'done'", 'user.isAdmin'] as const;

/**
 * The placeholder example for a mount that offers `offered` — every clause
 * whose roots that mount actually binds, and no other (objectui#9952).
 *
 * ## The defect this replaces
 *
 * The placeholder was a string literal, `record.status != 'done' &&
 * user.isAdmin`, handed to `CelPredicateField` at EVERY mount, `scope` or no
 * `scope`. So the same component that narrowed a record-scoped mount's
 * autocomplete to {@link RECORD_CONDITION_ROOTS} — withdrawing `user`, because
 * the hosts of a server-evaluated condition bind `record` and `previous` alone
 * — went on teaching `user.isAdmin` there, in the one line an author reads
 * BEFORE typing anything. `conditionScope.ts` carries that binding in its own
 * words for both such hosts (hook and validation rule), and the hook wrapper's
 * own docblock in objectstack (`wrapDeclarativeHook`) says the condition
 * formula is evaluated against two bindings, `record` and `previous`. An
 * unevaluable predicate is fail-LOUD at the hook host and fail-CLOSED at the
 * validation one, so the copied root costs the author the write either way.
 *
 * ## Why a derivation, and not a second literal per scope
 *
 * A second hand-maintained list is exactly how the autocomplete
 * (objectui#9645), the subject dropdown (objectui#9855) and this placeholder
 * got out of step: three controls, three literals, edited one at a time. This
 * has no list to keep in step. A clause survives only when every root it
 * SPELLS is in the offered set, so a clause that references an unoffered root
 * disappears rather than mis-teaching it — and the offered set handed here is
 * the very value forwarded to the autocomplete, read once at the mount.
 *
 * ## `undefined` is the unchanged case, deliberately
 *
 * `undefined` means the mount forwards no narrowing and inherits the engine's
 * own advertisement, which carries `user` — so every clause survives and such a
 * mount's placeholder is what it always was, byte for byte. `roots` narrows
 * SUGGESTIONS only, so this narrows TEACHING only: no accept set moves, and no
 * mount loses a subject it could build a row with.
 *
 * An offered set that leaves no clause standing yields the empty string — no
 * example rather than a false one. `ConditionBuilder.placeholderRoots.test.tsx`
 * re-derives all of this from the offered set instead of restating it.
 */
export function celExampleForRoots(offered: readonly string[] | undefined): string {
  const clauses = offered
    ? CEL_EXAMPLE_CLAUSES.filter((c) => celRootsMentioned(c).every((r) => offered.includes(r)))
    : [...CEL_EXAMPLE_CLAUSES];
  return clauses.join(' && ');
}

/**
 * Context subjects for a mount whose condition is evaluated by a SERVER host
 * that binds `record` and `previous` alone (objectui#9855).
 *
 * The dropdown's mirror of {@link RECORD_CONDITION_ROOTS} — same ruling, the
 * other door. That list narrows what the raw editor's autocomplete OFFERS at
 * such a mount; this one narrows what the row builder's subject dropdown
 * offers, which is the control an author actually builds rows with.
 *
 * ## Why this is DECLARED by the mount, never defaulted
 *
 * ⛔ It is deliberately not the component's default, and ⛔ it is not derived
 * from `scope === 'record'`. That test does not separate the hosts: the action
 * `visible` / `disabled` mounts declare `scope="record"` and are evaluated in
 * the BROWSER, where `buildExpressionScope` really does bind `user` — so
 * defaulting to this list would take a working subject away from them.
 * `scope` is a claim about how the CEL is LINTED; it is not a claim about what
 * the host binds. `CONDITION_SCOPE_BY_METADATA_TYPE` (`conditionScope.ts`)
 * makes the same distinction for the same reason.
 *
 * ## The two hosts this list is measured against
 *
 * Both were read at source in objectstack, and both bind exactly two names:
 *
 *  - a hook `condition` — `wrapDeclarativeHook` (`hook-wrappers.ts`) evaluates
 *    it against `{ record, previous }`, and an unevaluable one throws
 *    `HookConditionError` rather than resolving false.
 *  - an object validation rule's guard — `checkPredicate` / `checkConditional`
 *    (`validation/rule-validator.ts`) evaluate `condition` / `when` against
 *    `{ record, previous }`, fail-CLOSED. `conditionScope.ts` carries the same
 *    ruling in its `validation` row.
 *
 * `previous` is bound at both and is reachable through
 * {@link ConditionSubjectVocabulary.includePrevious}, which is a separate knob
 * a mount opts into — so it is deliberately not folded in here.
 */
export const RECORD_CONDITION_SUBJECTS: ReadonlyArray<{ value: string; label?: string }> = [
  { value: 'record.id', label: 'record.id' },
];

/**
 * Quote a raw value for CEL unless it is a number / boolean / null — or a
 * reference (objectui#6293).
 *
 * Quoting a reference was silent in both directions: `previous ==
 * 'previous.status'` is valid CEL, `previous` is a declared root, and a string
 * literal's contents are deliberately not scanned for references by
 * `flow-ref-check` or by the server-side validator — so the predicate parsed,
 * registered, evaluated, and was always false, with no author-time signal at
 * any layer. Emitting the reference is also what makes it CHECKABLE: it is now
 * an identifier those existing checkers can see.
 */
function fmtValue(v: string, quote: Quote = "'"): string {
  const t = v.trim();
  if (t === 'true' || t === 'false' || t === 'null') return t;
  if (t !== '' && !Number.isNaN(Number(t))) return t;
  if (REFERENCE_RE.test(t)) return t;
  // `quote` defaults to the single quote this function has always emitted, so
  // a row the author built here — and every row parsed from single-quoted CEL
  // — is byte-for-byte what it was before `88b15fddc`. Only a row parsed
  // from a DOUBLE-quoted literal carries `"`, and those did not reach row mode
  // at all until this change.
  const esc = quote === "'" ? t.replace(/'/g, "\\'") : t.replace(/"/g, '\\"');
  return `${quote}${esc}${quote}`;
}

/**
 * Inverse of fmtValue for display in the value input. A bare reference has no
 * quotes to strip and passes through unchanged, which is what keeps an emitted
 * `previous == previous.status` round-tripping back into the row builder.
 */
function unfmtValue(raw: string): { value: string; quote?: Quote } {
  const t = raw.trim();
  const sq = /^'(.*)'$/.exec(t);
  if (sq) return { value: sq[1].replace(/\\'/g, "'"), quote: "'" };
  // Double-quoted literals are the spelling every shipped flow-entry condition
  // uses, and the field's own placeholder teaches. Stripping only single
  // quotes while re-emitting only single quotes meant they could never
  // round-trip, so they were handed to the raw editor (`88b15fddc`).
  const dq = /^"(.*)"$/.exec(t);
  if (dq) return { value: dq[1].replace(/\\"/g, '"'), quote: '"' };
  return { value: t };
}

/**
 * The clauses of a null-or-empty check on `subject`, by the row of the ruled
 * 「is empty」 table its field takes (objectui#11894): `empty` ⇒ the clauses
 * of "is empty", OR-joined; otherwise those of "is not empty", AND-joined —
 * the exact complement.
 *
 * - `null_only` — null only: `S == null`.
 * - `text` — null or `''`.
 * - `multi_value` — null or an empty list: `size(S) == 0`.
 *
 * `== null` and not `has()`: the server evaluates a validation rule or a hook
 * condition against a record whose DECLARED fields are all present (a field
 * with no value holds `null`), so `has()` is true for an empty field — the
 * platform's own contract tests emptiness with `!= null` and keeps `has()` for
 * an undeclared key. Each clause is well typed for every value it can meet:
 * CEL's `==` against `null` or `''` is false across types rather than a fault,
 * and `size()` is reached only past the null clause.
 */
function emptyCheckClauses(subject: string, arm: EmptyOperatorArm, empty: boolean): string[] {
  const nullClause = `${subject} ${empty ? '==' : '!='} null`;
  if (arm === 'text') return [nullClause, `${subject} ${empty ? '==' : '!='} ''`];
  if (arm === 'multi_value') return [nullClause, `size(${subject}) ${empty ? '==' : '!='} 0`];
  return [nullClause];
}

/** One row's CEL, and whether it is more than one clause — such a row is
 *  parenthesised when it is joined with others. */
function compileRow(r: Row, valueOf: SubjectValueOf): { cel: string; compound: boolean } {
  if (r.op === 'truthy' || r.op === 'falsy') {
    const declared = valueOf(r.subject);
    // A boolean compiles as it always did, and so does an undeclared subject:
    // nothing here says which check it needs, and a guessed one is worse than
    // the form the author can read in the compiled line below the rows.
    if (declared === undefined || declared === 'boolean') {
      return { cel: r.op === 'truthy' ? r.subject : `!${r.subject}`, compound: false };
    }
    // Any other declared field: `!S` and a bare `S` are not well typed —
    // CEL's `!` and a bare `&&` operand take a bool, so a date, text or lookup
    // field faults (`no such overload: !null` / `!string`) and the server
    // refuses the write. A null-or-empty check is well typed for every value.
    const empty = r.op === 'falsy';
    const clauses = emptyCheckClauses(r.subject, declared, empty);
    return { cel: clauses.join(empty ? ' || ' : ' && '), compound: clauses.length > 1 };
  }
  return { cel: `${r.subject} ${r.op} ${fmtValue(r.value, r.quote)}`, compound: false };
}

/** Compile rows → CEL. Rows without a subject are skipped (in-progress). */
function compile(rows: Row[], join: '&&' | '||', valueOf: SubjectValueOf = NOTHING_DECLARED): string {
  const terms = rows.filter((r) => r.subject).map((r) => compileRow(r, valueOf));
  return terms
    .map((term) => (term.compound && terms.length > 1 ? `(${term.cel})` : term.cel))
    .join(` ${join} `);
}

/**
 * Walk `s` outside its string literals, handing each character and the
 * parenthesis depth it sits at to `visit`; `visit` returning `false` stops the
 * walk. Returns `false` when the quotes or parentheses do not balance.
 */
function walkCode(s: string, visit: (i: number, depth: number) => boolean | void): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '(') depth++;
    if (visit(i, depth) === false) return true;
    if (c === ')' && --depth < 0) return false;
  }
  return quote === null && depth === 0;
}

/**
 * Split at the AND/OR joins that sit outside parentheses and string literals.
 * `null` for mixed joins, or for text whose quotes or parentheses do not
 * balance — neither is a shape the rows can hold.
 */
function splitTopLevel(s: string): { parts: string[]; join: '&&' | '||' } | null {
  const parts: string[] = [];
  let join: '&&' | '||' | null = null;
  let start = 0;
  let mixed = false;
  const balanced = walkCode(s, (i, depth) => {
    if (depth !== 0) return;
    const two = s.slice(i, i + 2);
    if (two !== '&&' && two !== '||') return;
    if (join && join !== two) { mixed = true; return false; }
    join = two;
    parts.push(s.slice(start, i).trim());
    start = i + 2;
  });
  if (mixed || !balanced) return null;
  parts.push(s.slice(start).trim());
  return { parts, join: join ?? '&&' };
}

/** The inside of `(…)` when one pair of parentheses encloses all of `p`. */
function enclosedGroup(p: string): string | null {
  if (!p.startsWith('(') || !p.endsWith(')')) return null;
  let whole = true;
  walkCode(p, (i, depth) => {
    if (p[i] === ')' && depth === 1 && i !== p.length - 1) { whole = false; return false; }
  });
  return whole ? p.slice(1, -1).trim() : null;
}

/**
 * Read `text` back as the null-or-empty check row it compiles from, or `null`
 * (objectui#11894). Recognised by compiling the candidate row for the
 * subject's DECLARED value and comparing, so it accepts exactly the emitted
 * text: a check on an undeclared or boolean subject, or one spelled for a
 * different row of the table than the field takes, is not this row.
 */
function parseEmptyCheck(text: string, valueOf: SubjectValueOf): Row | null {
  const head = /^([a-zA-Z_][\w.]*)\s*(==|!=)\s*null\b/.exec(text);
  if (!head) return null;
  const declared = valueOf(head[1]);
  if (declared === undefined || declared === 'boolean') return null;
  const row: Row = { subject: head[1], op: head[2] === '==' ? 'falsy' : 'truthy', value: '' };
  return compileRow(row, valueOf).cel === text ? row : null;
}

/** Read one AND/OR term back as a row, or `null` when it is not a row's shape. */
function parseTerm(p: string, valueOf: SubjectValueOf): Row | null {
  const group = enclosedGroup(p);
  if (group !== null) return parseEmptyCheck(group, valueOf);
  const check = parseEmptyCheck(p, valueOf);
  if (check) return check;
  const cmp = /^([a-zA-Z_][\w.]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(p);
  if (cmp) {
    const v = unfmtValue(cmp[3]);
    return { subject: cmp[1], op: cmp[2] as Op, value: v.value, quote: v.quote };
  }
  const neg = /^!\s*([a-zA-Z_][\w.]*)$/.exec(p);
  if (neg) return { subject: neg[1], op: 'falsy', value: '' };
  const truthy = /^([a-zA-Z_][\w.]*)$/.exec(p);
  if (truthy) return { subject: truthy[1], op: 'truthy', value: '' };
  return null; // unrecognised term
}

/** Parse a simple AND/OR predicate. Returns null if it isn't the simple shape. */
function parse(
  expr: string,
  valueOf: SubjectValueOf = NOTHING_DECLARED,
): { rows: Row[]; join: '&&' | '||' } | null {
  const s = norm(expr);
  if (!s) return { rows: [], join: '&&' };
  // A lone row whose check is several clauses compiles without parentheses,
  // so the whole text is tried as that one row before it is split.
  const whole = parseEmptyCheck(s, valueOf);
  if (whole) return { rows: [whole], join: '&&' };
  const split = splitTopLevel(s);
  if (!split) return null;
  const rows: Row[] = [];
  for (const p of split.parts) {
    const row = parseTerm(p, valueOf);
    if (!row) return null;
    rows.push(row);
  }
  return { rows, join: split.join };
}

/**
 * Rows for `value` when it round-trips under what the catalog declares, else
 * the raw editor. `!record.due_date` on a date field reads as an "is empty"
 * row that now compiles to `record.due_date == null`; that is not the text the
 * author stored, so it opens in the raw editor verbatim rather than being
 * rewritten on their next edit (objectui#11894) — the rule this component's
 * header states for every expression it cannot reproduce.
 */
function initFrom(value: string, valueOf: SubjectValueOf): { rows: Row[]; join: '&&' | '||'; raw: boolean } {
  const p = parse(value || '', valueOf);
  if (p && norm(compile(p.rows, p.join, valueOf)) === norm(value || '')) {
    return { rows: p.rows, join: p.join, raw: false };
  }
  return { rows: [], join: '&&', raw: !!value };
}

export function ConditionBuilder({ label, value, onCommit, objectName, fields: fieldsProp, disabled, onBlockingIssuesChange, subjects, scope, roots, scopeIssue }: {
  label?: string;
  value: string;
  onCommit: (cel: string) => void;
  objectName?: string;
  /** Pre-fetched field catalog (e.g. from the generic form's widget context);
   *  when omitted, fields are loaded from `objectName`. A field's `type` (and
   *  `multiple`) is what words and compiles its value-less operators
   *  (objectui#11894); a field without one keeps the untyped pair. */
  fields?: ReadonlyArray<CatalogField>;
  disabled?: boolean;
  /**
   * Report how many BLOCKING author-time issues this editor is showing — a CEL
   * predicate that does not parse (objectui#4527). The inspector above
   * aggregates these and hands the total to the host through
   * `MetadataInspectorProps.onBlockingIssuesChange`, because the Save button
   * belongs to the host, not here.
   *
   * Optional: mount sites with no Save to gate simply omit it. Fires whenever
   * the aggregate changes, `0` when everything is clean.
   */
  onBlockingIssuesChange?: (count: number) => void;
  /**
   * What this mount site's subjects are called (`88b15fddc`). Omit for the
   * record-scoped default every existing consumer relies on.
   */
  subjects?: ConditionSubjectVocabulary;
  /**
   * Evaluation scope the raw-expression editor lints and completes against
   * (objectui#8167) — forwarded verbatim to `CelPredicateField`, which mirrors
   * `CelSchemaHint.scope`.
   *
   * ## Why this had to become a prop
   *
   * It was not one. Every mount ran the `celAuthoring` default, whose own
   * spelling is `hint.scope ?? 'flattened'`, and no caller could say otherwise
   * — so a bare `status == 'done'` typed into an action's **Visible when**
   * linted CLEAN. It never matches: `usePredicateRecordContext` binds `record`
   * and nothing else, and Phase 2 (`83fe6e741`) retired the bare shorthand on
   * runtime record surfaces. The row-predicate canon in `@object-ui/core`
   * (`rowPredicateCanon.ts`) names an action renderer's `visible` / `disabled`
   * as such a surface in its own words. That is objectui#7727's defect, at a
   * component objectui#7727 does not touch.
   *
   * ## Undefined is the default, and that is deliberate
   *
   * Omitting it forwards `undefined`, so the engine hint stays exactly what it
   * was and every mount that passes nothing is unchanged byte for byte. In
   * particular this does **not** derive the scope from
   * {@link ConditionSubjectVocabulary.fieldPrefix}: that would silently flip
   * every record-prefixed mount, including the three whose tier is still an
   * open question (the page-block, hook and schema-driven `ConditionWidget`
   * sites — see objectui#8167). Deriving a verdict is the same thing as
   * making one, and those are not this component's to make.
   *
   * ## It governs the RAW editor only
   *
   * The row builder compiles subjects itself from `fieldPrefix`, so passing
   * `'record'` does not move a single emitted byte — it makes the raw editor
   * agree with the rows the builder was already emitting at that mount, which
   * before this prop existed it did not.
   */
  scope?: 'record' | 'flattened';
  /**
   * Scope roots the raw editor's autocomplete OFFERS (objectui#9645) —
   * forwarded to `CelPredicateField`, which mirrors `CelSchemaHint.roots`.
   *
   * Declared, not inferred, for the reason {@link RECORD_CONDITION_ROOTS}
   * states: only the mount knows what its own host binds. Omitting it leaves a
   * `scope="record"` mount with that list — the roots every host of a
   * record-scoped condition binds — and leaves a mount that declares no
   * `scope` with the engine's own advertisement, unchanged.
   *
   * It governs SUGGESTIONS only. The accept set is the engine's `SCOPE_ROOTS`,
   * so a root left off this list still lints clean when an author types it,
   * and a mount whose host binds more than the default loses an offer rather
   * than a spelling.
   */
  roots?: string[];
  /**
   * The host's scope verdict on `value` found a problem it renders itself
   * (objectui#11789) — forwarded to `CelPredicateField`, which then withholds
   * "Valid CEL" so the raw editor and the host's note cannot disagree. The row
   * builder renders no verdict of its own, so it does not read this.
   */
  scopeIssue?: boolean;
}) {
  const { fields: hookFields } = useObjectFields(objectName);
  const fields = fieldsProp ?? hookFields;
  const fieldPrefix = subjects?.fieldPrefix ?? 'record.';
  const includePrevious = subjects?.includePrevious ?? false;
  const contextSubjects = subjects?.context ?? CONTEXT_SUBJECTS;
  /**
   * The scope roots THIS mount offers — read once, because two controls answer
   * to it (objectui#9952).
   *
   * `undefined` is a real value here and not a missing one: it means the mount
   * declared no narrowing, so the autocomplete inherits the engine's own
   * advertisement and the placeholder teaches its whole example, both unchanged.
   */
  const offeredRoots = roots ?? (scope === 'record' ? RECORD_CONDITION_ROOTS : undefined);
  const subjectOptions = React.useMemo(() => {
    const visible = fields.filter((f) => !f.hidden);
    const fieldOpts = visible.map((f) => ({
      value: `${fieldPrefix}${f.name}`,
      label: `${fieldPrefix}${f.name}`,
    }));
    // The whole-record `previous` comes first: `previous == null` is how an
    // author branches on the create leg of a create-or-update trigger, and it
    // reads as the head of the group rather than as one more field.
    const previousOpts = includePrevious
      ? [
          { value: 'previous', label: 'previous' },
          ...visible.map((f) => ({ value: `previous.${f.name}`, label: `previous.${f.name}` })),
        ]
      : [];
    const contextOpts = contextSubjects.map((c) => ({ value: c.value, label: c.label ?? c.value }));
    return [...fieldOpts, ...previousOpts, ...contextOpts];
  }, [fields, fieldPrefix, includePrevious, contextSubjects]);
  // The raw-expression editor's CEL assists (#1582): field-existence lint +
  // autocomplete need the bare field-name catalog and a locale-bound `t`.
  const locale = useMetadataLocale();
  const tLocal = React.useCallback((k: string) => t(k, locale), [locale]);
  const fieldNames = React.useMemo(
    () => fields.filter((f) => !f.hidden).map((f) => f.name),
    [fields],
  );
  /**
   * What the catalog declares about each subject (objectui#11894), and the
   * same answer as a string. The re-read below keys on the STRING, never on
   * the memoised map's identity (AGENTS.md #10).
   */
  const subjectValues = React.useMemo(
    () => declaredSubjectValues(fields, fieldPrefix, includePrevious),
    [fields, fieldPrefix, includePrevious],
  );
  const valueOf: SubjectValueOf = (subject) => subjectValues.get(subject);
  const declaredKey = [...subjectValues].map(([s, v]) => `${s}=${v}`).sort().join('|');
  // Held in a ref so the effects below read this render's catalog without
  // listing a function that is new every render.
  const valueOfRef = React.useRef(valueOf);
  React.useEffect(() => {
    valueOfRef.current = valueOf;
  });

  const init = React.useMemo(() => initFrom(value, valueOf), []); // first mount only
  const [rows, setRowsState] = React.useState<Row[]>(init.rows);
  const [join, setJoin] = React.useState<'&&' | '||'>(init.join);
  const [raw, setRaw] = React.useState<boolean>(init.raw);
  /** The author has edited since the value was last read into rows. */
  const editedSinceRead = React.useRef(false);

  // Adopt an externally-changed value (e.g. switching records, or a raw edit
  // from elsewhere) when it isn't the CEL we just emitted.
  const lastEmitted = React.useRef<string>(value || '');
  React.useEffect(() => {
    const v = value || '';
    if (v === lastEmitted.current) return;
    lastEmitted.current = v;
    editedSinceRead.current = false;
    const next = initFrom(v, valueOfRef.current);
    setRowsState(next.rows);
    setJoin(next.join);
    setRaw(next.raw);
  }, [value]);

  // Re-read the value when what the catalog declares changes — above all when
  // a catalog fetched by `objectName` lands after the first render, which read
  // every subject as undeclared (objectui#11894). Without this, how a stored
  // condition opens would turn on network timing: a row built here as "is
  // empty" on a text field would reopen in the raw editor at every mount that
  // fetches its catalog, and a stored `!record.due_date` would open as a row
  // there but in the raw editor at a mount handed its fields. Only while the
  // author has not edited since the last read: after an edit the rows are
  // theirs, including a row they have not given a subject yet.
  const readDeclaredKey = React.useRef(declaredKey);
  React.useEffect(() => {
    if (readDeclaredKey.current === declaredKey) return;
    readDeclaredKey.current = declaredKey;
    if (editedSinceRead.current) return;
    const next = initFrom(lastEmitted.current, valueOfRef.current);
    setRowsState(next.rows);
    setJoin(next.join);
    setRaw(next.raw);
  }, [declaredKey]);

  const emit = (nextRows: Row[], nextJoin: '&&' | '||') => {
    const cel = compile(nextRows, nextJoin, valueOf);
    lastEmitted.current = cel;
    onCommit(cel);
  };
  const update = (nextRows: Row[], nextJoin: '&&' | '||' = join) => {
    editedSinceRead.current = true;
    setRowsState(nextRows);
    setJoin(nextJoin);
    emit(nextRows, nextJoin);
  };

  /* ─── Blocking CEL verdicts → the inspector's aggregate (objectui#4527) ───
   *
   * The raw-expression editor is this component's ONLY CEL site — the row
   * builder compiles rows itself and mounts no `CelPredicateField` — so the
   * aggregate is that one editor's error count, DERIVED against the mode
   * rather than repaired by a reset effect.
   *
   * Deriving is what prevents the wedge. The raw editor exists only while
   * `raw` is true, and it can vanish while its last verdict was "1 error":
   * the adopt effect above flips `raw` false in the same commit when an
   * externally-changed value round-trips as a simple predicate, which
   * unmounts the editor and cancels its pending debounced lint. Nothing will
   * ever report `0` for it again, so a remembered count would hold Save shut
   * with no editor left on screen to fix it. */
  const [celErrors, setCelErrors] = React.useState(0);
  const reportCel = React.useCallback((issues: CelLintIssue[]) => {
    // Only `error` blocks Save; `warning` is advisory (typo / blast-radius),
    // matching the RLS editor and objectui#4306.
    const errs = issues.filter((i) => i.severity === 'error').length;
    setCelErrors((prev) => (prev === errs ? prev : errs));
  }, []);
  const blockingIssues = raw ? celErrors : 0;
  // Held in a ref so an unmemoized parent callback cannot re-fire the effect.
  const onBlockingIssuesChangeRef = React.useRef(onBlockingIssuesChange);
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current = onBlockingIssuesChange;
  });
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current?.(blockingIssues);
  }, [blockingIssues]);

  const compiled = compile(rows, join, valueOf);

  if (raw) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          {label ? <Label className="text-xs text-muted-foreground">{label}</Label> : <span />}
          <button type="button" disabled={disabled}
            onClick={() => { const n = initFrom(value, valueOf); if (!value || !n.raw) { editedSinceRead.current = false; setRowsState(n.rows); setJoin(n.join); setRaw(false); } }}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50">
            <ListFilter className="h-3 w-3" /> {tLocal('engine.inspector.condition.builder')}
          </button>
        </div>
        {/* CEL editor with inline lint + field autocomplete (#1582) — the same
            author-time assists the RLS policy editor gets, on the canonical
            @objectstack/formula engine. Replaces the bare <textarea>. */}
        <CelPredicateField
          label={tLocal('engine.condition.celLabel')}
          value={value}
          onChange={(v) => { lastEmitted.current = v; editedSinceRead.current = true; onCommit(v); }}
          onLintChange={reportCel}
          disabled={disabled}
          /* objectui#9952 — DERIVED from the same offered set the autocomplete
             gets, so the example cannot teach a root this mount does not offer.
             It was a literal, and taught `user.isAdmin` at a record-scoped
             mount where objectui#9645 had already stopped offering `user` and
             the server host never binds it. See `celExampleForRoots`. */
          placeholder={celExampleForRoots(offeredRoots)}
          objectName={objectName}
          fieldNames={fieldNames}
          /* Forwarded verbatim, `undefined` included — see the `scope` prop's
             own note. An omitted scope must reach `celAuthoring` as absent so
             its `hint.scope ?? 'flattened'` default answers unchanged. */
          scope={scope}
          /* objectui#9645 — a record-scoped mount advertises the roots its
             host actually binds, not the engine's whole default list. A mount
             that binds more declares it; see `RECORD_CONDITION_ROOTS`. A mount
             with no `scope` still forwards `undefined` here, so its offered
             roots are the engine's own, unchanged. */
          roots={offeredRoots}
          scopeIssue={scopeIssue}
          t={tLocal}
        />
        {value && !parse(value, valueOf) && (
          <div className="text-[10px] text-muted-foreground/70">{tLocal('engine.condition.advancedHint')}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        {label ? <Label className="text-xs text-muted-foreground">{label}</Label> : <span />}
        <button type="button" disabled={disabled} onClick={() => setRaw(true)}
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50">
          <Code2 className="h-3 w-3" /> {tLocal('engine.inspector.condition.expression')}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-center text-[11px] text-muted-foreground">{tLocal('engine.inspector.condition.always')}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="space-y-1 rounded-md border border-border p-1.5">
              {i > 0 && (
                <div className="flex justify-center">
                  <Select value={join} onValueChange={(v) => update(rows, v as '&&' | '||')} disabled={disabled}>
                    <SelectTrigger className="h-6 w-16 text-[10px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="&&">{tLocal('engine.inspector.condition.and')}</SelectItem>
                      <SelectItem value="||">{tLocal('engine.inspector.condition.or')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <Select value={r.subject} onValueChange={(v) => update(rows.map((x, j) => j === i ? { ...x, subject: v } : x))} disabled={disabled}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={tLocal('engine.inspector.condition.subjectPlaceholder')} /></SelectTrigger>
                    <SelectContent>
                      {subjectOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      {r.subject && !subjectOptions.some((o) => o.value === r.subject) && (
                        <SelectItem value={r.subject}>{r.subject}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={disabled} aria-label={tLocal('engine.inspector.condition.remove')}
                  onClick={() => update(rows.filter((_, j) => j !== i))}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-28 shrink-0">
                  <Select value={r.op} onValueChange={(v) => update(rows.map((x, j) => j === i ? { ...x, op: v as Op } : x))} disabled={disabled}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {opChoicesFor(valueOf(r.subject)).map((o) => <SelectItem key={o.value} value={o.value}>{'symbol' in o ? o.symbol : tLocal(o.labelKey)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {r.op !== 'truthy' && r.op !== 'falsy' && (
                  <Input className="h-7 flex-1 text-xs" value={r.value} placeholder={tLocal('engine.inspector.condition.valuePlaceholder')} disabled={disabled}
                    onChange={(e) => update(rows.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* objectui#11894 — a new row starts on `equals`, an operator that
          compiles to well-typed CEL whatever subject is then picked. It
          started on `truthy`, so a row whose operator the author never
          touched compiled to the bare subject — not a bool on a date, text
          or lookup field. */}
      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={() => update([...rows, { subject: '', op: '==', value: '' }])}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {tLocal('engine.inspector.condition.add')}
        </Button>
      )}

      {compiled && (
        <div className="rounded bg-muted/40 px-2 py-1 text-[10px] font-mono text-muted-foreground break-all">{compiled}</div>
      )}
    </div>
  );
}
