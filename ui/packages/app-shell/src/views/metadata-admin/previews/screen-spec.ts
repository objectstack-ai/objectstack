// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * screen-spec — pure helpers that map a flow `screen` node's authored `config`
 * onto the runtime `ScreenSpec` (the contract {@link ScreenView} renders), plus
 * `{{ }}` hole rendering for the title/description and the Studio's diagnostics
 * for a field's `visibleWhen`. Kept framework-free so {@link ScreenPreview}
 * stays a thin component and these stay unit-testable.
 *
 * ## One client evaluator for `visibleWhen` (objectui#10743)
 *
 * A screen field's `visibleWhen` is bare CEL over the screen's own declared
 * fields plus the values being collected — the spec's `ScreenFieldSpec.visibleWhen`
 * docblock: "evaluated by the CLIENT against the screen's live collected
 * values — not by the server". The Studio therefore does NOT decide a field's
 * visibility up front. {@link buildScreenSpec} hands the predicate to
 * `ScreenView` raw, and the renderer's `visibleScreenFields` /
 * `screenPredicateScope` decide it live as the author ticks and types into the
 * preview — the same code path that decides it for the end user in the flow
 * runner. There is no second copy of that evaluation in this module.
 *
 * Before objectui#10743 this module judged each predicate once, at the pause,
 * against the run's variables (the reading the runtime's resume door takes),
 * dropped every field it judged hidden and stripped the predicate from the
 * rest. A predicate over a sibling screen field — the only shape any shipped
 * producer writes (`createOpportunity == true`, `discount > 0`) — names a value
 * the run does not hold at the pause, so the field was judged hidden and stayed
 * hidden however the author ticked or typed: the "frozen visible-or-hidden for
 * the life of the screen" outcome the runtime's `screen` executor forwards the
 * predicate raw to avoid.
 *
 * What this module still judges is the SCOPE, never the value:
 * {@link screenVisibleWhenScopeError} names a predicate the screen renderer
 * cannot bind — one that references an identifier that is not a field declared
 * on this screen, or one whose shape `registerFlow` refuses — and
 * {@link unevaluableVisibleWhen} lists the fields it applies to, so the Debug
 * run's screen step and the Problems panel (`flow-expr-problems.ts`) can say so
 * from ONE rule. Whether a faulting predicate shows or hides its field is the
 * renderer's fallback and objectui#8069's question; the Studio renders through
 * that renderer and states no direction of its own.
 *
 * ⚠️ The server's resume door (`refuseInvalidScreenInput` in
 * `@objectstack/service-automation`) still evaluates `visibleWhen` over the
 * run's variables with the submitted values layered on top until
 * objectstack#20178 lands. That is the divergence objectui#10743 measured; it is
 * to be closed on the server side, not by widening the client's scope.
 */

import { collectCelRootIdentifiers, nearestName, parseCelToAst, validateExpression } from '@objectstack/formula';
import { predicateSlotRefusal } from '@objectstack/spec/automation';
import { tFormat } from '../i18n.js';
import {
  screenFields,
  screenPredicateScope,
  visibleScreenFields,
  type ScreenFieldSpec,
  type ScreenSpec,
} from '../../ScreenView.js';

/** Minimal node shape the preview needs (id + authored config). */
export interface ScreenPreviewNode {
  id: string;
  label?: string;
  config?: Record<string, unknown>;
}

/**
 * One `{…}` template reference: the token the engine's `interpolateString`
 * resolves in a field's `defaultValue` when a screen pauses.
 * {@link defaultValueTemplates} only DETECTS one (it never substitutes it).
 * The title and description are flow text slots and read `{{ }}` holes
 * instead ({@link interpolateHoles}, objectui#11824).
 */
const TEMPLATE_TOKEN = /\{([^{}]+)\}/g;

/** One ADR-0032 §3 hole: a variable path, then an optional `| formatter`. */
const HOLE_TOKEN = /\{\{([^{}]*)\}\}/g;

