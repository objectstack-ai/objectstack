// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Detection policy for form-view predicates whose ROOT identifier is not bound
 * on the surface that evaluates them (#12915 scope C).
 *
 * ## The degradation this makes audible
 *
 * A form-view predicate binds a fixed scope: `record` (plus `previous`, the
 * saved record, and `parent` for master-detail line items) in runtime record
 * forms, and `data` — the row under edit, at every depth, repeater rows
 * included — in metadata-editing forms. The contract states the failure mode
 * beside the vocabulary (`packages/spec/src/ui/view.zod.ts`,
 * `FormFieldSchema.visibleWhen` / `FormSectionSchema.visibleWhen`): **a bare
 * identifier is UNBOUND, the predicate faults, and `visibleWhen`'s fault
 * fallback is `true`** — so a field the predicate was authored to hide renders
 * for everyone.
 *
 * That is quiet on its own, and lethal in combination with the authoring
 * pattern it exists to serve. Measured on a real deployment: an artifact built
 * 2026-08-05 by released `@objectstack/cli` 17.1.0 authors
 * `{ field: 'disqualification_reason', required: true, visibleWhen:
 * { dialect: 'cel', source: 'status == "unqualified"' } }` — the era's working
 * spelling. On a 17.2 runtime the predicate faults open, the conditionally
 * hidden field renders, and its unconditional `required: true` (authored to be
 * gated by that visibility) blocks **every** record creation through the
 * console. The same payload POSTed to the REST door returns 201: server-side
 * validation is correct, and only the already-built artifact degrades. Nothing
 * refuses, nothing logs, and the operator — the one person who can rebuild the
 * artifact — has no signal at all.
 *
 * ## What this module is, and deliberately is not
 *
 * It is a **detector**: given an artifact's stack definition, report every
 * form-view predicate naming an unbound root. Its caller turns that into one
 * deduped operator-facing boot line at the artifact door.
 *
 * - **Not a rewriter.** Prefixing a bare root with `record.` is the ADR-0087
 *   conversion (#12915 scope A), which needs a field-name-aware guard and is
 *   deferred by the maintainer ruling of 2026-08-28 (「同意C」) with an
 *   explicit start line. Nothing here mutates the definition.
 * - **Not a refusal.** No parse changes, no gate, no behaviour change. A
 *   faulting predicate keeps faulting open exactly as it does today; the only
 *   difference is that the operator is told.
 * - **Not a validator of the current surface.** Its caller applies it only
 *   inside the versioned window `applyArtifactForwardConversions` already
 *   opens (declared floor below the running spec, or undeclared). An artifact
 *   authored against the current surface answers to the strict parse and gets
 *   nothing from here — which is what keeps a *notice about legacy artifacts*
 *   out of contract territory.
 *
 * ## Precision: prefer missing an exotic predicate over crying wolf
 *
 * A notice that fires on a healthy, current, correctly-authored artifact is
 * worse than no notice, because the next one is ignored. Every judgement call
 * below therefore resolves toward silence:
 *
 * - **String literals are stripped before the scan**, so `record.note ==
 *   "status unqualified"` cannot false-positive on identifier-shaped text
 *   inside quotes.
 * - **Only ROOT position counts.** An identifier preceded by `.` is a member
 *   access, so `record.status`, `record.data`, and `record.parent.x` name one
 *   root (`record`) and nothing else.
 * - **A name followed by `(` is a call, not a scope root** — `has(record.x)`,
 *   `size(record.tags)` and every other CEL builtin drop out without needing
 *   to be enumerated.
 * - **A comprehension macro makes the whole predicate opaque and it is
 *   skipped.** `record.tags.exists(t, t == 'x')` binds `t` locally, and a
 *   tokenizer cannot tell that from an unbound root — so predicates
 *   containing `.all(` / `.exists(` / `.exists_one(` / `.map(` / `.filter(`
 *   are not judged at all.
 * - **An AST-only envelope passes.** `{ dialect: 'cel', ast }` with no
 *   `source` is opaque at this layer — the same posture the spec's own
 *   `features.*` root scanner takes.
 * - **Per-option `visibleWhen` is out of scope**, deliberately: options are
 *   evaluated by a *different* evaluator (`resolveCascadingOptions`, ADR-0068)
 *   which binds `current_user` as well, so this vocabulary would be the wrong
 *   yardstick there.
 *
 * A tokenizer rather than a CEL parse is the established shape for exactly
 * this question in this codebase: the spec's own enforced
 * `checkFormViewPredicateFeaturesRoot` scans the source string the same way,
 * for the same reason (parse time sees the source, and a detector with no
 * dependencies cannot itself fail to resolve). A real CEL parse lives in
 * `@objectstack/formula`, which this package cannot reach — `metadata-core`
 * depends on `@objectstack/spec` and nothing else, and spec exposes no parse.
 */

/**
 * The identifiers a form-view predicate may name in ROOT position.
 *
 * Sourced from the contract prose on `FormFieldSchema.visibleWhen` and
 * `FormSectionSchema.visibleWhen` (`packages/spec/src/ui/view.zod.ts`):
 * `record` + `previous` + `parent` in runtime record forms, `data` in
 * metadata-editing forms (and inside a repeater, where `data` is the ROW but
 * is still spelled `data`). The union of both surfaces is used because an
 * artifact's `views` collection carries both kinds and the definition does not
 * say which renderer will read a given form — the union is the direction that
 * stays silent on a healthy artifact.
 *
 * ⚠️ `current_user` is deliberately ABSENT: the contract states it is unbound
 * at field and section level and that such a predicate faults open. It is
 * bound only for per-option `visibleWhen`, which this scan does not visit.
 */
export const BOUND_FORM_VIEW_PREDICATE_ROOTS: readonly string[] = [
  'record',
  'previous',
  'parent',
  'data',
];

/** One form-view predicate naming a root that is not bound where it evaluates. */
export interface UnboundFormPredicateRoot {
  /** Dotted path into the stack definition, e.g. `views[3].form.sections[0].fields[2].visibleWhen`. */
  path: string;
  /** Operator-legible identity of the view carrying it (view name, else its object). */
  view: string;
  /** The root identifier that is not bound on this surface. */
  root: string;
  /** The predicate's CEL source, verbatim. */
  source: string;
}

/** CEL string literals (both quote styles, with escapes) — stripped before the root scan. */
const CEL_STRING_LITERAL_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;

/**
 * A comprehension macro binds its own iteration variable, which is
 * indistinguishable from an unbound root to a tokenizer. Predicates containing
 * one are skipped whole rather than guessed at.
 */
const CEL_COMPREHENSION_MACRO_RE = /\.\s*(?:all|exists|exists_one|map|filter)\s*\(/;

/** CEL literals and reserved words that can stand in root position without naming a scope. */
const CEL_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'true', 'false', 'null', 'in',
  // The CEL reserved-word list — none may be an identifier, so none is a root.
  'as', 'break', 'const', 'continue', 'else', 'for', 'function', 'if', 'import',
  'let', 'loop', 'package', 'namespace', 'return', 'var', 'void', 'while',
]);

/** The predicate keys a form view carries. `visibleOn` is the ADR-0089 alias,
 *  folded onto `visibleWhen` AT PARSE — so a raw artifact, which reaches this
 *  scan before any parse, can still spell either. */
const FORM_PREDICATE_KEYS: readonly string[] = ['visibleWhen', 'visibleOn'];

/**
 * Root identifiers named by one CEL source, minus every bound root, reserved
 * word and call target. Order-preserving and de-duplicated.
 *
 * Exported for the pinned false-positive cases in this module's test — the
 * traversal below is the product surface, this is the judgement under it.
 */
export function unboundRootsInCelSource(source: string): string[] {
  const stripped = source.replace(CEL_STRING_LITERAL_RE, '');
  if (CEL_COMPREHENSION_MACRO_RE.test(stripped)) return [];

  // Built per call rather than shared at module scope: a `g`-flagged literal
  // carries `lastIndex` between calls, and a detector that answers differently
  // on its second invocation is the exact class of bug this module exists to
  // report.
  const rootIdentifier = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)/g;
  const roots: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = rootIdentifier.exec(stripped)) !== null) {
    const identifier = match[1]!;
    // Peek past whitespace: a name applied to an argument list is a call.
    let after = match.index + match[0].length;
    while (after < stripped.length && /\s/.test(stripped[after]!)) after += 1;
    if (stripped[after] === '(') continue;
    if (CEL_RESERVED_WORDS.has(identifier)) continue;
    if (BOUND_FORM_VIEW_PREDICATE_ROOTS.includes(identifier)) continue;
    if (seen.has(identifier)) continue;
    seen.add(identifier);
    roots.push(identifier);
  }
  return roots;
}

