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
 * included — in metadata-editing forms. BOTH predicate surfaces additionally
 * bind `current_user` and its ADR-0068 aliases — a FIELD since objectui#6010,
 * a SECTION since objectui#6110 + #6111. The contract states the failure mode
 * beside the vocabulary (`packages/spec/src/ui/view.zod.ts`,
 * `FormFieldSchema.visibleWhen` / `FormSectionSchema.visibleWhen`): **a bare
 * identifier is UNBOUND, the predicate faults, and `visibleWhen`'s fault
 * fallback is `true`** — so a field the predicate was authored to hide renders
 * for everyone.
 *
 * ⚠️ The two surfaces did once bind different roots, and this module got that
 * split wrong TWICE — once per surface, both times by transcribing prose that
 * was faithful and stale. See {@link BOUND_FORM_VIEW_PREDICATE_ROOTS} for what
 * the list is sourced from instead, and why that source can be refuted rather
 * than merely re-read.
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
 * - **The vocabulary answers to the binding MECHANISM, not to a sentence
 *   about it** — see {@link BOUND_FORM_VIEW_PREDICATE_ROOTS}. Judging either
 *   surface against a stale vocabulary false-flags a legitimate `current_user`
 *   test, which is this list's only measured failure mode: it has now happened
 *   once on each surface.
 * - **Per-option `visibleWhen` is out of scope**, deliberately: options are
 *   evaluated by a *different* evaluator (`resolveCascadingOptions`, ADR-0068),
 *   and — unlike either surface scanned here — the write-path rule validator
 *   enforces that one server-side, so it is a different question entirely.
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
 * Roots bound on EVERY form-view predicate surface — the FIELD slot and the
 * SECTION slot alike, which is why one list now serves both.
 *
 * ## ⛔ Do not re-source this list by transcribing the contract sentence
 *
 * That is how it has been wrong BOTH times it has been wrong, and the two are
 * the same failure one surface apart:
 *
 * 1. **FIELD.** The first version omitted `current_user`, quoting
 *    `FormFieldSchema.visibleWhen` faithfully — the root genuinely had been
 *    unbound there (#6146). objectui#6010 had already bound it and the prose
 *    had not caught up; #12930 re-measured the prose, and this module needed a
 *    same-day correction.
 * 2. **SECTION.** That correction then split the vocabulary and justified the
 *    section half by quoting `FormSectionSchema.visibleWhen` — *"`current_user`
 *    is absent here and that is CORRECT for a section: the section docblock
 *    states it is unbound at that level and the predicate faults open."*
 *    Faithful again, and stale again: objectui#6110 + #6111 had bound it, and
 *    #12914 re-measured the prose. This list is that second correction.
 *
 * The prose is a transcription of a renderer, so it can only ever LAG one.
 * Membership here is therefore decided by the mechanism, stated so a reader can
 * go and REFUTE it instead of re-reading a sentence: **a root is bound on a
 * surface iff some renderer threads a scope carrying it into the evaluator that
 * surface uses.** Each entry names the site that does the threading, which is
 * what a re-measurement actually goes and looks at:
 *
 * - `record` / `previous` / `parent` — the runtime record-form renderer
 *   evaluates against the record under edit, its saved counterpart, and the
 *   master-detail parent of a line item.
 * - `data` — the metadata-editing form renderer evaluates against the row under
 *   edit, and inside a repeater `data` is the ROW at every depth (#6254): there
 *   is no implicit row scope, so a bare identifier is unbound there too.
 * - `current_user` and its ADR-0068 D1 alias roots — the aliases are spelled
 *   `user`, `ctx.user` and `os.user`, so as ROOT identifiers they are `user`,
 *   `ctx` and `os`. Threaded in by a DIFFERENT renderer per surface, which is
 *   why the two surfaces bound it a release apart:
 *   - FIELD — the form renderer passes the host shell's predicate scope into
 *     `evalFieldPredicate` / `resolveFieldRuleState` (`@object-ui/core`) as
 *     their `extra` scope (objectui#6010).
 *   - SECTION — the console form renderer threads that same scope into
 *     `isSectionVisible`, where it used to pass `undefined` (objectui#6110);
 *     and `ObjectForm` / `SplitForm` / `ModalForm` / `DrawerForm` copy the
 *     authored `visibleWhen` onto the `section-divider` pseudo-field, whose
 *     predicate the SDUI form renderer evaluates with that scope bound
 *     (objectui#6111). Before those two, the object-view chain dropped the key
 *     before any renderer saw it — which is what made the retired sentence
 *     above TRUE on the day it was written.
 *
 * Admitting the BARE `ctx` / `os` roots rather than only the two-segment alias
 * is the deliberate silent direction: this detector reports fault-open risk,
 * and a predicate reaching into the host context under either namespace is not
 * the class it is hunting.
 *
 * And the guard against a third round is mechanical rather than editorial: this
 * module's test reads the LIVE `.describe()` text of
 * `FormFieldSchema.visibleWhen` and `FormSectionSchema.visibleWhen` out of
 * `@objectstack/spec/ui` and fails when it stops agreeing with this list. A
 * comment quoting that sentence goes stale in silence — twice now, because no
 * gate reads a comment; an assertion that fetches the sentence cannot.
 *
 * Two limits the `current_user` binding does NOT remove — neither changes this
 * detector's answer on either surface, and it is worth saying why:
 *
 * - It is a **rendering rule, never authorization** (nothing server-side
 *   evaluates a form-view `visibleWhen`, field or section). That is an
 *   authoring hazard, not a version-drift hazard, so it is not this boot
 *   notice's business.
 * - The scope belongs to the HOST, so on the console's public form route
 *   (`/f/:slug`) no principal is published, the root is unbound, and the
 *   predicate faults open there. This notice stays silent on that: it reports
 *   what faults on the primary hosted routes, and a route-specific unboundness
 *   that is equally true of a freshly-built current artifact says nothing about
 *   the artifact's ERA — which is the only thing this notice claims to detect.
 */
export const BOUND_FORM_VIEW_PREDICATE_ROOTS: readonly string[] = [
  'record',
  'previous',
  'parent',
  'data',
  'current_user',
  'user',
  'ctx',
  'os',
];

/**
 * The FIELD-level vocabulary — **the same list**, kept under its own name only
 * because the operator-facing notice prints a rule per surface.
 *
 * There is no field-only root left. This constant used to be spelled
 * `[...BOUND_FORM_VIEW_PREDICATE_ROOTS, ...FIELD_ONLY_BOUND_PREDICATE_ROOTS]`;
 * the section binding emptied that difference, and an exported constant named
 * `FIELD_ONLY_…` holding `[]` would be a name asserting something no renderer
 * does. It was REMOVED rather than emptied — nothing had published it yet, so
 * this was the last moment at which removing it cost nothing (the changeset
 * carries the evidence).
 *
 * ⚠️ Keeping this name is not a prediction that the split returns. It records
 * that the QUESTION is still per surface: "what does a FIELD predicate bind?"
 * and "what does a SECTION predicate bind?" are two questions with one answer
 * today, and that answer rests on two different renderers (objectui#6010 versus
 * objectui#6110 + #6111). Either can move without the other; when one does,
 * this is where the divergence goes, and the live-contract assertion in this
 * module's test is what makes the day it happens findable.
 */
export const BOUND_FORM_FIELD_PREDICATE_ROOTS: readonly string[] =
  BOUND_FORM_VIEW_PREDICATE_ROOTS;

/** Which form-view slot a predicate sits in. Reported, never a vocabulary switch. */
export type FormPredicateSurface = 'field' | 'section';

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
  /**
   * The slot it sits in. Both slots bind the same roots
   * ({@link BOUND_FORM_VIEW_PREDICATE_ROOTS}), so this did NOT decide the
   * verdict — it is carried because the operator notice names the slot, and
   * "field or section" is the first thing an author needs to go and look.
   */
  surface: FormPredicateSurface;
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
 * `boundRoots` is the vocabulary to judge against. It stays a parameter now
 * that both form-view slots share one list, because the reason for it was never
 * "the two differ today" — this function is the judgement, and the caller is
 * what supplies a vocabulary to it. The default is
 * {@link BOUND_FORM_VIEW_PREDICATE_ROOTS}, the whole vocabulary, so a caller
 * that says nothing gets the same verdict the traversal below would give it.
 *
 * ⚠️ The retired argument for the old default was that it was the STRICTER of
 * two lists, so a forgetful caller failed in the findable direction. That
 * argument died with the split rather than surviving it: with one vocabulary
 * there is no stricter option, and inventing a narrower default purely to keep
 * the argument alive would manufacture the false positive this module exists to
 * avoid. Recorded because a rationale of that shape otherwise outlives its
 * premise — which is the failure this whole module keeps paying for.
 *
 * Exported for the pinned false-positive cases in this module's test — the
 * traversal below is the product surface, this is the judgement under it.
 */
export function unboundRootsInCelSource(
  source: string,
  boundRoots: readonly string[] = BOUND_FORM_VIEW_PREDICATE_ROOTS,
): string[] {
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
    if (boundRoots.includes(identifier)) continue;
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

/**
 * Judge one predicate slot, and record which slot it was.
 *
 * `surface` no longer selects a vocabulary — both slots bind the same roots
 * (see {@link BOUND_FORM_VIEW_PREDICATE_ROOTS}) — and is still threaded through
 * because every finding reports it.
 */
function scanPredicateSlot(
  predicate: unknown,
  path: string,
  view: string,
  surface: FormPredicateSurface,
  out: UnboundFormPredicateRoot[],
): void {
  const source = readCelSource(predicate);
  if (source === null) return;
  for (const root of unboundRootsInCelSource(source, BOUND_FORM_VIEW_PREDICATE_ROOTS)) {
    out.push({ path, view, root, source, surface });
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
    scanPredicateSlot(field[key], `${path}.${key}`, view, 'field', out);
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
    scanPredicateSlot(section[key], `${path}.${key}`, view, 'section', out);
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