/**
 * Render the `{{ }}` holes of a screen `title` / `description` — flow text
 * slots, which the engine renders as ADR-0032 §3 templates and where the spec
 * refuses a single-brace `{…}` token (objectui#11824). A hole whose variable
 * path resolves in `vars` (dotted segments walk nested values) is replaced by
 * the value; a `| formatter` is not modelled, so the raw value is shown. An
 * unresolved hole stays literal, so the author still sees the dependency, and
 * a single-brace token is left exactly as written: it is no placeholder there.
 */
export function interpolateHoles(text: string | undefined, vars: Record<string, unknown> | undefined): string {
  if (!text) return '';
  if (!vars) return text;
  return text.replace(HOLE_TOKEN, (m, inner: string) => {
    const path = inner.split('|')[0].trim();
    if (!path) return m;
    let v: unknown = vars;
    for (const segment of path.split('.')) {
      if (v === null || typeof v !== 'object' || !(segment in (v as Record<string, unknown>))) return m;
      v = (v as Record<string, unknown>)[segment];
    }
    return v === undefined || v === null ? m : String(v);
  });
}

/**
 * The namespace `ScreenView`'s evaluator binds the collected values under
 * beside their bare names: `evalFieldPredicate(pred, scope, true, undefined,
 * scope)` hands the scope to the engine as `record` AND as the bare `extra`
 * roots, so `record.discount` resolves exactly as `discount` does. That
 * binding happens inside `evalFieldPredicate`, not in `screenPredicateScope`,
 * which is why the name is restated here rather than read off the scope; the
 * bare names ARE read off it ({@link screenPredicateRoots}). The runner binds
 * no `previous`, so it is not admitted here either.
 */
const RECORD_ROOT = 'record';

/**
 * The roots a screen field's `visibleWhen` may reference: every field declared
 * on this screen, bare — the keys of the renderer's own predicate scope,
 * `screenPredicateScope(spec, {})`, so a field the renderer seeds is a field
 * the diagnostics accept — plus {@link RECORD_ROOT}. The ONE rule the Debug
 * run's screen step and the Problems panel both judge against (objectui#10743).
 */
export function screenPredicateRoots(node: ScreenPreviewNode): Set<string> {
  return new Set([...Object.keys(screenPredicateScope(buildScreenSpec(node), {})), RECORD_ROOT]);
}

/**
 * CEL's comprehension macros. Their first argument declares an iteration
 * variable that is bound inside the macro's body — `["a","b"].exists(t, t ==
 * note)` binds `t` — and is not a reference to anything outside it.
 */
const CEL_COMPREHENSION_MACROS: ReadonlySet<string> = new Set(['all', 'exists', 'exists_one', 'map', 'filter']);

/** The parsed-AST node shape `parseCelToAst` hands back: an `op` and its `args`. */
interface CelNode {
  op: string;
  args: unknown;
}

function isCelNode(v: unknown): v is CelNode {
  return !!v && typeof v === 'object' && typeof (v as CelNode).op === 'string';
}

/**
 * The FREE root identifiers of a parsed predicate: every `id` node that is not
 * bound by an enclosing comprehension macro. `collectCelRootIdentifiers` reports
 * a macro's iteration variable as a root (`t` in `["a","b"].exists(t, t ==
 * note)`), which the runner then evaluates fine — so it was false-reported as
 * "not a field on this screen". Walked over the same canonical AST
 * (`parseCelToAst`), with the binding scoped to the macro's own arguments: an
 * outer bare `t` in `t == 1 && ["a"].exists(t, t == note)` is still a root.
 *
 * Shape read: `rcall` is a receiver-style call `[name, receiver, [args…]]`,
 * `call` a plain call `[name, [args…]]`, `.` a member access `[object, name]`;
 * every other op carries its operands in `args`. Strings inside `args` are
 * names, never identifiers, and are skipped.
 */
function collectFreeRoots(node: unknown, bound: ReadonlySet<string>, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectFreeRoots(n, bound, out);
    return;
  }
  if (!isCelNode(node)) return;
  if (node.op === 'id') {
    if (typeof node.args === 'string' && !bound.has(node.args)) out.add(node.args);
    return;
  }
  if (node.op === 'rcall' && Array.isArray(node.args)) {
    const [macro, receiver, rest] = node.args as [unknown, unknown, unknown];
    collectFreeRoots(receiver, bound, out);
    if (
      typeof macro === 'string' &&
      CEL_COMPREHENSION_MACROS.has(macro) &&
      Array.isArray(rest) &&
      isCelNode(rest[0]) &&
      rest[0].op === 'id' &&
      typeof rest[0].args === 'string'
    ) {
      const inner = new Set(bound);
      inner.add(rest[0].args);
      collectFreeRoots(rest.slice(1), inner, out);
      return;
    }
    collectFreeRoots(rest, bound, out);
    return;
  }
  collectFreeRoots(node.args, bound, out);
}