/** The CEL source of one predicate slot, or `null` when there is nothing to judge. */
function readCelSource(predicate: unknown): string | null {
  // Bare-string shorthand for `{ dialect: 'cel', source }` — normalized away by
  // `objectstack compile`, so a built artifact should not carry it; read it
  // anyway, because a hand-written or third-party artifact may.
  if (typeof predicate === 'string') return predicate.trim() === '' ? null : predicate;
  if (predicate === null || typeof predicate !== 'object' || Array.isArray(predicate)) return null;
  const { dialect, source } = predicate as { dialect?: unknown; source?: unknown };
  if (dialect !== 'cel') return null;
  if (typeof source !== 'string' || source.trim() === '') return null;
  return source;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function scanPredicateSlot(
  predicate: unknown,
  path: string,
  view: string,
  out: UnboundFormPredicateRoot[],
): void {
  const source = readCelSource(predicate);
  if (source === null) return;
  for (const root of unboundRootsInCelSource(source)) {
    out.push({ path, view, root, source });
  }
}

/**
 * One form-view field entry, and its sub-fields at any depth (composite /
 * repeater / record types nest). A legacy bare-string entry (`'title'`) names
 * a field and carries no predicate.
 */
function scanFormField(
  field: unknown,
  path: string,
  view: string,
  out: UnboundFormPredicateRoot[],
): void {
  if (!isPlainObject(field)) return;
  for (const key of FORM_PREDICATE_KEYS) {
    scanPredicateSlot(field[key], `${path}.${key}`, view, out);
  }
  const subFields = field.fields;
  if (Array.isArray(subFields)) {
    subFields.forEach((sub, index) => scanFormField(sub, `${path}.fields[${index}]`, view, out));
  }
}

function scanFormSection(
  section: unknown,
  path: string,
  view: string,
  out: UnboundFormPredicateRoot[],
): void {
  if (!isPlainObject(section)) return;
  for (const key of FORM_PREDICATE_KEYS) {
    scanPredicateSlot(section[key], `${path}.${key}`, view, out);
  }
  const fields = section.fields;
  if (Array.isArray(fields)) {
    fields.forEach((field, index) => scanFormField(field, `${path}.fields[${index}]`, view, out));
  }
}

/**
 * One form view. Sections live under `sections`, or under the legacy `groups`
 * alias that the parse folds onto `sections` — both are read here for the same
 * reason `visibleOn` is: this scan runs BEFORE the parse.
 */
function scanFormView(
  formView: unknown,
  path: string,
  view: string,
  out: UnboundFormPredicateRoot[],
): void {
  if (!isPlainObject(formView)) return;
  for (const bucket of ['sections', 'groups'] as const) {
    const sections = formView[bucket];
    if (!Array.isArray(sections)) continue;
    sections.forEach((section, index) =>
      scanFormSection(section, `${path}.${bucket}[${index}]`, view, out),
    );
  }
}

/** The object a view arm targets (`<arm>.data.object`), when it declares one. */
function readArmObject(arm: unknown): string | undefined {
  if (!isPlainObject(arm)) return undefined;
  const data = arm.data;
  if (!isPlainObject(data)) return undefined;
  const object = data.object;
  return typeof object === 'string' && object !== '' ? object : undefined;
}

/** Operator-legible identity for one `views[]` entry. */
function viewLabel(entry: Record<string, unknown>, index: number): string {
  const name = entry.name;
  if (typeof name === 'string' && name !== '') return name;
  const object = entry.object;
  if (typeof object === 'string' && object !== '') return object;
  return readArmObject(entry.form) ?? readArmObject(entry.list) ?? `views[${index}]`;
}

/**
 * Every form-view predicate in one stack definition whose root identifier is
 * not bound where it evaluates.
 *
 * `definition` is the **stack definition** — the shape with `manifest`,
 * `objects`, `views`, … at the top; for an environment-artifact envelope, pass
 * the envelope's `metadata` block. Same input as
 * `applyArtifactForwardConversions`, so a door can hand both the same value.
 *
 * Pure and read-only: never throws, never mutates, never gates. An empty array
 * means "nothing to say", which is also the answer for a definition this
 * cannot read — silence is the safe direction (see the module doc).
 *
 * Both `views[]` shapes are visited: the aggregated container
 * (`{ list, form, listViews, formViews }`, identified by the ABSENCE of
 * `viewKind`) and the independent ViewItem (`{ name, object, viewKind, config }`).
 * A ViewItem whose `viewKind` is not `'form'` carries no form-view predicate
 * and is skipped.
 */
export function detectUnboundFormViewPredicateRoots(definition: unknown): UnboundFormPredicateRoot[] {
  const out: UnboundFormPredicateRoot[] = [];
  if (!isPlainObject(definition)) return out;
  const views = definition.views;
  if (!Array.isArray(views)) return out;

  views.forEach((entry, index) => {
    if (!isPlainObject(entry)) return;
    const label = viewLabel(entry, index);

    if (entry.viewKind !== undefined) {
      if (entry.viewKind !== 'form') return;
      scanFormView(entry.config, `views[${index}].config`, label, out);
      return;
    }

    scanFormView(entry.form, `views[${index}].form`, label, out);
    const formViews = entry.formViews;
    if (!isPlainObject(formViews)) return;
    for (const [key, formView] of Object.entries(formViews)) {
      scanFormView(formView, `views[${index}].formViews.${key}`, label, out);
    }
  });

  return out;
}