/**
 * The root identifiers a predicate references, comprehension variables
 * excluded. Falls back to `collectCelRootIdentifiers` — which reports them —
 * when the canonical parse hands back no AST, so an unexpected shape is never
 * read as "no roots".
 */
function predicateRoots(source: string): { ok: true; roots: string[] } | { ok: false; error: string } {
  const ast = parseCelToAst(source);
  if (ast) {
    const out = new Set<string>();
    collectFreeRoots(ast, new Set(), out);
    return { ok: true, roots: [...out] };
  }
  return collectCelRootIdentifiers(source);
}

/**
 * Why the screen renderer cannot evaluate one `visibleWhen`, or `undefined`
 * when it can: the predicate is absent or blank (no predicate — the installed
 * spec admits a blank one and the field is then always shown), or every root it
 * names is declared on this screen.
 *
 * Judged in the order `registerFlow` judges the slot, minus the evaluation:
 * the spec's shape refusal (a non-string), the CEL parse (`validateExpression`,
 * which refuses a `{var}` brace — the brace trap in a bare-CEL slot), then the
 * roots against {@link screenPredicateRoots}. A root that is not a declared
 * field is named, with the nearest declared field when one is close
 * (`dicount` → `discount`). A predicate over a sibling field (`discount > 0`,
 * `record.discount > 0`) is fine; one over a name the renderer never binds — a
 * run variable such as `needsApproval`, the runtime's `vars` root — is not.
 *
 * The undeclared-root sentence reads the designer catalogue
 * (`engine.flowRef.notAScreenField*`) in the `locale` the caller passes, as
 * `describeUnknownRefs` does; an absent locale reads the en rows, which carry
 * the English this function wrote before (objectui#10804). The shape and parse
 * refusals are `@objectstack/spec`'s and `@objectstack/formula`'s own words and
 * pass through as they are, in every locale.
 */
export function screenVisibleWhenScopeError(
  visibleWhen: unknown,
  node: ScreenPreviewNode,
  locale?: string,
): string | undefined {
  if (visibleWhen === undefined || visibleWhen === null) return undefined;
  if (typeof visibleWhen === 'string' && !visibleWhen.trim()) return undefined;
  const shape = predicateSlotRefusal(visibleWhen);
  if (shape) return shape.message;
  const source = visibleWhen as string;
  const parsed = validateExpression('predicate', source);
  if (parsed.errors.length > 0) return parsed.errors.map((e) => e.message).join(' ');
  const collected = predicateRoots(source);
  if (!collected.ok) return collected.error;
  const roots = screenPredicateRoots(node);
  const undeclared = collected.roots.filter((r) => !roots.has(r));
  if (undeclared.length === 0) return undefined;
  const declared = screenFields(buildScreenSpec(node)).map((f) => f.name);
  return undeclared
    .map((r) => {
      const near = nearestName(r, declared);
      return near
        ? tFormat('engine.flowRef.notAScreenFieldWithSuggestion', locale, { token: r, suggestion: near })
        : tFormat('engine.flowRef.notAScreenField', locale, { token: r });
    })
    .join('; ');
}

/** One field whose `visibleWhen` the screen renderer cannot evaluate, and why. */
export interface UnevaluableVisibleWhen {
  name: string;
  error: string;
}

/**
 * The authored field rows of a screen whose `visibleWhen` the screen renderer
 * cannot evaluate, with the reason — {@link screenVisibleWhenScopeError} per
 * row, by field name, so the Debug run's screen step can name them
 * (objectui#10743). `locale` is passed through to it, so the reason reads the
 * designer locale the Debug run writes its step in (objectui#10835); absent,
 * it reads the en rows.
 */
export function unevaluableVisibleWhen(node: ScreenPreviewNode, locale?: string): UnevaluableVisibleWhen[] {
  const raw = (node.config as Record<string, unknown> | undefined)?.fields;
  if (!Array.isArray(raw)) return [];
  const out: UnevaluableVisibleWhen[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const row = f as Record<string, unknown>;
    if (typeof row.name !== 'string' || !row.name) continue;
    const error = screenVisibleWhenScopeError(row.visibleWhen, node, locale);
    if (error) out.push({ name: row.name, error });
  }
  return out;
}

/** A string, or nothing. */
function carryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A number, or nothing. */
function carryNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * A select field's choices, when every entry holds the spec's option shape (an
 * object with a string `label`; `value` is `unknown` there). A list with one
 * half-typed entry is not carried at all, as a half-typed key never is.
 */
function carryOptions(value: unknown): ScreenFieldSpec['options'] {
  if (!Array.isArray(value)) return undefined;
  const whole = value.every(
    (o) => !!o && typeof o === 'object' && !Array.isArray(o) && typeof (o as { label?: unknown }).label === 'string',
  );
  return whole ? (value as NonNullable<ScreenFieldSpec['options']>) : undefined;
}

/**
 * How ONE authored row's value is carried onto each `ScreenFieldSpec` key: the
 * value when it holds the type the spec declares, else `undefined`, so a
 * half-typed config row adds nothing.
 */
type ScreenFieldCarry = {
  readonly [K in keyof ScreenFieldSpec]-?: (value: unknown) => ScreenFieldSpec[K] | undefined;
};

/**
 * The projection from an authored `config.fields` row onto the runtime
 * `ScreenFieldSpec`, keyed by EVERY key of the spec's own type (objectui#11190).
 *
 * `ScreenView` reads its fields as `ScreenFieldSpec`, the type re-exported from
 * `@objectstack/spec/contracts`, so it can read no key outside that type.
 * The `-?` in {@link ScreenFieldCarry} makes each of those keys a required
 * entry here: a key the spec adds fails this file's type-check until the
 * projection says how to carry it, and an entry that drops one fails it too.
 * There is no second, hand-kept key list; this table is the only one, and the
 * compiler holds it to the spec's.
 *
 * Every key is carried as the runtime `screen` executor forwards it, with one
 * difference the preview cannot avoid: the executor interpolates `defaultValue`
 * against the run's variables when the screen pauses, and the preview has no
 * run. So `defaultValue` is carried as written, `{…}` references included, and
 * `ScreenPreview` marks each one that holds a reference
 * ({@link defaultValueTemplates}) rather than guess the value the run would put
 * there.
 */
const SCREEN_FIELD_CARRY: ScreenFieldCarry = {
  name: (value) => (typeof value === 'string' && value ? value : undefined),
  label: carryString,
  type: carryString,
  // Always stated, as the executor states it (`required: f.required === true`).
  required: (value) => value === true,
  options: carryOptions,
  // `unknown` in the spec: anything but absent is carried, `null` included, as
  // the executor forwards it.
  defaultValue: (value) => value,
  placeholder: carryString,
  min: carryNumber,
  max: carryNumber,
  inlineHelpText: carryString,
  reference: carryString,
  // RAW, as the executor sends it: `ScreenView` decides it live against the
  // values the author collects in the preview (objectui#10743).
  visibleWhen: carryString,
};

const SCREEN_FIELD_KEYS = Object.keys(SCREEN_FIELD_CARRY) as Array<keyof ScreenFieldSpec>;

/** Carry one key of an authored row onto `field`, when its value holds the declared type. */
function carryKey<K extends keyof ScreenFieldSpec>(field: ScreenFieldSpec, key: K, row: Record<string, unknown>): void {
  const value = SCREEN_FIELD_CARRY[key](row[key]);
  // The `!== undefined` check does not narrow a generic indexed type, so the
  // value is restated as the key's own type once it is known present.
  if (value !== undefined) field[key] = value as ScreenFieldSpec[K];
}

/**
 * Coerce the authored `config.fields` rows into runtime `ScreenFieldSpec`s
 * through {@link SCREEN_FIELD_CARRY}. A row without a usable `name` is skipped;
 * no other row is dropped: a field whose `visibleWhen` is false right now is
 * hidden by the renderer and comes back the moment the values make it true.
 */
function toScreenFields(raw: unknown): ScreenFieldSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: ScreenFieldSpec[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const row = f as Record<string, unknown>;
    const name = SCREEN_FIELD_CARRY.name(row.name);
    if (name === undefined) continue;
    const field: ScreenFieldSpec = { name };
    for (const key of SCREEN_FIELD_KEYS) carryKey(field, key, row);
    out.push(field);
  }
  return out;
}

/** Whether a `defaultValue` holds a `{…}` reference anywhere the engine's `interpolate` walks: a string, an array, an object. */
function holdsTemplateToken(value: unknown): boolean {
  // `search` ignores the global flag and `lastIndex`, so the shared token is
  // safe to reuse here.
  if (typeof value === 'string') return value.search(TEMPLATE_TOKEN) >= 0;
  if (Array.isArray(value)) return value.some(holdsTemplateToken);
  if (value && typeof value === 'object') return Object.values(value).some(holdsTemplateToken);
  return false;
}

/** A screen field whose `defaultValue` is a template the run fills in, as the preview marks it. */
export interface DefaultValueTemplate {
  name: string;
  /** The field's label, or its name when it has none, as `ScreenView` labels it. */
  label: string;
  /** The `defaultValue` as written; a non-string is shown as JSON. */
  literal: string;
}

/**
 * The fields whose `defaultValue` holds a `{…}` reference, with the value as
 * written (objectui#11190).
 *
 * The engine interpolates a screen field's `defaultValue` against the run's
 * variables when the screen pauses; the preview has no run, so it carries the
 * value as written and seeds the control with it, and `ScreenPreview` names
 * each of these fields under the form with its literal. A `defaultValue`
 * holding no reference is what the run shows too, so it is not listed.
 */
export function defaultValueTemplates(fields: readonly ScreenFieldSpec[]): DefaultValueTemplate[] {
  const out: DefaultValueTemplate[] = [];
  for (const f of fields) {
    if (!holdsTemplateToken(f.defaultValue)) continue;
    out.push({
      name: f.name,
      label: f.label || f.name,
      literal: typeof f.defaultValue === 'string' ? f.defaultValue : JSON.stringify(f.defaultValue),
    });
  }
  return out;
}

/**
 * How many of the screen's fields their `visibleWhen` hides for the values
 * collected so far — the renderer's own verdict (`visibleScreenFields`), so the
 * preview's hint and the form it sits under cannot disagree.
 */
export function hiddenFieldCount(spec: ScreenSpec, values: Record<string, unknown>): number {
  return screenFields(spec).length - visibleScreenFields(spec, values).length;
}

/**
 * A designed screen always carries a (possibly empty) field list — `fields` is
 * optional on the WIRE type only, where a message-only / object-form pause may
 * omit it.
 */
export type DesignedScreenSpec = ScreenSpec & { fields: ScreenFieldSpec[] };

/**
 * Map a screen node's authored `config` onto the runtime `ScreenSpec` — the
 * same keys the engine's `screen` executor reads (title / description / fields
 * / objectName / mode / defaults / idVariable). Every authored field is kept,
 * with its `visibleWhen` raw; the renderer decides visibility.
 */
export function buildScreenSpec(node: ScreenPreviewNode): DesignedScreenSpec {
  const c = (node.config && typeof node.config === 'object' ? node.config : {}) as Record<string, unknown>;
  const objectName = typeof c.objectName === 'string' && c.objectName ? c.objectName : undefined;
  const mode = c.mode === 'edit' ? 'edit' : c.mode === 'create' ? 'create' : undefined;
  const defaults =
    c.defaults && typeof c.defaults === 'object' && !Array.isArray(c.defaults)
      ? (c.defaults as Record<string, unknown>)
      : undefined;
  return {
    nodeId: node.id,
    title: typeof c.title === 'string' ? c.title : undefined,
    description: typeof c.description === 'string' ? c.description : undefined,
    fields: toScreenFields(c.fields),
    kind: objectName ? 'object-form' : 'fields',
    objectName,
    mode,
    defaults,
    idVariable: typeof c.idVariable === 'string' ? c.idVariable : undefined,
  };
}
