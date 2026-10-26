// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FormPage — single component that renders a FormView either as a public
 * anonymous form (`/f/:slug` → backend `GET/POST /api/v1/forms/:slug`) or
 * as an authed internal form (`/forms/:name` → `GET /api/v1/meta/view/:name`
 * + `POST /api/v1/data/:object`).
 *
 * Both modes share the same renderer; the difference is only in how the
 * spec is loaded, where submissions go, and — since objectui#4109 — what
 * happens after a successful submit when the form view declares nothing:
 * an internal submit lands on the record it just wrote, while the public
 * path keeps the anonymous `thank-you` confirmation. See
 * {@link resolveSubmitBehavior}. This is the same shape as Airtable Forms —
 * the form view metadata is identical whether it is embedded publicly or
 * used by logged-in operators.
 *
 * ## Create vs edit (objectui#4278)
 *
 * The internal route also serves EDIT, and which one it is comes from the URL:
 * `ActionRunner.executeForm` forwards the record an action was fired from as
 * `/forms/:name?recordId=<id>`. Until #4278 this route ignored that param
 * entirely — it rendered empty inputs and its submit was an unconditional
 * `POST` — so an "edit this record" action produced a blank form and then a
 * DUPLICATE record. `?recordId=` now selects the whole read/write pair:
 * `GET /data/:object/:id` to prefill, `PATCH /data/:object/:id` to save. See
 * {@link readFormRecordTarget} for the create/edit/refuse decision and
 * {@link readPrefill} for what wins when a `prefill_` param and a stored value
 * name the same field.
 *
 * ## Which object that id belongs to (objectui#4292)
 *
 * An id alone does not say which object it names, so the read/write pair above
 * resolves it against the FormView's own target — right when the action fired
 * from a record of that object, silently wrong when it did not. `?recordObject=`
 * now travels with the id and this route refuses when the two disagree; see
 * {@link FORM_RECORD_OBJECT_PARAM} for why it can only ever refuse, and the
 * guard in {@link loadInternalForm} for where it fires (before any `/data/`
 * request, so a mismatch reads nothing and writes nothing).
 *
 * ## Where a declared `redirect` goes (objectui#4190)
 *
 * `submitBehavior: { kind: 'redirect' }` was consumed as a browser-level
 * navigation on the authored string, which is why the card asked what that
 * string even meant. objectstack#7496 ruled it: a RELATIVE in-app path, with
 * `{{record.field}}` interpolation, URL-escaped when the redirect is built.
 * So the destination is a route in this shell and it is navigated to with the
 * router — a full-page navigation ignores the console mount and drops the
 * submitter at the origin root — while an out-of-contract absolute is refused
 * on screen instead of followed. See `submitRedirect.ts`.
 *
 * ## Conditional field visibility (objectui#5594)
 *
 * A FormView field may carry a CEL predicate saying WHEN it is visible —
 * `visibleWhen` (ADR-0089). This renderer read it not at all before #5594, so such a field rendered unconditionally on both routes:
 * fail-open and silent, with no diagnostic for the author.
 *
 * It is the SECOND form renderer in this repo, which is why the gap survived.
 * objectui#2212 recorded this exact symptom and PR #2214 fixed it on the OTHER
 * chain — `ModalForm` -> `resolveFormViewLayout` -> `@object-ui/plugin-form`
 * `sectionFields.ts` -> `@object-ui/components` `renderers/form/form.tsx` —
 * which this file is on at no point, and #2212's regression pin lives with
 * that chain, so nothing in the suite could see this copy.
 *
 * The wiring is #2212's ruling applied verbatim, not a second semantics: see
 * {@link isFieldVisible} for the engine, the bound scope, and what the fix
 * deliberately does not change.
 *
 * ## The other three conditional-rule surfaces (objectui#5627)
 *
 * #5594 wired ONE of the four surfaces the sibling chain honours — the
 * view-level field predicate. The other three were dropped in the same place
 * and for the same reason: nothing downstream could read a key this file's
 * payload types did not admit.
 *
 *  - SECTION-level `visibleWhen` (ADR-0089). The section type is
 *    no longer this file's to widen — objectui#5596 replaced the hand copy with
 *    the shared `FormSectionSpec`, which has DECLARED these two keys ever since
 *    ("declaring a key is not honouring it", as that type's own docstring says
 *    while naming this card). What was missing here was the evaluation, and the
 *    render mapped every section unconditionally. See {@link isSectionVisible}.
 *  - OBJECT-level `visibleWhen` / `readonlyWhen` / `requiredWhen` (ADR-0036),
 *    authored on the object's field rather than on the form view. This file's
 *    own `ObjectFieldDef` admitted none of them, so `readonly` and `required`
 *    were whatever the static flags said. See {@link resolveRowState}, which
 *    resolves them through the SHARED `resolveFieldRuleState` rather than
 *    re-deriving what the three rules mean for a fourth time.
 *
 * Both halves are RENDERING rules: a hidden section's fields still submit their
 * values, exactly as a hidden field's do (triage ruling, 2026-08-22, following
 * #5594 and the plugin-form chain). Nothing in this file makes visibility a
 * submit-payload rule, at either granularity.
 *
 * ## The one thing that IS a submit-payload rule (objectui#5883)
 *
 * A field whose declared `defaultValue` is an instruction the SERVER resolves
 * per insert is left out of a create payload when the control is empty — see
 * {@link omitServerOwnedBlanks}. That is not a visibility rule wearing a
 * different hat: the key is withheld precisely so the producer supplies the
 * value, which is the whole meaning of the declaration. It is the submit half
 * of the fence {@link readPrefill} put on seeding for objectui#5727, and the
 * sibling of `@object-ui/plugin-form`'s `omitServerResolvedDefaults`.
 *
 * ## One field layer, not two (objectui#10179, objectui#10177)
 *
 * The page shell above is this file's own; the FIELD layer is not. Each row
 * renders the widget the shared resolver names for it — `resolveFormWidgetType`
 * + `getLazyFieldWidget`, the ADR-0059 door — including the two axes a
 * type-keyed switch cannot see: an authored `widget` (which wins over `type`
 * when it names a registered widget, and otherwise degrades to the `type`
 * renderer as the spec's `FieldSchema.widget` declares — objectui#10472)
 * and arity (`select` + `multiple: true` is the multiselect widget). Until
 * #10179 a hand-rolled `switch (field.type)` stood here that knew a subset of
 * the declared types and rendered every other one as a text box, silently.
 * See {@link resolveFieldWidgetKey} for the decision and {@link FieldInput} for
 * the host half (ids, label association, required, uploads).
 */

import { Suspense, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CASCADE_OPTION_WIDGET_TYPES,
  EXPANDABLE_FIELD_TYPES,
  evalFieldPredicate,
  isMissingForRequired,
  isRuntimeDefault,
  isServerOwnedValue,
  resolveFieldRuleState,
  type FieldRuleFaults,
  type FieldRulePredicate,
} from '@object-ui/core';
import {
  omitServerResolvedDefaults,
  optionListDefault,
  resolveSectionGroupReferences,
} from '@object-ui/plugin-form';
// ADR-0059's published door for a host that renders field widgets OUTSIDE the
// form renderer: `resolveFormWidgetType` + `getLazyFieldWidget` hand back the
// very component `@object-ui/fields` registers for the form, so a host built on
// this seam "can never drift behind the form surface" (that resolver's own
// docblock). `@object-ui/app-shell`'s `ActionParamDialog` is the other host on
// it. Since objectui#10179 EVERY row of this page goes through it — see
// {@link resolveFieldWidgetKey} and {@link FieldInput}.
import {
  FIELD_WIDGET_LABELLING,
  getLazyFieldWidget,
  mapFieldTypeToFormType,
  resolveFormWidgetType,
} from '@object-ui/fields';
import { usePredicateScope } from '@object-ui/react';
import { pickLocalized, useObjectTranslation, useSafeFieldLabel } from '@object-ui/i18n';
import type { FormFieldSpec, FormSectionSpec, FormViewSpec } from '@object-ui/app-shell';
import type { ObjectFormSection } from '@object-ui/types';
import { resolveSubmitRedirect } from './submitRedirect';

const API_BASE = (import.meta.env.VITE_SERVER_URL || '') + '/api/v1';

/** Resolved server payload for a public form. */
interface PublicFormPayload {
  slug: string;
  object: string;
  label?: string;
  form: FormViewBody;
  objectSchema: ObjectSchemaPayload | null;
}

interface ObjectSchemaPayload {
  name: string;
  label?: string;
  fields: Record<string, ObjectFieldDef>;
  /**
   * The object's declared field groups (ADR-0085 §5), carried so a form
   * section may REFERENCE one instead of enumerating members (objectui#8641).
   *
   * Untyped on purpose: this key is never read HERE. It travels straight to
   * `resolveSectionGroupReferences`, whose derivation
   * (`deriveFieldGroupLayout`) owns what a `fieldGroups` entry may say — and
   * `@objectstack/spec` owns THAT. Restating the entry shape in this app would
   * put a second description of one contract in the place least likely to be
   * updated when the contract moves.
   */
  fieldGroups?: unknown;
}

interface ObjectFieldDef {
  type: string;
  label?: string;
  /**
   * Which declared `fieldGroups` entry this field belongs to (ADR-0085 §5).
   *
   * Membership is the ONLY input the group derivation needs per field, and
   * this app never reads the key itself — see {@link ObjectSchemaPayload.fieldGroups}.
   * Declared so the group half of the object schema is describable rather than
   * smuggled through as an untyped bag (objectui#8641).
   */
  group?: string;
  required?: boolean;
  defaultValue?: unknown;
  maxLength?: number;
  /**
   * The upload configuration `@objectstack/spec` declares on a field and the
   * shared `FileField` reads — `multiple`, `accept` (a list of MIME types or
   * extensions) and `maxSize` (BYTES).
   *
   * Admitted here for the reason objectui#5627 states about the conditional
   * rules two slots down: nothing downstream can read a key this file's payload
   * types do not admit, so a `file` field rendered through the shared widget
   * would have been a single-file, unfiltered, unbounded dropzone no matter
   * what the object declared — the widget's defaults, not the author's. The
   * server already serves all three (spec's field schema declares
   * `multiple` / `accept` / `maxSize`); only this app's narrowed view of the
   * payload dropped them.
   *
   * `multiple` is also the ARITY half of the widget decision: on a `select`
   * it selects a DIFFERENT widget (the multiselect chip picker), which
   * {@link resolveFieldWidgetKey} reads through the shared
   * `mapFieldTypeToFormType` table rather than a local copy (objectui#10179).
   */
  multiple?: boolean;
  accept?: string[];
  maxSize?: number;
  /**
   * The spec's field-level render hint (`FieldSchema.widget`) — the object
   * field's own, read as the fallback for a form view that declares none
   * (objectui#10177). Three widget keys (`object-ref`, `filter-condition`,
   * `recipient-picker`) are reachable ONLY through this key.
   */
  widget?: string;
  options?: Array<{ value: string; label?: string }> | string[];
  placeholder?: string;
  helpText?: string;
  /**
   * The OBJECT-level conditional rules (ADR-0036), authored on the object's
   * field rather than on a form view — a DIFFERENT slot from the view-level
   * predicate {@link RenderableField.visibleWhen} carries (objectui#5627).
   *
   * The sibling chain keeps the two apart on purpose: `@object-ui/plugin-form`
   * `sectionFields.ts` copies these three straight off the object field and
   * routes the VIEW predicate into `visibleOn` "so the object rule is never
   * clobbered", and `@object-ui/components` `renderers/form/form.tsx` then
   * evaluates the two slots independently and ANDs them. This file admitted
   * neither of them until #5627, so `buildSections` could not read what it was
   * never handed: `readonly` was `override.readonly ?? false` and `required`
   * was `override.required ?? def.required ?? false` — static, never
   * conditional, on both routes including the anonymous `/f/:slug` one.
   *
   * Typed as `@object-ui/core`'s own {@link FieldRulePredicate} rather than
   * re-spelled, because that is the parameter type of `resolveFieldRuleState`,
   * the engine every one of these predicates is handed to. (The view-level slot
   * derives its type from `FormFieldSpec` for the same reason, one layer up.)
   */
  visibleWhen?: FieldRulePredicate;
  readonlyWhen?: FieldRulePredicate;
  requiredWhen?: FieldRulePredicate;
}

/** Visualization types the form renderer understands (FormViewSpec.type). */
const FORM_SPEC_TYPES = new Set(['simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal']);

/**
 * The form CONFIG plus the view identity that travels beside it (objectui#5596).
 *
 * {@link FormViewSpec} is the converged form contract and carries no `label`:
 * `@objectstack/spec`'s `FormViewSchema` REJECTS that key outright
 * (`unrecognized_keys`, measured against the installed 17.0.0) — a form config
 * says `title`, not `label`. Until #5596 this file's hand copy declared `label`
 * on the form type, which read as "a FormView may be labelled" and is not true.
 *
 * The value those reads actually find is the VIEW's identity label, and both
 * bodies this renderer accepts carry it one way or another:
 *
 *  - the `ExpandedViewItem` envelope (#2208) puts it beside `config`, and
 *    {@link resolveInternalForm} already reads it from there;
 *  - a FLATTENED runtime overlay has no envelope at all — the config and the
 *    identity share one object, which is exactly what the spec publishes as
 *    `VIEW_METADATA_MEMBERS.formOverlay` (`FormViewSchema` extended with
 *    `label` / `object` / `viewKind` / ...). On that branch `form === body`, so
 *    the label is reachable through the form variable.
 *
 * So the key is declared HERE, on the body this renderer unwraps, and not on the
 * form contract shared with `packages/app-shell`. Narrowed to `string` because
 * every read below assigns it into a `string` slot; the spec's own overlay types
 * it `I18nLabel`, whose inline locale-map arm this renderer resolves for a field
 * entry's copy ({@link buildSections}, objectui#13380) but not for this label.
 */
type FormViewBody = FormViewSpec & { label?: string };

/**
 * Post-submit behaviour — DERIVED from the converged form contract, not
 * restated (objectui#5596).
 *
 * This was a hand-written four-member union carrying the comment "Mirrors the
 * spec FormView.submitBehavior union", which is the claim shape
 * `scripts/check-spec-symbol-derivation.mjs` exists to catch: a mirror that
 * nothing checks is one spec release from being a fork. Reading it back off
 * {@link FormViewSpec} makes the mirror structural.
 *
 * `redirect.url` is still a plain string, because that is what the contract
 * ships: the ruled shape (objectstack#7496) is a refinement ON a string, so the
 * key arrives as the author wrote it. What it is ALLOWED to say is not restated
 * here either — `resolveSubmitRedirect` asks the spec's own schema at the
 * moment of use (`submitRedirect.ts`).
 */
type SubmitBehavior = NonNullable<FormViewSpec['submitBehavior']>;

/** Which surface is rendering the form — see {@link FormPageProps.mode}. */
export type FormPageMode = 'public' | 'internal';

/**
 * The query param naming the record an internal form edits — the one
 * `ActionRunner.executeForm` forwards (`/forms/:name?recordId=<id>`).
 *
 * ## Why the same spelling as the drawer's reserved param, deliberately
 *
 * `recordId` is ALREADY reserved in `@object-ui/app-shell`'s registry
 * (`src/urlParams.ts` → `RECORD_DRAWER_PARAM`), where it opens a record-detail
 * drawer over a list. That is not a collision to route around, and #4278 ruling
 * point 3 asked for the relationship to be measured rather than assumed:
 *
 *  - the two readers can never see one URL. React Router renders exactly one
 *    leaf per location, `/forms/:name` is a TOP-LEVEL route in `App.tsx`
 *    (sibling of `/apps/*`, where `ObjectView` — the drawer's only reader,
 *    `views/ObjectView.tsx`, the single `RECORD_DRAWER_PARAM` call site
 *    outside the registry itself — is mounted), and `InternalFormRoute` renders
 *    `DefaultHomeLayout` + this component and no list. Disjoint subtrees, so
 *    the same URL cannot carry both meanings at once;
 *  - and the MEANING is the same one either way — "the record this surface is
 *    about". A second spelling (`formRecordId`, …) for that fact would be the
 *    de-facto second contract AGENTS.md #0.1 forbids, and would make the
 *    already-reserved name look free to repurpose.
 *
 * So this is the registry's name, used as the registry defines it. It is a
 * literal here rather than an import only because `@object-ui/app-shell`
 * exports its package root alone — its `exports` map publishes `.` and
 * `./styles.css`, nothing else — and that root does not re-export
 * `./urlParams`, so `RECORD_DRAWER_PARAM` has no spelling a consumer can
 * import. Retiring this literal means publishing the registry from that root,
 * the way objectui#4280 collected `resolveHostAppSegment`. `FormPage.test.ts`
 * pins the two spellings equal so they cannot drift apart in silence.
 */
export const FORM_RECORD_ID_PARAM = 'recordId';

/**
 * The object the accompanying {@link FORM_RECORD_ID_PARAM} belongs to
 * (objectui#4292) — `ActionRunner.executeForm` forwards the two together.
 *
 * ## Why an id needed an object at all
 *
 * `?recordId=` names an id and nothing else, so this route has to pick an
 * object to resolve it against, and it picks the FormView's own target — the
 * only one it knows. That is right whenever the action fired from a record OF
 * that object, and until #4292 nothing checked that it had: an action whose
 * `locations` put it on an Account but whose `target` is `showcase_task.edit`
 * is publishable metadata, and where primary keys are per-table integers
 * `GET /data/showcase_task/42` answers happily for the user who was looking at
 * Account 42. The server cannot flag it either — it echoes the path's object
 * back (`getData` returns `object: request.object`), so the response is
 * self-consistent. #4278 shipped the read/write pair that turned that from a
 * duplicate INSERT into a targeted UPDATE of the wrong record, which is what
 * made the missing identity worth closing.
 *
 * ## An ASSERTION, never an override — the whole point
 *
 * This param cannot change which object the form edits; that comes from the
 * view metadata and only from there. Its sole power is to make the form
 * REFUSE. Reading it as a selector instead would let any hand-authored URL aim
 * a form at an arbitrary object — the same hole, re-opened from the other side.
 * (The registry's `formObject` is deliberately the other thing: it selects the
 * object the record-form OVERLAY edits. Same `<param>Object` naming, opposite
 * powers, separate surfaces.)
 *
 * Spelled as a literal here and in `ActionRunner` for the reason
 * {@link FORM_RECORD_ID_PARAM} documents — `@object-ui/core` sits below this
 * app and app-shell exports no `./urlParams`. `FormPage.test.ts` pins the two
 * ends together by running the real producer and reading its URL back here,
 * so a rename on either side fails rather than silently disarming the guard.
 */
export const FORM_RECORD_OBJECT_PARAM = 'recordObject';

/**
 * What the URL says this internal form is FOR: creating a record, editing a
 * named one, or nothing coherent.
 *
 * The third case is the point. #4278 ruling point 2 is fail-closed: an edit
 * intent this route cannot honour must reach the error state, because silently
 * falling back to create mode is the EXACT harm the card was filed about (an
 * empty form whose submit inserts a duplicate). A present-but-blank
 * `?recordId=` — which `ActionRunner` really can emit, since it appends the
 * param for any `recordId != null` and an empty-string id passes that test —
 * declares edit intent and names no record, so it refuses rather than degrades.
 */
export type FormRecordTarget =
  | { kind: 'create' }
  | { kind: 'edit'; recordId: string; recordObject: string | null }
  | { kind: 'refuse'; reason: string };

/**
 * Decide {@link FormRecordTarget} from the surface and the query string.
 *
 * PUBLIC mode never reads the param, and that is a contract, not an
 * optimisation: `/f/:slug` is the anonymous surface, where the visitor
 * controls the URL and the backend resolver deliberately exposes one
 * submit-only endpoint. Honouring `?recordId=` there would turn a public form
 * into an arbitrary-record reader and writer. The public path is unchanged by
 * every part of #4278, and this line is where that holds — `recordObject`
 * (#4292) is read on the same terms, i.e. not at all on that surface.
 *
 * `recordObject` is carried to the loader rather than judged here: the object
 * it must agree with is the FormView's, which only the view metadata knows, so
 * the comparison happens where that arrives ({@link loadInternalForm}). What
 * this function decides is unchanged — create, edit, or refuse from the URL
 * alone. A blank or whitespace-only `recordObject` is treated as ABSENT, not as
 * a mismatch: it asserts nothing, and #4292 ruling point 2 tightens the guard
 * only where identity information is actually present (a URL can always just
 * omit the param, so refusing here would buy nothing and would break the
 * hand-authored deep links the ruling preserves).
 */
export function readFormRecordTarget(
  mode: FormPageMode,
  search: URLSearchParams,
): FormRecordTarget {
  if (mode !== 'internal') return { kind: 'create' };
  const raw = search.get(FORM_RECORD_ID_PARAM);
  // No id ⇒ create, whatever `recordObject` says: with no record named there is
  // nothing for an object assertion to be about.
  if (raw === null) return { kind: 'create' };
  const recordId = raw.trim();
  if (!recordId) {
    return {
      kind: 'refuse',
      reason:
        `This form was opened to edit a record (?${FORM_RECORD_ID_PARAM}=), but no record id was supplied. ` +
        'Re-open it from the record, or drop the parameter to create a new one.',
    };
  }
  const declaredObject = (search.get(FORM_RECORD_OBJECT_PARAM) ?? '').trim();
  return { kind: 'edit', recordId, recordObject: declaredObject || null };
}

/**
 * What the renderer actually does after a successful submit: every authorable
 * {@link SubmitBehavior}, plus the one behaviour the PLATFORM supplies rather
 * than the author.
 *
 * `created-record` is deliberately NOT a member of the spec's authorable union
 * (`thank-you | redirect | continue | next-record` — a STRICT discriminated
 * union in `@objectstack/spec`, so authoring `kind: 'created-record'` is
 * rejected at publish time and always will be). Nothing ever parses it out of
 * metadata: it exists only as the value {@link resolveSubmitBehavior} returns
 * when an internal form declares nothing. That is what lets the platform
 * default differ from every authorable kind WITHOUT widening the contract or
 * teaching authors a second dialect for something they never write.
 *
 * Since objectui#4278 the internal route also EDITS, and this one value covers
 * both writes: "land on the record this submit wrote" — the created one, or
 * the one `?recordId=` named. It is one behaviour, so it keeps one name; a
 * second `updated-record` kind would be two spellings of a single rule, and
 * the name is #4109's rather than churned here because renaming it would
 * restate a just-landed contract for cosmetics. The create/edit split lives
 * where it belongs — in the id the handler navigates with, not in the union.
 */
type EffectiveSubmitBehavior = SubmitBehavior | { kind: 'created-record' };


/** Normalized field row used by the renderer. */
interface RenderableField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  readonly: boolean;
  hidden: boolean;
  /**
   * Conditional visibility for this row, as authored on the FORM VIEW's field
   * — the predicate {@link isFieldVisible} evaluates against the LIVE form
   * values, as distinct from the static `hidden` flag above.
   *
   * The VIEW level, specifically: the object field's own `visibleWhen` is a
   * separate rule that lives in {@link RenderableField.rules} and is ANDed with
   * this one by {@link resolveRowState} (objectui#5627). Two layers may both
   * condition one control, and either one hiding it is enough.
   *
   * Read from `visibleWhen` ONLY (objectui#12654). ADR-0089 renamed the key,
   * and `@objectstack/spec` 18 retires the old `visibleOn` spelling as a
   * `retiredKey` tombstone (objectstack#23543 F4): every parsing door refuses
   * it by name, and a stored row written with it is rehydrated to
   * `visibleWhen` before it is served. A raw view still carrying `visibleOn`
   * is therefore an authoring mistake the spec reports, and this reader does
   * not fold it back — a renderer-side `??` would hide that mistake. The
   * runtime form chain reads the same single key
   * (`@object-ui/plugin-form` `sectionFields.ts`).
   *
   * The TYPE is derived from the authoring surface rather than restated:
   * re-spelling `string | { dialect?, source }` here would be a third
   * description of one contract, which is the exact class objectui#5542 closed
   * in this file.
   */
  visibleWhen?: FormFieldSpec['visibleWhen'];
  /**
   * The OBJECT-level rules (ADR-0036) copied off {@link ObjectFieldDef} —
   * `visibleWhen`, `readonlyWhen`, `requiredWhen` (objectui#5627).
   *
   * Carried as a GROUP rather than as three sibling keys because the group IS
   * `resolveFieldRuleState`'s first parameter: {@link resolveRowState} hands
   * this object over whole, so there is no per-key re-assembly step for a
   * fourth consumer-side copy of the rule semantics to hide in. Nesting also
   * settles the one genuine ambiguity in this row type — `visibleWhen` one
   * level up is the VIEW's predicate, `rules.visibleWhen` is the OBJECT's, and
   * the sibling chain's runtime `FormField` happens to spell that same pair the
   * other way round (`visibleWhen` = object, `visibleOn` = view). A reader of
   * either file can tell which layer a predicate came from without knowing the
   * other file's convention.
   *
   * Carried, not evaluated, for the reason the view-level slot is: the verdict
   * depends on the live values, and these rows are memoized on the loaded spec.
   */
  rules?: {
    visibleWhen?: FieldRulePredicate;
    readonlyWhen?: FieldRulePredicate;
    requiredWhen?: FieldRulePredicate;
  };
  placeholder?: string;
  helpText?: string;
  defaultValue?: unknown;
  options?: Array<{ value: string; label: string }>;
  maxLength?: number;
  /**
   * The upload configuration, copied straight off the object field — see
   * {@link ObjectFieldDef.multiple} — and handed on to the shared widget whole
   * rather than re-interpreted here. `multiple` is the EFFECTIVE one (the form
   * view's, else the object's), because it also decides WHICH widget renders.
   */
  multiple?: boolean;
  accept?: string[];
  maxSize?: number;
  /**
   * The authored render hint — the form view field's `widget`, else the object
   * field's (objectui#10177). Same precedence as the sibling chain
   * (`sectionFields.ts` copies `fd.widget` over the object field; `form.tsx`
   * resolves `f?.widget || f?.field?.widget || f?.type`).
   */
  widget?: string;
  /**
   * The object field exactly as the server served it — every key, not only the
   * ones {@link ObjectFieldDef} names — so the widget handed this row finds
   * what it reads off its metadata (a lookup's `reference`, a currency's
   * `currency`, a code editor's `language`). See {@link widgetFieldOf}.
   * Absent on a row built without an object field behind it. Typed as the
   * slice this file names; at runtime it is the whole served object.
   */
  meta?: ObjectFieldDef;
  colSpan: 1 | 2 | 3 | 4;
}

interface RenderableSection {
  /**
   * The section's STABLE authored name (objectui#8813).
   *
   * Carried for ONE reason: it is the only member of this row that may appear
   * in a translation key. The convention is
   * `{ns}.objects.{objectName}._sections.{name}.label`, resolved by
   * `useObjectLabel().sectionLabel` — so with `name` dropped at build time the
   * key could not be CONSTRUCTED at the render site, whatever the renderer
   * did there. That is why carrying it is a precondition of the section half
   * of #8813 rather than a tidy-up that could follow it.
   *
   * ⛔ The authored `label` is never the key, not even as a fallback guess:
   * `packages/plugin-form/src/__tests__/sectionLabelI18n.test.tsx` pins that
   * for the sibling renderer, and that pin exists because the two halves of
   * the form renderer had drifted apart once already.
   *
   * Optional because the authoring surface makes it optional
   * ({@link FormSectionSpec}) — a section may be written with a heading and no
   * name, and such a section simply has no key. A group-REFERENCED section
   * (`{ group: 'parties' }`) arrives here already resolved, carrying the
   * group's key as its `name`, so it is translatable on the same convention.
   */
  name?: string;
  label?: string;
  /**
   * The section's description, as served (objectui#12333). On the signed-out
   * `/f/:slug` path the console holds no app bundle (objectui#12034), so the
   * server localizes it under `Accept-Language` (objectstack-ai/objectstack#23497)
   * and the renderer draws it as it arrives, the way `ObjectForm` draws its own.
   */
  description?: string;
  columns: 1 | 2 | 3 | 4;
  collapsible: boolean;
  collapsed: boolean;
  /**
   * Conditional visibility for the whole section (ADR-0089, objectui#5627),
   * read from `visibleWhen` ONLY when the row is built (objectui#12654).
   *
   * The same key and the same reason as the field row one type up: spec 18
   * retires the section's `visibleOn` spelling, so a served FormView carries
   * only `visibleWhen`, and a raw view still writing the old key is refused
   * by the spec rather than folded here. The shared machinery this file
   * imports is the ENGINE — `evalFieldPredicate`, via
   * {@link isSectionVisible} — which is the half that decides anything.
   *
   * Type derived from the shared authoring surface (objectui#5596's
   * {@link FormSectionSpec}) rather than restated, exactly as the field row
   * derives its own from `FormFieldSpec`.
   */
  visibleWhen?: FormSectionSpec['visibleWhen'];
  /**
   * The fault direction of {@link visibleWhen} (objectui#13055), carried off
   * the resolved section: `'hidden'` when the predicate is a field group's
   * (`{ group }` reference), which `@objectstack/spec` declares fail-closed.
   * An authored section's own predicate carries none and faults open. See
   * `ObjectFormSection.visibleWhenFault`.
   */
  visibleWhenFault?: ObjectFormSection['visibleWhenFault'];
  fields: RenderableField[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Coerce a `columns` literal into a numeric 1..4. */
export function normalizeColumns(c: unknown): 1 | 2 | 3 | 4 {
  const n = typeof c === 'string' ? parseInt(c, 10) : (c as number);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return 2;
}

/** Normalize field options from various Object schema shapes into `{value,label}`. */
export function normalizeOptions(opts: unknown): Array<{ value: string; label: string }> | undefined {
  if (!Array.isArray(opts)) return undefined;
  return opts.map((o) => {
    if (typeof o === 'string') return { value: o, label: o };
    if (o && typeof o === 'object') {
      const v = String((o as any).value ?? (o as any).id ?? '');
      const l = String((o as any).label ?? (o as any).name ?? v);
      return { value: v, label: l };
    }
    return { value: String(o), label: String(o) };
  });
}

/**
 * What `resolveFormWidgetType` answers for a spelling nothing registers — its
 * documented fallback ("anything unknown falls back to `text`"). Read by
 * {@link namesRegisteredWidget} alone.
 */
const UNKNOWN_SPELLING_WIDGET = 'text';

/**
 * Does an authored `widget` spelling name a widget the shared registry holds
 * (objectui#10472)?
 *
 * The spec's `FieldSchema.widget` declares that the override "names a
 * registered field component" and "Degrades to the `type` renderer when
 * unregistered". The `widget` leg of {@link resolveFieldWidgetKey} used to
 * return `resolveFormWidgetType(widget)` unconditionally, and that resolver
 * answers a spelling nothing registers with its `text` fallback — so a
 * `select` field carrying `widget: 'no_such_widget'` rendered a free-text box
 * instead of its select.
 *
 * ⛔ No list of widgets lives here. The question goes to the SAME resolver the
 * row renders through (`getLazyFieldWidget` mounts what it names), and is read
 * for that one documented answer: a spelling it answers with `text`, when the
 * author did not write `text`, named nothing. Everything else it knows keeps
 * resolving as before — a registered key, a retired spelling (whose tombstone
 * still refuses visibly) and an alias of a registered key (`secret` →
 * `password`).
 */
function namesRegisteredWidget(widget: string): boolean {
  return resolveFormWidgetType(widget) !== UNKNOWN_SPELLING_WIDGET || widget === UNKNOWN_SPELLING_WIDGET;
}

/**
 * The registered widget key a row renders (objectui#10179, objectui#10177).
 *
 * ⛔ No mapping lives here. Every step is the shared chain's own answer, in the
 * order the sibling renderer applies them:
 *
 *  1. an authored `widget` that names a REGISTERED widget wins over `type`
 *     outright, un-arity'd — `form.tsx` resolves
 *     `f?.widget || f?.field?.widget || f?.type`, where only the `type` leg was
 *     produced by `mapFieldTypeToFormType(type, { multiple })`. One that names
 *     nothing takes the next two steps instead (objectui#10472), because the
 *     spec's `FieldSchema.widget` declares that it "Degrades to the `type`
 *     renderer when unregistered" — see {@link namesRegisteredWidget};
 *  2. otherwise ARITY: `mapFieldTypeToFormType` is asked for the multi-value
 *     answer, and it is taken only where the shared table says the arity MOVES
 *     the widget (`select` + `multiple` → `multiselect`). Every other
 *     multi-capable type (`lookup`, `file`, `image`, `user`) renders both
 *     arities inside one widget, so it keeps the key the resolver gives the
 *     bare type — the membership of that table is `@object-ui/fields`'s, not
 *     restated here;
 *  3. `resolveFormWidgetType` for the rest — aliases, retired spellings (a
 *     tombstone that refuses visibly) and the documented `text` fallback for
 *     a spelling nothing registers.
 */
function resolveFieldWidgetKey(field: {
  type: string;
  widget?: string;
  multiple?: boolean;
}): string {
  if (field.widget && namesRegisteredWidget(field.widget)) {
    return resolveFormWidgetType(field.widget);
  }
  if (field.multiple) {
    const multi = mapFieldTypeToFormType(field.type, { multiple: true });
    if (multi !== mapFieldTypeToFormType(field.type)) {
      return resolveFormWidgetType(multi.replace(/^field:/, ''));
    }
  }
  return resolveFormWidgetType(field.type);
}

/**
 * How a row's visible label reaches the widget with this key — the widget's
 * own `labelling` declaration (`FIELD_WIDGET_LABELLING`, objectui#3961 /
 * #4857), never a guess made here:
 *
 *  - `'control'` — the widget renders a labelable element carrying the host
 *    id, so a plain `<label for>` names it;
 *  - `'group'` — a composite or a non-labelable control (a radio group, a chip
 *    row, a dropzone); the label publishes an `id` and the WIDGET answers with
 *    `aria-labelledby`;
 *  - `'display'` — a pure display with no control at all; the HOST wraps it in
 *    a named group, as `form.tsx` does.
 *
 * A key the table does not hold (a retired spelling's tombstone) is
 * `'control'`, the same default every host reads for an absent declaration.
 */
function widgetLabelling(widgetKey: string): 'control' | 'group' | 'display' {
  return (FIELD_WIDGET_LABELLING as Record<string, 'control' | 'group' | 'display' | undefined>)[widgetKey]
    ?? 'control';
}

/**
 * Merge a FormView's section/field overrides with the target object's
 * field definitions to produce concrete rows the renderer can draw.
 * Field-level FormField overrides take precedence over object defaults.
 *
 * ## A field entry's copy is collapsed to `language` here (objectui#13380)
 *
 * `@objectstack/spec`'s `FormFieldBaseSchema` types an entry's `label`,
 * `placeholder` and `helpText` as `I18nLabel`: a string, or an inline
 * per-locale map such as `{ en, 'zh-CN' }`. The public resolver serves the map
 * unchanged, and every row slot below is a `string` that reaches JSX — the
 * label as `fieldLabel`'s fallback, which hands an unmatched fallback back
 * untouched. So one map on a label or help line rendered an object as a React
 * child and blanked the page for every visitor, on both routes; on a
 * placeholder it read `[object Object]`.
 *
 * The map is reduced with `pickLocalized`, the resolver
 * `useActionTextLocalizer` collapses an action's `I18nLabel` copy with, BEFORE
 * it becomes the row: a row then carries one string, and that string is what
 * the bundle lookup at the render site falls back to — the same order the
 * action hook uses. `FormFieldSpec` narrows these keys to `string`, which
 * describes what this builder EMITS, not what the wire may carry, so the read
 * is not gated on the declared type.
 *
 * `language` is the visitor's (`useObjectTranslation().language`). Left out,
 * `pickLocalized` reads `en`, so a caller that has no language still gets a
 * string.
 */
export function buildSections(
  form: FormViewSpec,
  objectSchema: ObjectSchemaPayload | null,
  language?: string,
): RenderableSection[] {
  const objFields = objectSchema?.fields ?? {};
  // An absent key stays absent: `pickLocalized` spells a miss `''`, and an
  // empty placeholder or help line is not the same row as none.
  const localized = (value: unknown): string | undefined =>
    value == null ? undefined : pickLocalized(value, language);
  /**
   * A section may declare its members EITHER way (objectui#8641): enumerate
   * `fields`, or point `group` at one of the object's declared `fieldGroups`
   * (`@objectstack/spec` 17.3.0, objectstack#13855, ADR-0085 §5). The loop
   * below reads `sec.fields ?? []` and `sec.label`, and a `{ group }` section
   * carries neither — measured in the DOM on both routes before this call
   * existed: an empty bordered card, no heading, zero inputs, no diagnostic.
   *
   * ⛔ Nothing about the assembly is decided here. Declared order, the
   * empty-group drop, the ungrouped trailing bucket and the collapse /
   * `visibleWhen` passthrough all come from `deriveFieldGroupLayout` through
   * `@object-ui/plugin-form`'s ONE adapter onto the section shape — the same
   * code path `ObjectForm` resolves through, published for this call site
   * (objectui#7051's standing constraint, and the reason this is an import
   * rather than a second reader of the derivation). A group authored by
   * reference renders the same section in this app and in the plugin because
   * one of them IS the other's code path.
   *
   * `formType` is forwarded so a shape `@objectstack/spec` REFUSES gets the
   * same answer here as there: `group` on a `formType: 'wizard'` section
   * renders nothing and says why, rather than this renderer honouring what the
   * spec door declines to accept.
   *
   * `resolvable` is left at its default. This builder only ever runs after the
   * load settled, so a null `objectSchema` means the object metadata is
   * genuinely absent — a failure the load path owns — and reporting a dangling
   * group reference for it would be a second, wrong diagnosis of one failure.
   */
  const authored = form.sections ?? form.groups ?? [];
  const sections = (resolveSectionGroupReferences(
    // Two packages describing ONE authored document: `FormSectionSpec` is the
    // app-shell authoring type this app reads, `ObjectFormSection` the plugin's
    // name for the same section. The parameter type is taken FROM the published
    // signature rather than restated, so a change to it lands here as a compile
    // error instead of a silent mismatch.
    authored as unknown as NonNullable<Parameters<typeof resolveSectionGroupReferences>[0]>,
    {
      objectName: objectSchema?.name ?? '',
      formType: form.type,
      objectDef: objectSchema,
    },
  ) ?? []) as unknown as Array<FormSectionSpec & Pick<ObjectFormSection, 'visibleWhenFault'>>;
  return sections.map((sec) => {
    const cols = normalizeColumns(sec.columns);
    const fields: RenderableField[] = [];
    for (const entry of sec.fields ?? []) {
      const override: FormFieldSpec =
        typeof entry === 'string' ? { field: entry } : { ...entry };
      const def: ObjectFieldDef =
        objFields[override.field] ?? ({ type: 'text' } as ObjectFieldDef);
      fields.push({
        name: override.field,
        // objectui#13380 — the three `I18nLabel` keys, collapsed to the
        // visitor's language before they reach a `string` slot.
        label: localized(override.label ?? def.label) ?? override.field,
        type: def.type ?? 'text',
        required: override.required ?? def.required ?? false,
        readonly: override.readonly ?? false,
        hidden: override.hidden ?? false,
        // The one spelling — see `RenderableField.visibleWhen`. Carried, not
        // evaluated: the verdict depends on the live form values, which change
        // per keystroke, while these rows are memoized on the loaded spec.
        visibleWhen: override.visibleWhen,
        // The OBJECT's own rules (ADR-0036), off the object field and NOT
        // merged with the view predicate above: two layers, two slots, ANDed
        // at render by `resolveRowState` (objectui#5627). A `??` here would be
        // the collapse the sibling chain avoids on purpose — a view predicate
        // would then clobber the object's rule instead of narrowing it.
        rules: {
          visibleWhen: def.visibleWhen,
          readonlyWhen: def.readonlyWhen,
          requiredWhen: def.requiredWhen,
        },
        placeholder: localized(override.placeholder ?? def.placeholder),
        helpText: localized(override.helpText ?? def.helpText),
        defaultValue: def.defaultValue,
        options: normalizeOptions(def.options),
        // The FORM's ceiling wins over the object's, exactly like every
        // sibling key above. This one key read `def` alone, so a tighter
        // per-form limit — a short public intake form over a generously
        // sized column — was discarded with no diagnostic, and the docstring
        // promising overrides win was false for it (objectui#5595). The
        // override can only NARROW what the author sees at the input; the
        // object's storage ceiling still decides at submit time.
        maxLength: override.maxLength ?? def.maxLength,
        // The object's upload configuration. `accept` / `maxSize` read `def`
        // alone: the FormView field override (`FormFieldSpec`) declares
        // neither. `multiple` IS declared there, and it is the arity half of
        // the widget decision, so the override wins as for every sibling key
        // above — the precedence `sectionFields.ts` applies (objectui#10179).
        multiple: override.multiple ?? def.multiple,
        accept: def.accept,
        maxSize: def.maxSize,
        // objectui#10177 — the authored render hint, view over object.
        widget: override.widget ?? def.widget,
        colSpan: override.colSpan ?? 1,
        // Carried whole for the widget — see `RenderableField.meta`. Only the
        // served object field, never a synthesized stand-in: the `text`
        // fallback above describes a missing definition, not metadata.
        meta: objFields[override.field],
      });
    }
    return {
      // objectui#8813 — the copy the render site's translation key is built
      // from. Before it, this builder read `sec.label` and dropped `sec.name`
      // on the floor, and the public form `/f/:slug` rendered every section
      // heading in the authoring language no matter what the app bundle
      // carried. See `RenderableSection.name`.
      name: sec.name,
      label: sec.label,
      description: sec.description,
      columns: cols,
      collapsible: !!sec.collapsible,
      collapsed: !!sec.collapsed,
      // The one spelling, as on the field row — see
      // `RenderableSection.visibleWhen` (objectui#5627, objectui#12654).
      visibleWhen: sec.visibleWhen,
      visibleWhenFault: sec.visibleWhenFault,
      fields,
    };
  });
}

/**
 * Is this row on screen, given the form's current state?
 *
 * Two independent reasons a field is not rendered, answered in ONE place so
 * "is this field visible" has a single reader:
 *
 *  1. `hidden: true` — the static flag. Unconditional.
 *  2. `visibleWhen` — the conditional predicate (ADR-0089), evaluated against
 *     the live form values on every render.
 *
 * The predicate is routed through the CANONICAL engine — `evalFieldPredicate`
 * (`@object-ui/core`, `evaluator/fieldRules.ts`) — which is objectui#2212's
 * ruling applied verbatim rather than a second predicate semantics invented
 * for this renderer. Two form renderers disagreeing about what `visibleWhen`
 * MEANS would be a worse defect than one renderer ignoring it. So the engine,
 * the accepted wire shapes (bare CEL string and `{ dialect, source }`), the
 * bound scope and the failure behaviour are the shared ones by construction,
 * not by agreement.
 *
 * Scope: `record.*` is the LIVE values — what the inputs currently hold, not
 * what was loaded — so a predicate re-decides as the user types, which is the
 * whole point of a conditional field. `previous.*` is the stored record an
 * edit form started from (objectui#4278), unbound on a create form. That is
 * the same pair `form.tsx` binds on the sibling chain.
 *
 * Fail-open (`fallback: true`) is deliberate and shared: a predicate that
 * cannot be evaluated must not HIDE a field, because a hidden field is one the
 * submitter can neither fill in nor see is missing. Open does not mean silent
 * — `evalFieldPredicate` warns once per predicate text, naming the field.
 *
 * ## What this deliberately does NOT do
 *
 * It does not strip the VALUE of a field it hides. `values` still carries
 * whatever {@link readPrefill} seeded and `handleSubmit` still submits it —
 * exactly what a statically `hidden: true` field has always done here, and
 * what the plugin-form chain does (#2212's fix returns `null` at render and
 * clears stale ERRORS, never values). Conditional visibility is a rendering
 * rule in both renderers; making it a submit-payload rule would be a new
 * contract, decided once for both, not invented here in the second one.
 */
export function isFieldVisible(
  field: RenderableField,
  values: Record<string, unknown>,
  previous?: Record<string, unknown> | null,
  predicateScope?: Record<string, unknown>,
): boolean {
  if (field.hidden) return false;
  return evalFieldPredicate(field.visibleWhen, values, true, previous ?? undefined, predicateScope, {
    // Named for the one key this row reads (ADR-0089, objectui#12654).
    context: `visibleWhen of field '${field.name}'`,
  });
}

/**
 * Is this SECTION on screen, given the form's current state? (objectui#5627)
 *
 * The section-granularity twin of {@link isFieldVisible}, and deliberately the
 * same three things: the one-key read (done once, at build time —
 * `RenderableSection.visibleWhen`), the canonical ENGINE
 * (`evalFieldPredicate`), and fail-OPEN with a one-time warning. A section that
 * cannot be evaluated must not vanish, for the field-level reason multiplied by
 * however many controls it holds: a section nobody can see is one the submitter
 * can neither fill in nor notice is missing.
 *
 * Scope is the same pair the field predicate binds — live `record.*`, stored
 * `previous.*` — so an author writes ONE dialect for both granularities, and
 * `SECTION.visibleWhen` and `FIELD.visibleWhen` cannot disagree about what
 * `record.status` refers to.
 *
 * ## Rendering rule, ruled (triage first-touch, 2026-08-22)
 *
 * > Section-level visibility is a rendering rule — a hidden section's fields
 * > still submit, matching the field-level answer #5594 deliberately kept and
 * > the plugin-form chain.
 *
 * So this decides what is DRAWN and nothing else: `values` still carries what
 * {@link readPrefill} seeded and `handleSubmit` still submits it, exactly as a
 * field hidden by its own predicate has done here since #5594.
 */
export function isSectionVisible(
  section: RenderableSection,
  values: Record<string, unknown>,
  previous?: Record<string, unknown> | null,
  predicateScope?: Record<string, unknown>,
): boolean {
  // A field group's predicate is fail-CLOSED (objectui#13055): one that cannot
  // be evaluated hides the section, and the warning names `false` as the
  // default taken. Every other section keeps the fail-open answer above.
  if (section.visibleWhenFault === 'hidden') {
    if (section.visibleWhen == null) return true;
    return evalFieldPredicate(section.visibleWhen, values, false, previous ?? undefined, predicateScope, {
      context: `visibleWhen of field group section '${section.label ?? '(unlabelled)'}' — fail-closed, the section is hidden`,
    });
  }
  return evalFieldPredicate(section.visibleWhen, values, true, previous ?? undefined, predicateScope, {
    // The locator is the heading an author can actually find in their own
    // metadata; an unlabelled section says so rather than printing
    // `undefined`. Sections DO carry a `name` since objectui#8813, and this
    // deliberately keeps naming the heading: a warning is read by the person
    // looking at the screen, where the heading is what they see, and the
    // wording is pinned by `FormPage.conditionalRules.test.tsx`.
    context: `visibleWhen of section '${section.label ?? '(unlabelled)'}'`,
  });
}

/**
 * The row's EFFECTIVE `{ visible, readonly, required }` — every conditional
 * rule that bears on one control, resolved in one place (objectui#5627).
 *
 * Three of the four inputs are the OBJECT-level rules (`rules.visibleWhen`,
 * `readonlyWhen`, `requiredWhen`) and they are not evaluated here at all: they
 * go to `@object-ui/core`'s `resolveFieldRuleState`, the engine the sibling
 * renderers (`renderers/form/form.tsx`, `WizardForm`, `GridField`,
 * `plugin-kanban`) already share. That reuse is the point of the card — a
 * FOURTH consumer-side re-implementation of "what does readonlyWhen mean" is
 * the defect, not the fix — and it is what carries three settled rulings in
 * without re-deriving any of them: a static `readonly: true` is never weakened
 * by a false predicate, a static `required: true` is never weakened by a false
 * one either, and `serverOwnedValue` outranks both spellings of required.
 *
 * ## `isCreateForm` is the CALLER's fact
 *
 * `resolveFieldRuleState` must be told whether this submit is an INSERT; it may
 * not infer it (objectui#4085 — an evaluator guessing from a missing `previous`
 * would read an edit form that simply passes none as a create). This renderer
 * knows it exactly, from the URL: {@link readFormRecordTarget} already decided
 * create / edit / refuse, and `/f/:slug` is create by construction. Passed as a
 * required parameter rather than defaulted, so a new call site cannot get edit
 * semantics by omission.
 *
 * On a create form a field whose `defaultValue` is a runtime instruction the
 * server resolves per insert (`NOW()`, `current_user`, a CEL envelope) is
 * therefore not required — whatever `requiredWhen` evaluates to (#4085) and
 * whatever the static flag says (#4069). Both halves come from the resolver,
 * not from a carve-out re-derived here; `isServerOwnedValue` is likewise the
 * shared classifier, handed the declared default this row already carries.
 *
 * ## The two visibility LAYERS are ANDed, never collapsed
 *
 * A view-level predicate ({@link isFieldVisible}) and an object-level one
 * (`rules.visibleWhen`) are different authoring slots with different owners,
 * and the sibling chain keeps them separate for exactly that reason. Either
 * one resolving false hides the control; neither can re-show what the other
 * hid. Both are evaluated on every call even when the first has already
 * decided, because the warning a broken predicate emits is the author's ONLY
 * diagnostic — short-circuiting would make a typo in one layer invisible
 * whenever the other happened to hide the row.
 */
export function resolveRowState(
  field: RenderableField,
  values: Record<string, unknown>,
  previous: Record<string, unknown> | null | undefined,
  isCreateForm: boolean,
  predicateScope?: Record<string, unknown>,
): { visible: boolean; readonly: boolean; required: boolean; faults: FieldRuleFaults } {
  const ruleState = resolveFieldRuleState(
    field.rules ?? {},
    values,
    {
      required: field.required,
      readonly: field.readonly,
      serverOwnedValue: isServerOwnedValue(
        // The shape that classifier reads — the resolved object-field metadata
        // and its declared default, which is what `def.defaultValue` already
        // put on this row in `buildSections`.
        { field: { defaultValue: field.defaultValue } },
        isCreateForm,
      ),
    },
    previous ?? undefined,
    predicateScope,
    `field '${field.name}'`,
  );
  const viewVisible = isFieldVisible(field, values, previous, predicateScope);
  return {
    visible: ruleState.visible && viewVisible,
    readonly: ruleState.readonly,
    required: ruleState.required,
    // The OBJECT-level rules' fault report, passed through untouched for the
    // submit check (objectui#8069). The view-level predicate has none: it is
    // a layout gate, evaluated by `isFieldVisible`, and not a field rule.
    faults: ruleState.faults,
  };
}

/**
 * The post-submit behaviour actually applied, given what the form view
 * declared and which surface is rendering it.
 *
 * Maintainer ruling, 2026-08-10 (objectstack#7245, quoted verbatim on
 * objectui#4109):
 *
 * > **the `type: 'form'` contract means in-shell, and an internal submit lands
 * > on the record.**
 * >
 * > 2. Internal-mode submit defaults to redirect-to-created-record;
 * >    `thank-you` stays the default for the public `/f/:slug` path only.
 *
 * Before this, the default was `{ kind: 'thank-you' }` for BOTH modes, so a
 * signed-in operator who had just created a record was told "Your submission
 * has been received" with no link to it — the anonymous-form confirmation,
 * shown to someone who is not anonymous and is not done.
 *
 * The DECLARED behaviour still wins in both modes, and that precedence is the
 * point: per ruling point 3 the corpus must never have to opt out of a wrong
 * default, so this only ever fills the gap an author left empty.
 */
export function resolveSubmitBehavior(
  mode: FormPageMode,
  declared: SubmitBehavior | undefined,
): EffectiveSubmitBehavior {
  if (declared) return declared;
  return mode === 'internal' ? { kind: 'created-record' } : { kind: 'thank-you' };
}

/**
 * Strip the transport envelope off a data-API body, if there is one.
 *
 * Not a metadata dialect but a platform fact: two transports serve these
 * routes and only one wraps the body. `packages/rest`'s server answers the
 * bare protocol payload (`res.json(result)`), while the runtime's
 * http-dispatcher wraps every success as `{ success, data, meta }`. The
 * platform already resolves this in exactly ONE rule, in
 * `@objectstack/client`:
 *
 *     async unwrapResponse(res) {
 *       const body = await res.json();
 *       if (body && typeof body.success === 'boolean' && 'data' in body) return body.data;
 *       return body;
 *     }
 *
 * `FormPage` hand-rolls `fetch` instead of going through that client (it
 * predates having one here), so the same rule has to be applied at these call
 * sites. Mirroring it is not inventing a dialect — spelling a DIFFERENT rule
 * would be, which is why this is ONE function read by every data-API response
 * this file consumes (create, and since #4278 the record read) rather than the
 * same three lines written out twice.
 *
 * Returns null for anything that is not an object, so callers get one shape to
 * check instead of two.
 */
function unwrapTransportEnvelope(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  const unwrapped =
    typeof body.success === 'boolean' && 'data' in body ? body.data : body;
  if (!unwrapped || typeof unwrapped !== 'object') return null;
  return unwrapped as Record<string, unknown>;
}

/**
 * The id of the record an internal submit just created, read off the
 * `POST /api/v1/data/:object` response.
 *
 * The response contract is spec-declared — `CreateDataResponse = { object, id,
 * record, droppedFields? }` (`@objectstack/spec`, `api/protocol.zod.ts`) — and
 * the top-level `id` IS the created record's id. We read that one declared key
 * and no alias: `record.id` carries the same value, but reading both would be
 * exactly the second de-facto contract AGENTS.md #0.1 forbids.
 *
 * The transport envelope is absorbed by {@link unwrapTransportEnvelope} —
 * see there for why that is a platform fact rather than a dialect.
 *
 * ## Why the EDIT path does not use this (objectui#4278)
 *
 * `UpdateDataResponse` was measured and declares the identical triple
 * (`{ object, id, record, droppedFields? }`, `api/protocol.zod.ts`), so this
 * function would fit an update response byte for byte. It is deliberately not
 * pointed at one: on the edit path the id is already known — it came from the
 * URL and is the id we just `PATCH`ed — so reading it back would create a
 * SECOND source for one fact, and the two could only ever disagree by way of a
 * server bug this renderer would then silently follow. The create path has no
 * such source, which is exactly why it must read the response. One fact, one
 * reader, chosen per path.
 *
 * Returns null when the payload names no id, so the caller can confirm the
 * submit instead of navigating to `…/record/undefined`.
 */
export function readCreatedRecordId(payload: unknown): string | null {
  const unwrapped = unwrapTransportEnvelope(payload);
  if (!unwrapped) return null;
  const id = unwrapped.id;
  // The spec declares `id: z.string()`. The numeric branch is a coercion of
  // that SAME key for drivers whose primary key surfaces as an integer — one
  // key, one meaning, so it cannot mask a producer emitting the wrong shape.
  if (typeof id === 'string') return id === '' ? null : id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return null;
}

/**
 * The stored record an edit form starts from, read off the
 * `GET /api/v1/data/:object/:id` response.
 *
 * The response contract is spec-declared — `GetDataResponse = { object, id,
 * record }` (`@objectstack/spec`, `api/protocol.zod.ts`; the protocol's
 * `getData` returns exactly that triple and throws `recordNotFoundError`
 * otherwise, which REST maps to 404). The envelope is handled by
 * {@link unwrapTransportEnvelope}.
 *
 * Throws — rather than returning null — on anything it cannot vouch for,
 * because #4278 ruling point 2 is fail-closed and this function is the last
 * place that can tell an unreadable record from an empty one. A null return
 * would land in the same `values` state as create mode, which is the harm.
 *
 * ## The object check, and the honest limit of it
 *
 * The `object` key is compared against the FormView's target, and a mismatch
 * refuses. Measured reachability: the deployed server ECHOES the path object
 * (`getData` returns `object: request.object`), and we build that path from
 * the view's own target — so a live `packages/rest` deployment cannot produce
 * a mismatch here. This is therefore a contract assertion at the consumer, not
 * a live defect being patched; it costs three lines and it is what makes the
 * form's object and the record's object one checked fact instead of an
 * assumption, for any transport that does not echo.
 *
 * The case that IS live is the other one, and it is handled by the fetch
 * rather than by this check: a `recordId` belonging to a DIFFERENT object is
 * not found under the view's object, so the read 404s and refuses. See
 * `loadInternalForm`.
 */
export function readLoadedRecord(
  payload: unknown,
  expectedObject: string,
  recordId: string,
): Record<string, unknown> {
  const unwrapped = unwrapTransportEnvelope(payload);
  if (!unwrapped) {
    throw new Error(
      `Could not read record "${recordId}" of ${expectedObject}: the server returned no record payload.`,
    );
  }
  const servedObject = unwrapped.object;
  if (typeof servedObject === 'string' && servedObject && servedObject !== expectedObject) {
    throw new Error(
      `Record "${recordId}" belongs to ${servedObject}, but this form edits ${expectedObject}. ` +
        'Refusing to open it — check the action that linked here.',
    );
  }
  const record = unwrapped.record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(
      `Could not read record "${recordId}" of ${expectedObject}: the response carried no "record".`,
    );
  }
  return record as Record<string, unknown>;
}

/**
 * The initial form state — every value an input starts life holding.
 *
 * Three sources, in strictly increasing precedence (#4278 ruling on prefill):
 *
 *  1. the field's `defaultValue` from the object schema — a CREATE-time
 *     proposal, and only when it is a LITERAL one (objectui#5727 — see below);
 *  2. the stored `record`, when this form is editing one. Present-but-null
 *     counts and beats a default: on an edit form the stored value is the
 *     truth, and letting a default paint over a cleared field would silently
 *     propose a change the user never made — which a subsequent save would
 *     then write;
 *  3. an explicit `?prefill_<field>=` query param, which wins over both.
 *
 * Point 3 is the ruling: "explicit `prefill_` params override the loaded
 * record's values for the fields they name … record values fill the rest". A
 * producer that forwards `?recordId=` AND `?prefill_x=` in one URL is
 * expressing intent — edit THIS record, with THIS field pre-changed — and the
 * narrower, per-field instruction is the more specific one. Fields the params
 * do not name keep their stored values, so the precedence is per FIELD and
 * never wholesale.
 *
 * ## A RUNTIME default is not a value, so it is not seeded (objectui#5727)
 *
 * Source 1 above admits only LITERAL defaults. A `defaultValue` may instead be
 * an *instruction* the server resolves per insert — a `DEFAULT_VALUE_TOKENS`
 * token (`'NOW()'` / `'current_user'`) or a CEL Expression envelope
 * (`{ dialect: 'cel', source: 'today()' }`). Seeding one of those literally is
 * worse than leaving the control empty: the text `NOW()` lands in a datetime
 * input and is then SUBMITTED as that field's value, and
 * `ObjectQL.applyFieldDefaults` resolves a declared default only for a field
 * that arrives absent or null — so seeding suppresses the very resolution the
 * declaration asked for. Omitting the key is what makes the server the single
 * authority for the value.
 *
 * The classifier is `@object-ui/core`'s {@link isRuntimeDefault}, imported —
 * not re-derived. It is THE published authority for this distinction and this
 * renderer already reads it once removed, via `isServerOwnedValue` in
 * {@link resolveRowState}; a second consumer-side copy would be free to
 * disagree about, say, a CEL envelope, and then this form would seed a field
 * whose `required` rule it also suppresses. `@object-ui/plugin-form`'s
 * `schemaDefaults.ts` guards its own seeding with the same call — this is that
 * settled rule reaching the SECOND form renderer in this repo, which is why
 * the gap survived (#4047 / #4068 fixed the other chain; #4069 / #4085 carried
 * the required-ness half here already).
 *
 * `isRuntimeDefault` specifically, and not `schemaDefaults.ts`'s
 * `isSeedableDefault` wrapper around it: that one additionally rejects `null`,
 * which would quietly change what a declared `defaultValue: null` does on this
 * route. The card is about runtime instructions; the null contract stays as it
 * was (`!== undefined`).
 *
 * Skipping is deliberately NOT gated on create mode, unlike the sibling
 * chain's caller-side gate. On an edit form a record that names the field
 * already outranks any default (source 2), so gating would change nothing
 * there — while a record that leaves the column UNSET is exactly where the
 * literal `NOW()` would still reach a control today. One unconditional rule
 * means "a runtime token never reaches an input on this route", with no mode
 * for it to leak through.
 *
 * The two later sources are untouched: a stored value and an explicit
 * `prefill_` param are real values a producer supplied, not declarations the
 * server is waiting to resolve, so both still fill a runtime-default field.
 *
 * ## An option marked `default: true` is source 1 too (objectui#13049)
 *
 * A field that declares no `defaultValue` may still have one: its option list
 * can mark an option `default: true`, and `ObjectQL.applyFieldDefaults` stores
 * that option when the field arrives absent. Leaving the control empty here
 * made a required select refuse the submit on the client that the server would
 * have accepted and defaulted.
 *
 * The reading is `@object-ui/plugin-form`'s {@link optionListDefault}, the very
 * function the create form's `schemaDefaultValues` calls (objectui#11914) —
 * imported, not re-derived, so the two renderers cannot disagree about which
 * option is the default or about a multi-valued field's array. It reads the
 * served object field ({@link RenderableField.meta}), whose options still carry
 * the flag; the row's own `options` are normalized to `{ value, label }` and
 * have dropped it. The create form's precedence carries over whole:
 *
 *   - only when `defaultValue == null`, the engine's own presence test, so a
 *     literal `defaultValue` wins and a RUNTIME one is never replaced by a flag
 *     the server does not apply to that field;
 *   - only with no `record`: the create form never seeds an edit form, and a
 *     column the stored row leaves unset is not this form's to fill;
 *   - a `prefill_` param still outranks it, as it outranks every default.
 */
export function readPrefill(
  fields: RenderableField[],
  search: URLSearchParams,
  record?: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    // Runtime defaults are the server's to resolve, so the key is left ABSENT
    // rather than seeded — see the docblock's #5727 section.
    const fromOptions =
      !record && f.defaultValue == null ? optionListDefault(f.meta) : undefined;
    if (fromOptions !== undefined) {
      out[f.name] = fromOptions;
    } else if (f.defaultValue !== undefined && !isRuntimeDefault(f.defaultValue)) {
      out[f.name] = f.defaultValue;
    }
    // `hasOwnProperty` rather than a truthiness/undefined test: a stored null
    // or empty string is a real value on an edit form, and must beat the
    // default.
    if (record && Object.prototype.hasOwnProperty.call(record, f.name)) {
      out[f.name] = record[f.name];
    }
    const fromQuery = search.get(`prefill_${f.name}`);
    if (fromQuery !== null) out[f.name] = fromQuery;
  }
  return out;
}

/**
 * Drop the keys a CREATE payload must leave to the producer (objectui#5883).
 *
 * ## The other half of {@link readPrefill}'s #5727 fence
 *
 * #5727 stopped this renderer from SEEDING a runtime default, so such a control
 * opens empty and its key never enters `values` from the declaration. That is
 * the half that handles a form nobody touched. This is the half that handles a
 * key the USER put there: a rendered control writes back through its `onChange`
 * the moment it is touched, so a submitter who types into a server-owned field
 * and then clears it puts the key back — holding a blank.
 *
 * `ObjectQL.applyFieldDefaults` resolves a declared default only for a field
 * that arrives ABSENT or NULL. A blank string is neither, so submitting one
 * stores `''` and silently defeats the declaration — the same suppression
 * #5727 closed, reached by the other door. Omitting the key is what makes the
 * server the single authority for the value.
 *
 * ## What "empty" means here, and why it is not spelled out
 *
 * The controls do not agree on what a cleared control writes, and the
 * filter's notion of empty is the whole fix. Measured when this page still
 * hand-rolled its controls (before objectui#10179 routed every row through the
 * shared widgets, which differ the same way): text-like controls write `''`;
 * the number family writes `null` (no `NaN` is reachable); a multi-value
 * control writes an array, possibly empty; the boolean and radio controls have
 * no "cleared" state at all — `false` and a picked option are real values. A
 * filter testing for `''` would therefore have left the number family behind.
 *
 * So emptiness is `@object-ui/core`'s {@link isMissingForRequired} — the same
 * PRESENCE predicate the `required` rule reads, which covers `undefined`,
 * `null`, a blank string and an empty array while deliberately keeping `false`
 * and `0` as values. "Left empty" cannot come to mean two different things in
 * the two halves of this fix, and it cannot come to mean something narrower
 * here than it does on the sibling chain.
 *
 * ## The sibling function, now imported rather than re-composed (objectui#6059)
 *
 * `@object-ui/plugin-form`'s `omitServerResolvedDefaults`
 * (`src/schemaDefaults.ts`) is this rule on the OTHER form chain and states the
 * pairing outright — "excusing a server-owned field from `required` is only
 * half an answer if the form then submits the key anyway". Until #6059 it had
 * no spelling a consumer could import: that package's `exports` map publishes
 * `.` alone and its root did not re-export `schemaDefaults`, so this function
 * carried the composition — `isRuntimeDefault(default) && isMissingForRequired(value)`
 * — written out by hand. The two PREDICATES were never copied (both come from
 * `@object-ui/core`, which is where they live so that every layer deciding
 * server-ownership reads one answer — `validation/server-owned-value.ts` says
 * so, and lists this renderer's `resolveFieldRuleState` among the consumers),
 * but the COMPOSITION existed twice, which #6059 recorded as the structural
 * reason the next renderer would write it a third time.
 *
 * The entry now publishes it, so this function is the CALLER: it keeps the two
 * things that are genuinely this renderer's — the create-mode gate, read off
 * the same URL switch `resolveRowState` uses, and the projection of this page's
 * own rows onto the `{ fields: { [name]: { defaultValue } } }` shape the helper
 * reads — and delegates the rule itself. `RenderableField.defaultValue` is
 * copied straight off the object field in {@link buildSections} (`def`, with no
 * FormView override for that key), so the projection carries exactly the
 * defaults the hand-written version consulted, for exactly the same names; a
 * key that no row declares gets `undefined`, which is what the old
 * `serverOwned` set said about it too. The rows rather than
 * `loaded.objectSchema` deliberately: the previous verdict was a function of
 * the RENDERED rows, and this card is explicit that nothing about the payload
 * may change.
 *
 * This file still reads `isRuntimeDefault` directly for #5727's seeding fence —
 * that half is one predicate, not a composition, and its sibling
 * (`isSeedableDefault`) deliberately differs about `null` (see
 * {@link readPrefill}).
 *
 * ## The two boundaries
 *
 * - **CREATE only.** On an edit form the token was resolved at insert, so a
 *   cleared column is a deliberate removal and dropping the key would silently
 *   discard the user's edit. `isCreateForm` is the caller's fact, read off the
 *   same URL switch `resolveRowState` uses.
 * - **Runtime defaults only.** A field with no default, or with a STATIC one
 *   (which #4068 says IS seeded into the control), keeps its blank: the user
 *   cleared something that was there, or is expressing "leave this empty", and
 *   either way that `''` is intent the form must carry.
 */
export function omitServerOwnedBlanks(
  values: Record<string, unknown>,
  fields: RenderableField[],
  isCreateForm: boolean,
): Record<string, unknown> {
  if (!isCreateForm) return values;
  return omitServerResolvedDefaults(values, {
    fields: Object.fromEntries(fields.map((f) => [f.name, { defaultValue: f.defaultValue }])),
  });
}

/** Authed/anonymous fetch — credentials included so cookies (auth) flow. */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
}

// ─── Loaders ─────────────────────────────────────────────────────────

/**
 * Result of loading a form spec — shared by both public and internal
 * modes so the renderer downstream is mode-agnostic.
 */
interface LoadedForm {
  /**
   * The heading the form names itself by. Undefined only on the internal
   * route, for a form view that names itself nowhere (objectui#13433): the
   * page then heads it with its object's label, resolved through the
   * session's language at render — see the `<h1>` below.
   */
  label: string | undefined;
  object: string;
  form: FormViewBody;
  objectSchema: ObjectSchemaPayload | null;
  /**
   * The stored record this form is editing, or null in create mode
   * (objectui#4278). Non-null iff the load resolved a `?recordId=`.
   */
  record: Record<string, unknown> | null;
}

/** Public mode: hit the anonymous `/forms/:slug` resolver. */
async function loadPublicForm(slug: string): Promise<LoadedForm> {
  const res = await apiFetch(`/forms/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to load form (${res.status}): ${body || res.statusText}`);
  }
  const payload = (await res.json()) as PublicFormPayload;
  return {
    // objectui#8408 — `payload.form?.title` sits AHEAD of the API-name arm.
    //
    // Every arm of the pre-fix chain (`payload.label ?? payload.form?.label ??
    // payload.object`) missed but the last one against what this endpoint
    // actually serves, so the one Console surface an anonymous visitor sees
    // greeted them with the database table name — `ats_inquiry` where the
    // author wrote "Apply". Neither of the first two arms is reachable here:
    //
    //   • `payload.label` is the VIEW's identity label, carried on the
    //     envelope; the public resolver does not send it (it is optional on
    //     {@link PublicFormPayload} and absent from the served body).
    //   • `payload.form.label` is reachable only on a FLATTENED runtime
    //     overlay, where the identity and the config share one object
    //     (`VIEW_METADATA_MEMBERS.formOverlay`). This endpoint returns the
    //     config alone, and a form config carries `title`, NOT `label` —
    //     `FormViewSchema` REJECTS that key outright (`unrecognized_keys`),
    //     as the {@link FormViewBody} note above and `form-spec.ts` both
    //     record.
    //
    // So the ONE real, typed, populated key naming this form was the only one
    // never read. It is read now, and read BEFORE `form.label` because it is
    // the spec-legal spelling of the same intent — the rejected key must never
    // be able to outrank it (AGENTS.md #0.1).
    //
    // `payload.label` keeps its precedence: when an envelope identity label
    // does arrive it is a deliberate per-view name, and this card changed the
    // fallback ORDER, not which value wins where one already did.
    //
    // objectui#12110 item 7 (finding A-09 of the HotCRM browser pass): a form
    // that names itself nowhere is headed by its OBJECT's label, which this
    // endpoint serves on `objectSchema`, before the API name — the database
    // table name is what an anonymous visitor must never be greeted by. The
    // API name stays the last resort, for a payload that carries no label at
    // all; `||` rather than `??` there so an empty label cannot blank the
    // heading.
    label:
      payload.label
      ?? payload.form?.title
      ?? payload.form?.label
      ?? (payload.objectSchema?.label || payload.object),
    object: payload.object,
    form: payload.form,
    objectSchema: payload.objectSchema,
    // The anonymous surface never edits a stored record — see
    // `readFormRecordTarget` for why `?recordId=` is not readable here.
    record: null,
  };
}

/**
 * Unwrap a `/meta/view/:name` response into the {@link FormViewBody} the renderer
 * consumes. Since the ADR-0017 registrar the server returns the flattened
 * ExpandedViewItem envelope — `{ name, object, viewKind, label, config:
 * { type, sections, … } }` — with the actual form spec nested under
 * `config`. Pre-fix, this loader read `sections`/`label` off the envelope
 * itself and rendered every internal form as zero fields plus a bare
 * Submit that "succeeded" (objectui#2208). Older servers / seeded rows may
 * still serve `{ item: { spec } }` or the bare spec, so all shapes are
 * accepted.
 *
 * Also rejects non-form views loudly: a list-view name reaching this route
 * (e.g. an action target hit by the framework#2554 key collision) used to
 * render as that same empty-form false positive.
 */
export function resolveInternalForm(
  name: string,
  viewBody: unknown,
): { label: string | undefined; object?: string; form: FormViewBody } {
  const body = viewBody as Record<string, any> | null;
  const item = body?.item ?? body;
  const spec = item?.spec ?? item;
  const isEnvelope =
    spec && typeof spec === 'object'
    && spec.config && typeof spec.config === 'object'
    && ('viewKind' in spec || 'object' in spec);
  // viewKind may sit on the envelope OR on a flattened list-view body
  // (runtime personalization overlays are persisted with the config at the
  // top level), so read it wherever it is.
  const viewKind: string | undefined =
    spec && typeof spec === 'object' ? spec.viewKind : undefined;
  if (viewKind && viewKind !== 'form') {
    throw new Error(
      `View "${name}" is a ${viewKind} view, not a form view — check the action or link that targets it.`,
    );
  }
  const form: FormViewBody = isEnvelope ? spec.config : spec;
  // A flattened list config carries no viewKind at all but declares a grid/
  // kanban/… visualization type no form renderer understands — same false
  // positive, same loud failure.
  if (!viewKind && form && typeof form === 'object' && typeof form.type === 'string'
    && !FORM_SPEC_TYPES.has(form.type)) {
    throw new Error(
      `View "${name}" is a ${form.type} view, not a form view — check the action or link that targets it.`,
    );
  }
  return {
    // The view's identity label, then the form config's `title` — the same
    // order `loadPublicForm` reads the public payload in (objectui#8408), and
    // for the same reason: `title` is the spec-legal key naming a form, and
    // `form.label` (a flattened overlay's identity label) must not outrank it.
    //
    // No fallback to `name` (objectui#13433). A container's default form —
    // `showcase_task.form`, what the showcase's Log Time opens — carries
    // neither key, and the page was headed by that raw qualified view name.
    // Undefined here means "names itself nowhere"; `FormPage` heads it with
    // the object's label instead, as the public route does.
    label: (isEnvelope ? spec.label : undefined) ?? form?.title ?? form?.label,
    // `data.object` is a declared FormView key since objectui#5596, so this no
    // longer needs `as any` — only a narrowing to the one arm that carries an
    // object name (`ViewDataSchema`'s `provider: 'object'`), read defensively
    // because the body itself is untrusted.
    object: (isEnvelope ? spec.object : undefined)
      ?? (form?.data as { object?: string } | undefined)?.object
      ?? spec?.object,
    form,
  };
}

/**
 * Internal mode: pull the FormView metadata directly + the target object's
 * schema, and — when the URL names a record (objectui#4278) — that record.
 *
 * We use the same `/meta` REST surface the rest of the console already speaks,
 * so anything the user has READ on works automatically.
 *
 * ## Why the record read is fatal when the schema read is not
 *
 * The object-schema fetch below is deliberately swallowed: without it the
 * renderer degrades to text inputs, which is a WORSE form but still the right
 * form, doing the right thing on submit. A failed RECORD read has no such
 * benign degradation — carrying on would render empty inputs and, on submit,
 * insert a duplicate. That is #4278's exact harm, so per ruling point 2 this
 * throws and the caller shows the error state. The gap between the two `catch`
 * postures is the gap between "less detail" and "wrong operation".
 */
async function loadInternalForm(
  name: string,
  recordId?: string | null,
  recordObject?: string | null,
): Promise<LoadedForm> {
  const viewRes = await apiFetch(`/meta/view/${encodeURIComponent(name)}`);
  if (!viewRes.ok) {
    throw new Error(`Form metadata not found: view/${name}`);
  }
  const viewBody = await viewRes.json();
  const { label, object: objectName, form } = resolveInternalForm(name, viewBody);
  if (!objectName) {
    throw new Error(`FormView "${name}" is missing an "object" target`);
  }
  // #4292, the consumer half: the URL asserted which object the id belongs to,
  // and it is not this form's. Refuse HERE — before the object-schema fetch and
  // well before the record read — so a mismatch costs zero `/data/` traffic and
  // can never reach a write. This is the second half of a check the producer
  // already made (`ActionRunner.executeForm` will not forward an id across an
  // object boundary at all); it is not redundant with it, because URLs also
  // arrive hand-written, bookmarked, or from a producer that predates the fix.
  //
  // Distinct from `readLoadedRecord`'s mismatch check, deliberately: that one
  // judges what the SERVER served, this one what the LINK claimed, and the two
  // wordings stay different so a failure names which of them fired.
  if (recordObject && recordObject !== objectName) {
    throw new Error(
      `This form edits ${objectName}, but the link says record "${recordId}" belongs to ` +
        `${recordObject}. Refusing to open it — check the action that linked here.`,
    );
  }
  let objectSchema: ObjectSchemaPayload | null = null;
  try {
    const objRes = await apiFetch(`/meta/object/${encodeURIComponent(objectName)}`);
    if (objRes.ok) {
      const objBody = await objRes.json();
      const objItem = objBody?.item ?? objBody;
      const objSpec = objItem?.spec ?? objItem;
      if (objSpec?.fields && typeof objSpec.fields === 'object') {
        objectSchema = {
          name: objSpec.name ?? objectName,
          label: objSpec.label,
          fields: objSpec.fields,
          // Copied because this rebuild is key by key: a key it does not copy
          // is gone before `buildSections` can see it, which is exactly how a
          // `{ group }` section reached the builder with nothing to resolve
          // against (objectui#8641). The public `/f/:slug` payload needs no
          // such line — `loadPublicForm` forwards the server's `objectSchema`
          // object whole.
          fieldGroups: objSpec.fieldGroups,
        };
      }
    }
  } catch {
    // Schema fallback is non-fatal — the renderer copes with text inputs.
  }

  // #4278: the edit half. Fetched with the VIEW's object, so a `recordId`
  // belonging to some other object is simply not found here and 404s into the
  // refusal below — the live shape of "the record's object doesn't match the
  // form's" (`readLoadedRecord` documents why the echoed `object` key cannot
  // be the signal on this server).
  let record: Record<string, unknown> | null = null;
  if (recordId) {
    const recRes = await apiFetch(
      `/data/${encodeURIComponent(objectName)}/${encodeURIComponent(recordId)}`,
    );
    if (!recRes.ok) {
      const detail = await recRes.text().catch(() => '');
      throw new Error(
        `Could not open record "${recordId}" of ${objectName} for editing (${recRes.status})` +
          `${detail ? `: ${detail}` : recRes.statusText ? `: ${recRes.statusText}` : ''}`,
      );
    }
    record = readLoadedRecord(await recRes.json(), objectName, recordId);
  }

  return {
    label,
    object: objectName,
    form,
    objectSchema,
    record,
  };
}

/** Public mode submit — POST to `/forms/:slug/submit`. */
async function submitPublic(slug: string, data: Record<string, unknown>): Promise<unknown> {
  const res = await apiFetch(`/forms/${encodeURIComponent(slug)}/submit`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Submit failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * Internal mode submit. Auth cookie carries identity.
 *
 * `POST /data/:object` to create; `PATCH /data/:object/:id` to update the
 * record `?recordId=` named (objectui#4278). Before that param was read, this
 * was an unconditional POST — which is why an "edit" action inserted a second
 * record instead of changing the one the user was looking at.
 *
 * The verb is MEASURED, not chosen: `PATCH /:object/:id → updateData` is the
 * data plugin's declared route (`@objectstack/spec`,
 * `api/plugin-rest-api.zod.ts`), it is what `packages/rest`'s server registers,
 * and `packages/rest/src/openapi-builtin-paths.ts` records that the server
 * "answers `PATCH` and 405s the `PUT`" — a published document that said `PUT`
 * was itself filed as a defect (#5588). Every other update client in this
 * workspace spells the same pair: `ApiDataSource.update` (`packages/core`),
 * the console's own API discovery and Integrations pages, and app-shell's
 * `ObjectApiPanel`. The body is the bare field patch, matching create.
 */
async function submitInternal(
  objectName: string,
  data: Record<string, unknown>,
  recordId?: string | null,
): Promise<unknown> {
  const path = recordId
    ? `/data/${encodeURIComponent(objectName)}/${encodeURIComponent(recordId)}`
    : `/data/${encodeURIComponent(objectName)}`;
  const res = await apiFetch(path, {
    method: recordId ? 'PATCH' : 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `${recordId ? 'Update' : 'Create'} failed (${res.status}): ${body || res.statusText}`,
    );
  }
  return res.json().catch(() => ({}));
}

// ─── Field renderers ─────────────────────────────────────────────────

/** The DOM id of a row's control — the host owns it (objectui#3962). */
function controlIdOf(fieldName: string): string {
  return `f_${fieldName}`;
}

/** The id a row's visible label publishes when it is associated by IDREF. */
function labelIdOf(fieldName: string): string {
  return `f_${fieldName}-label`;
}

/**
 * The attributes a row's visible `<label>` carries, from the widget's own
 * labelling declaration ({@link widgetLabelling}) — ONE association channel
 * per label, never two:
 *
 *  - `'control'` → `for` the host id the widget puts on its labelable element;
 *  - `'group'` / `'display'` → an `id`, and NO `for`: the surface that answers
 *    is not labelable (a `radiogroup`, a chip row, a display), so a `for`
 *    beside the IDREF would be a second, dangling channel. The widget (group)
 *    or the host's wrapper (display) answers with `aria-labelledby`.
 *
 * This is what fixed the two a11y defects objectui#10178 measured on the old
 * hand-rolled arms: the radio arm's `for` named no element (so the group had
 * no name and no required state), and the checkbox arm's own wrapping label
 * doubled the name (`Agree * Agree`).
 */
function rowLabelProps(
  field: Pick<RenderableField, 'name' | 'type' | 'widget' | 'multiple'>,
): { htmlFor: string } | { id: string } {
  return widgetLabelling(resolveFieldWidgetKey(field)) === 'control'
    ? { htmlFor: controlIdOf(field.name) }
    : { id: labelIdOf(field.name) };
}

/**
 * The metadata a row's widget is handed as its `field` prop: the object field
 * as served ({@link RenderableField.meta}), with this row's MERGED values laid
 * over it — the form view's label, placeholder, options, ceiling, arity and
 * render hint win, exactly as they win everywhere else on the row.
 */
function widgetFieldOf(field: RenderableField): Record<string, unknown> {
  return {
    ...(field.meta ?? {}),
    name: field.name,
    label: field.label,
    type: field.type,
    widget: field.widget,
    placeholder: field.placeholder,
    options: field.options,
    maxLength: field.maxLength,
    multiple: field.multiple,
    accept: field.accept,
    maxSize: field.maxSize,
  };
}

interface FieldInputProps {
  field: RenderableField;
  /**
   * The row's EFFECTIVE required/readonly verdict for the CURRENT values, from
   * {@link resolveRowState} — never the static flags on `field` (objectui#5627).
   *
   * A prop rather than a read of `field.required` / `field.readonly`, because
   * those two are now only INPUTS to the verdict: an object-level `readonlyWhen`
   * can lock a statically-editable field and a `requiredWhen` can require a
   * statically-optional one. Taking it as a parameter is what makes the control
   * and the asterisk beside it read ONE verdict — the two-layer disagreement
   * objectui#4201 removed on the sibling chain, where a field showed no marker
   * and the submit was refused anyway.
   */
  state: { readonly: boolean; required: boolean };
  value: unknown;
  onChange: (v: unknown) => void;
  /**
   * The form's live values, handed to the widgets that re-resolve against the
   * record — see {@link needsDependentValues}.
   */
  values: Record<string, unknown>;
  /**
   * Upload-in-progress signal, forwarded to the upload widgets alone.
   *
   * The widget contract states what this is for outright — upload widgets fire
   * it "so a host can block submit until a presigned upload settles", because
   * the value only becomes a `sys_file` id once the upload resolves. A form
   * that submits mid-flight therefore stores nothing for the field while
   * reporting success, which is the same silent-empty-file class objectui#10131
   * measured on the dialog host.
   */
  onUploadingChange?: (uploading: boolean) => void;
}

/**
 * The widgets that emit upload-in-progress (`file`, `image`, `avatar`) — the
 * only ones handed `onUploadingChange`, exactly as `ActionParamDialog` gates
 * it, so no other widget receives a prop it does not declare. `avatar` joined
 * when its pick started waiting on a network upload (objectui#10785).
 */
function isUploadWidget(widgetKey: string): boolean {
  return widgetKey === 'file' || widgetKey === 'image' || widgetKey === 'avatar';
}

/**
 * Which widgets are handed the form's live values as `dependentValues` — the
 * two shared families, OR'd, as the object form and `ActionParamDialog` both
 * do: the option widgets whose OFFERED set re-resolves per option
 * `visibleWhen` / `dependsOn` (`CASCADE_OPTION_WIDGET_TYPES`), and the
 * reference pickers whose QUERY narrows by `dependsOn`
 * (`EXPANDABLE_FIELD_TYPES`). ⛔ Never merged into one local set: both tables
 * are shared, and a copy re-forks them.
 */
function needsDependentValues(widgetKey: string): boolean {
  return CASCADE_OPTION_WIDGET_TYPES.has(widgetKey) || EXPANDABLE_FIELD_TYPES.has(widgetKey);
}

/**
 * One row's control: the widget the shared resolver names, hosted
 * (objectui#10179, which replaced the hand-rolled `switch (field.type)` that
 * stood here — see the file header).
 *
 * What the HOST owns, and nothing more:
 *
 *  - the control id (`f_NAME`), so the row's `<label for>` names the control
 *    a `'control'` widget renders; `'group'` widgets are handed the label's id
 *    as `aria-labelledby` instead, and a `'display'` widget is wrapped in a
 *    named `role="group"` of the host's own (the `form.tsx` shape);
 *  - required, on the STATE channel — `aria-required`, ⛔ never the native
 *    attribute. The widget contract refuses a `required` boolean by name so the
 *    asterisk keeps one author, and arming the browser's constraint bubble
 *    would put a second validator beside this page's own submit check (see
 *    {@link findSubmitRefusals});
 *  - readonly as `disabled`: the control stays on screen, labelled and inert,
 *    which is what this page's rows have always done. A widget's `readonly`
 *    branch renders a replacement display that drops the host id, and the
 *    label's `for` would dangle.
 *
 * `value` is passed RAW: each widget owns its value shape (a date string, a
 * number or `null`, an array for a multiselect, a reference id for a lookup,
 * a `sys_file` id for an upload) and `handleSubmit` sends what it emits.
 *
 * The widget is lazy by construction, hence the boundary. The fallback is a
 * neutral, unannounced placeholder of the control's height.
 */
function FieldInput({ field, state, value, onChange, values, onUploadingChange }: FieldInputProps) {
  // `getLazyFieldWidget` caches ONE lazy component per key, so this identity is
  // stable across renders of the same row — the component is looked up, not
  // created during render. The memo only keeps the lookup off the hot path;
  // nothing depends on ITS identity (AGENTS.md #10).
  // The SAME function the row's label association calls (`rowLabelProps`), on
  // the same row, so the label and the control cannot name different widgets.
  const widgetKey = resolveFieldWidgetKey(field);
  const Widget = useMemo(() => getLazyFieldWidget(widgetKey), [widgetKey]);
  // Recomputed only when the row itself changes; a fresh object is harmless
  // (nothing keys on its identity), the memo only spares a spread per keystroke.
  const widgetField = useMemo(() => widgetFieldOf(field), [field]);
  const labelling = widgetLabelling(widgetKey);
  const controlId = controlIdOf(field.name);
  const labelId = labelIdOf(field.name);

  const widget = (
    // eslint-disable-next-line react-hooks/static-components -- getLazyFieldWidget returns a per-key cached lazy component (stable identity), not a component created during render
    <Widget
      // A display is named by the host's wrapper below, which carries the id;
      // the widget itself renders no control to put it on.
      {...(labelling === 'display' ? null : { id: controlId })}
      name={field.name}
      value={value ?? null}
      onChange={onChange}
      field={widgetField}
      disabled={state.readonly}
      aria-required={state.required || undefined}
      {...(labelling === 'group' ? { 'aria-labelledby': labelId } : null)}
      {...(needsDependentValues(widgetKey) ? { dependentValues: values } : null)}
      {...(isUploadWidget(widgetKey) ? { onUploadingChange } : null)}
    />
  );

  return (
    <Suspense
      fallback={<div className="h-9 w-full animate-pulse rounded-md bg-muted/40" aria-hidden="true" />}
    >
      {labelling === 'display' ? (
        <div id={controlId} role="group" aria-labelledby={labelId}>
          {widget}
        </div>
      ) : (
        widget
      )}
    </Suspense>
  );
}

/**
 * What this page's own submit check refuses, read off ONE {@link resolveRowState}
 * call per row — so the refusal is decided by the evaluation that drew the row,
 * never by a second one.
 *
 * ## `faultedVisibleWhen` — the rule no server judges (objectui#8069)
 *
 * The rows whose OBJECT-level `visibleWhen` could not be evaluated. ADR-0137
 * D2, as ruled for objectui#8069 (Q1 = B, one judge per rule): the client
 * refuses the submit on this one rule, because no server evaluates it and its
 * fail-open render direction (D3) would otherwise be a silent grant.
 * `requiredWhen` / `readonlyWhen` faults are the server's to refuse; this page
 * keeps their render direction and warning unchanged. A stored BLANK
 * `visibleWhen` is a fault like any other (ADR-0137 D2, `FieldRuleFaults`); the
 * view-level predicate is not a field rule at all but a layout gate, and is
 * not judged.
 *
 * Judged over the rows the required check below walks — a hidden SECTION is
 * skipped by both. On this page visibility decides what is DRAWN and nothing
 * else (a hidden row's value still submits, unchanged), so a row a hidden
 * section already keeps off screen cannot be shown by its own broken rule, and
 * there is no grant to refuse.
 *
 * ## `missing` — the rows that would submit EMPTY while required
 *
 * The page's own required check (objectui#10179).
 *
 * The hand-rolled controls this page used to render carried the NATIVE
 * `required` attribute, so the browser refused such a submit on the text-like
 * rows. The shared widgets announce required on the state channel instead
 * (`aria-required`) and never arm native validation, so without this check the
 * page would have lost its only client-side refusal. It reads the same verdict
 * the asterisk does ({@link resolveRowState}), the same emptiness predicate
 * the `required` rule reads everywhere (`isMissingForRequired`: `false` and
 * `0` are values), and skips exactly what a browser skips — a row that is not
 * on screen, and a locked one.
 */
function findSubmitRefusals(
  sections: RenderableSection[],
  values: Record<string, unknown>,
  previous: Record<string, unknown> | null | undefined,
  isCreateForm: boolean,
  predicateScope?: Record<string, unknown>,
): { faultedVisibleWhen: RenderableField[]; missing: RenderableField[] } {
  const faultedVisibleWhen: RenderableField[] = [];
  const missing: RenderableField[] = [];
  for (const sec of sections) {
    if (!isSectionVisible(sec, values, previous, predicateScope)) continue;
    for (const f of sec.fields) {
      const state = resolveRowState(f, values, previous, isCreateForm, predicateScope);
      if (state.faults.visibleWhen !== undefined) faultedVisibleWhen.push(f);
      if (state.visible && state.required && !state.readonly && isMissingForRequired(values[f.name])) {
        missing.push(f);
      }
    }
  }
  return { faultedVisibleWhen, missing };
}

// ─── Main component ─────────────────────────────────────────────────

export interface FormPageProps {
  /** `'public'` for /f/:slug (anonymous), `'internal'` for /forms/:name (authed). */
  mode: FormPageMode;
  /**
   * Builds the console path of the record an INTERNAL submit just wrote —
   * created, or (objectui#4278) updated — so the default `created-record`
   * behaviour has somewhere to land.
   *
   * Injected rather than computed here because the answer is not a property of
   * the form: a record page is app-scoped (`/apps/<segment>/<object>/record/
   * <id>` — ADR-0048), and WHICH app should host an app-independent page for
   * this user is a policy with a home of its own. `InternalFormRoute` owns it;
   * `FormPage` stays a renderer and keeps working outside a metadata catalog
   * (which is what the public `/f/:slug` mount is — no catalog, no app, and no
   * business having either).
   *
   * Returning `null` — or omitting the prop, as the public mount does — means
   * "no record page to land on", and the submit falls back to confirming.
   */
  recordPath?: (objectName: string, recordId: string) => string | null;
  /**
   * Where the internal form's Cancel lands when there is no earlier entry in
   * this session's history to go back to — a cold deep link, or a reload
   * that opened the console on this page (objectui#13433). With an entry,
   * Cancel goes back to it: that is "where the user was". The route that
   * mounts the form supplies it (the app's home inside an app, Home outside
   * one); omitted, the fallback is the console root.
   *
   * An EDIT's fallback is the record it edits when `recordPath` can name it,
   * ahead of this one. The public mount renders no Cancel at all: an anonymous
   * visitor has no console to return to.
   */
  cancelPath?: string;
}

/**
 * Render a public or internal form by reading the relevant URL param.
 *
 * Why one component for both modes? The renderer, validation, layout and
 * post-submit behaviour are identical — only the *spec source* and the
 * *submit target* differ. Forking the component would duplicate the
 * field-rendering branch which is the bulk of the code.
 */
export function FormPage({ mode, recordPath, cancelPath }: FormPageProps) {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const identifier = (mode === 'public' ? params.slug : params.name) ?? '';
  /**
   * Create, edit, or refuse — decided from the URL alone (objectui#4278), so
   * the whole read/write pair below has ONE switch rather than a `recordId`
   * truthiness test at each of the three sites that need it.
   */
  const target = readFormRecordTarget(mode, search);
  const editingId = target.kind === 'edit' ? target.recordId : null;
  /** The object the URL claims `editingId` belongs to (#4292), or null. */
  const editingObject = target.kind === 'edit' ? target.recordObject : null;
  /**
   * Is the write this form is heading for an INSERT? Read off the same URL
   * switch as the pair above, because `resolveFieldRuleState` requires the
   * caller to STATE it rather than infer it (objectui#4085) — see
   * {@link resolveRowState}. `/f/:slug` is create by construction: public mode
   * never reads `?recordId=` at all.
   */
  const isCreateForm = target.kind !== 'edit';
  /**
   * The host shell's global predicate scope — `current_user` plus the ADR-0068
   * `user` / `ctx.user` / `os.user` aliases, `data`, `features` (⛔ no `app`:
   * objectui#8155 unbound that root) — read
   * from the `PredicateScopeProvider` an `ExpressionProvider` mounts, and
   * threaded into all three evaluators below (objectui#6110). Same binding the
   * sibling renderer took in #6010, so one authored `visibleWhen` means one
   * thing on both form chains.
   *
   * ## The two routes are told apart by WHO MOUNTS THEM, not by a new key
   *
   * `/forms/:name` renders inside `InternalFormRoute`, which has an
   * authenticated session and publishes it through `ExpressionProvider`.
   * `/f/:slug` is mounted bare in `App.tsx`, deliberately outside
   * `ProtectedRoute`, because an anonymous visitor must be able to submit it —
   * so no provider sits above it and this returns `{}`. That is not a gap left
   * unfilled: an anonymous form HAS no principal, and binding an empty scope is
   * precisely that statement. A `current_user` predicate authored on a public
   * form therefore still faults and still fails OPEN, exactly as before this
   * change; nothing new is declared to say so.
   *
   * `features` is likewise empty here. That is the contract, not a gap: a form
   * view may not name the `features` root in a predicate at all (objectui#6262,
   * ruled 2026-08-27). The same ruling rejected fetching `/auth/config` on this
   * route to fill it. `@objectstack/spec` refuses such a predicate at parse,
   * on every form-view predicate surface, and metadata-admin's `view` gates run
   * that parse. So the in-app versus standalone-route split is closed where the
   * form is authored, not in this renderer.
   * `formViewFeaturesRootRefused-6262.test.ts` re-derives the refusal against
   * the installed spec.
   */
  const predicateScope = usePredicateScope();
  /**
   * The two authored strings this renderer draws per row, routed through the
   * SAME resolvers the app path uses (objectui#8813).
   *
   * `useSafeFieldLabel` rather than `useObjectLabel` for the reason the
   * sibling renderers pick it (`ObjectForm`, `ModalForm`, `record-details`):
   * one call site, provider or no provider. ⚠️ And that is exactly why a green
   * test proves NOTHING here on its own — with no provider these degrade to
   * identity functions instead of throwing, so "the resolver ran" and "the key
   * was found" look alike. `FormPage.sectionLabelI18n.test.tsx` is written the
   * only way that tells them apart: it asserts a TRANSLATED string on this
   * route and goes red when the key is removed from the bundle.
   *
   * ⛔ No `I18nProvider` is mounted for this — one already sits above this
   * route. `main.tsx` wraps the whole `App` (StrictMode -> MobileProvider ->
   * `I18nProvider` -> `App`) and `/f/:slug` is a plain route inside `App`'s
   * table, outside `ProtectedRoute` but not outside that wrapper. Measured on
   * the real tree with a four-cell control matrix (objectui#8813): a probe
   * calling `useI18nContext()` — which throws outside a provider — answers YES
   * in `FormPage`'s exact route position under the real `main.tsx` wrapper,
   * and NO in the same position with the wrapper removed.
   */
  const { sectionLabel, fieldLabel, objectLabel } = useSafeFieldLabel();
  // The page's own chrome — the loading line, the success toast, the
  // thank-you panel's defaults, and (objectui#11071) the submit button, the
  // pending-redirect line and the required refusal's frame — through the same
  // provider, and the same pack keys plugin-form's forms read
  // (objectui#11039). An authored thank-you `title` / `message` still wins.
  // `language` is the visitor's, read by `buildSections` to collapse a field
  // entry's inline locale map (objectui#13380).
  const { t, language } = useObjectTranslation();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedForm | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  /**
   * Which rows currently have an upload in flight, keyed by field name
   * (objectui#10167). Only the upload widgets (`file`, `image`, `avatar`)
   * ever write here — see {@link isUploadWidget}.
   *
   * Per NAME rather than a single counter so two upload rows cannot cancel each
   * other out: a counter incremented and decremented by two widgets that
   * settle out of order reaches zero while one is still running, and the guard
   * below would open early. A name that is absent or `false` is not uploading,
   * which is what every non-upload row is, forever.
   */
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const isUploading = Object.values(uploading).some(Boolean);
  /**
   * The sonner id this form's submit OUTCOME is published under — one id for
   * the confirmation and for the refusal, so the later of the two SUPERSEDES
   * the earlier instead of stacking beside it (objectui#7252).
   *
   * The `error` banner above is already cleared at the top of every attempt;
   * its toast was not, because it went out under sonner's auto-generated id and
   * nothing here held a handle on it. A refused submit therefore left its toast
   * on screen, and the success toast of the retry landed next to it — the form
   * ending on a screen that asserted both outcomes at once.
   *
   * ⚠️ The redirect REFUSAL below deliberately does NOT share this id. That one
   * is not a submit outcome: the write succeeded and only the declared
   * destination is out of contract, so it has to be readable BESIDE the
   * confirmation this id carries, exactly as objectui#4190 ruled.
   */
  const outcomeToastId = `form-outcome:${useId()}`;
  const [submitted, setSubmitted] = useState(false);
  /**
   * The outcome of a `redirect` submit behaviour: the in-app route to go to
   * once `delayMs` has elapsed, or the fact that the authored destination was
   * refused (objectui#4190). Null until a redirect submit resolves.
   *
   * A refusal needs its own state rather than riding on `error`, for two
   * reasons. This page renders "Redirecting…" for a submitted redirect, and that
   * line would be a lie — nothing is going anywhere, and the submitter needs the
   * confirmation their record WAS written plus the reason it stopped here. And
   * the refusal travels WITH that flag rather than in `error` so one fact has
   * one reader: `error` is the page's load/submit failure channel, which a
   * refused destination is not (the submit succeeded).
   */
  const [redirect, setRedirect] = useState<
    { kind: 'pending'; path: string } | { kind: 'refused'; refusal: string } | null
  >(null);

  // Load spec on mount / when identifier or the record it targets changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // A `?recordId=` we cannot make sense of never reaches a loader: it is an
    // edit intent this route cannot honour, and #4278 ruling point 2 says
    // refuse rather than degrade into the create path.
    const loader =
      target.kind === 'refuse'
        ? Promise.reject(new Error(target.reason))
        : mode === 'public'
          ? loadPublicForm(identifier)
          : loadInternalForm(identifier, editingId, editingObject);
    loader
      .then((result) => {
        if (cancelled) return;
        setLoaded(result);
        // Prefill reads names and defaults only, never the copy, so this
        // build needs no language and the load does not re-run on a switch.
        const sections = buildSections(result.form, result.objectSchema);
        const allFields = sections.flatMap((s) => s.fields);
        setValues(readPrefill(allFields, search, result.record));
      })
      .catch((e) => {
        if (!cancelled) {
          // Clear any previously loaded form: a refusal must not leave an
          // editable form on screen behind the error.
          setLoaded(null);
          setError(e?.message ?? String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // `target`/`editingId` are derived from `search`, already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, identifier, search]);

  const sections = useMemo<RenderableSection[]>(
    () => (loaded ? buildSections(loaded.form, loaded.objectSchema, language) : []),
    [loaded, language],
  );

  const behavior: EffectiveSubmitBehavior = resolveSubmitBehavior(
    mode,
    loaded?.form?.submitBehavior,
  );

  /**
   * The delayed leg of a `redirect` submit behaviour.
   *
   * It is an effect rather than a timer armed inside the submit handler so the
   * wait is TIED to this component: a submitter who leaves during `delayMs` is
   * not yanked back by a timer that outlived the page. `delayMs` semantics are
   * otherwise unchanged — the pause is what makes the confirmation readable,
   * the spec still declares the key, and an unset one still means "go now"
   * (a zero-delay timer, i.e. after this render commits).
   */
  const pendingRedirect = redirect?.kind === 'pending' ? redirect.path : null;
  const redirectDelayMs = behavior.kind === 'redirect' ? (behavior.delayMs ?? 0) : 0;
  useEffect(() => {
    if (pendingRedirect === null) return;
    const timer = setTimeout(() => navigate(pendingRedirect), redirectDelayMs);
    return () => clearTimeout(timer);
  }, [pendingRedirect, redirectDelayMs, navigate]);

  /**
   * The internal form's way out without saving (objectui#13433) — before it,
   * the page offered Submit alone and the browser's Back button was the only
   * exit. Nothing is written, so there is nothing to confirm.
   *
   * Back when this session has an earlier entry: react-router gives the entry
   * it started on the key `'default'` and every entry it navigated to a
   * generated one, so any other key means a page of this console is behind
   * this one — the record page a header action was fired from, typically —
   * and returning to it keeps that page's own URL state (tab, `?form=`,
   * scroll). Without one, a push to the record an edit is editing, else to
   * the route's `cancelPath`.
   */
  const handleCancel = () => {
    if (location.key !== 'default') {
      navigate(-1);
      return;
    }
    const recordTo = editingId && loaded ? recordPath?.(loaded.object, editingId) : null;
    navigate(recordTo ?? cancelPath ?? '/');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!loaded) return;
    // The client-side refusals — see `findSubmitRefusals`. Both go out on the
    // page's failure channel and the outcome toast id, so a retry that
    // succeeds supersedes them exactly as it supersedes a refused write
    // (objectui#7252).
    const { faultedVisibleWhen, missing } = findSubmitRefusals(
      sections,
      values,
      loaded.record,
      isCreateForm,
      predicateScope,
    );
    // A faulted `visibleWhen` first (objectui#8069): it names the field and
    // the rule, and nothing typed into the form can clear it, so the required
    // check behind it would only ask for work that is refused anyway.
    if (faultedVisibleWhen.length > 0) {
      const msg = t('form.visibleWhenFaulted', {
        fields: faultedVisibleWhen
          .map((f) => fieldLabel(loaded.object, f.name, f.label))
          .join(t('validation.formInvalidJoiner')),
      });
      setError(msg);
      toast.error(msg, { id: outcomeToastId });
      return;
    }
    // The client-side required refusal the native attribute used to give the
    // hand-rolled controls (objectui#10179).
    if (missing.length > 0) {
      // One catalogue frame around the labels (objectui#11071), joined with
      // the pack's own list separator: the colon, its spacing and the order of
      // the words are the locale's, not a concatenation of English.
      const msg = t('publicForm.requiredFields', {
        fields: missing
          .map((f) => fieldLabel(loaded.object, f.name, f.label))
          .join(t('validation.formInvalidJoiner')),
      });
      setError(msg);
      toast.error(msg, { id: outcomeToastId });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // A server-owned field the user touched and cleared must not travel as a
      // blank — that stores `''` and defeats the declaration the empty control
      // was honouring (objectui#5883). Both routes, because `/f/:slug` is a
      // create by construction and its payload reaches the same insert path.
      const payload = omitServerOwnedBlanks(
        values,
        sections.flatMap((s) => s.fields),
        isCreateForm,
      );
      const result =
        mode === 'public'
          ? await submitPublic(identifier, payload)
          : await submitInternal(loaded.object, payload, editingId);
      toast.success(t('form.submitted'), { id: outcomeToastId });
      // Behaviour after submit
      switch (behavior.kind) {
        case 'created-record': {
          // The internal default (#4109 ruling point 2): land on the record
          // this submit wrote. Client-side `navigate` — NOT
          // `window.location.assign` — because the record page lives in the
          // same SPA and a full reload would throw away the shell this route
          // now renders inside.
          //
          // On an EDIT (#4278) the destination is the id we already hold: it
          // came from the URL and is the row we just PATCHed, so there is
          // nothing to read out of the response and no way for it to be
          // missing. `readCreatedRecordId` is for the create path, which has
          // no other source — see its docblock for why the update response's
          // (identical, measured) `id` is deliberately not read back.
          const id = editingId ?? readCreatedRecordId(result);
          const to = id ? recordPath?.(loaded.object, id) : null;
          if (to) {
            navigate(to);
            break;
          }
          // No id in the response, or no record page to land on. Confirm the
          // submit rather than navigate somewhere broken — the write itself
          // succeeded, so silence would be the worse answer.
          setSubmitted(true);
          break;
        }
        case 'redirect': {
          // objectstack#7496 ruled this url a RELATIVE in-app path, so the
          // destination is a route in this shell — see `submitRedirect.ts` for
          // why the verdict is the spec's own, why a browser-level navigation
          // was the objectui#4190 defect rather than the mechanism, and why
          // `withConsoleBase` is not the tool.
          //
          // The token scope is the record this submit just wrote: the values as
          // submitted, with whatever the server echoed back layered over them
          // (defaults and computed fields are canonical there). The id is read
          // exactly as the `created-record` arm above reads it, so ONE rule
          // answers "the record this submit wrote" for both arms and a
          // `{{record.id}}` token cannot resolve one way here and another there.
          const written = unwrapTransportEnvelope(result)?.record;
          const writtenId = editingId ?? readCreatedRecordId(result);
          const verdict = resolveSubmitRedirect(behavior.url, {
            // `payload`, not `values` — "the values as SUBMITTED" is what this
            // scope has always claimed to be, and since objectui#5883 the two
            // differ: a key the submit deliberately withheld is not part of the
            // record it wrote, so resolving `{{record.x}}` from it would put
            // the very blank we refused to send into a URL. The server echo
            // below still supplies the value the producer resolved.
            ...payload,
            ...(written && typeof written === 'object' ? (written as Record<string, unknown>) : {}),
            ...(writtenId ? { id: writtenId } : {}),
          });
          if (!verdict.ok) {
            // The write SUCCEEDED and only the destination is out of contract.
            // So: confirm the submit, and put the refusal on screen — dropping
            // it would leave the submitter watching a redirect that must never
            // happen, and following it is the open redirect the ruling closed.
            toast.error(verdict.refusal);
            setRedirect({ kind: 'refused', refusal: verdict.refusal });
            setSubmitted(true);
            break;
          }
          setRedirect({ kind: 'pending', path: verdict.path });
          setSubmitted(true);
          break;
        }
        case 'continue': {
          // Reset values so the user can submit again. On an edit form that
          // means back to the record as loaded — NOT to blank, which would
          // stage a wipe of every field on the next save.
          const allFields = sections.flatMap((s) => s.fields);
          setValues(readPrefill(allFields, search, loaded.record));
          break;
        }
        case 'next-record':
        case 'thank-you':
        default:
          setSubmitted(true);
          break;
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setError(msg);
      toast.error(msg, { id: outcomeToastId });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }
  if (error && !loaded) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }
  if (!loaded) return null;

  // `created-record` reaches this branch only on the fallback path above (no
  // id in the response, or nowhere to land) — a successful redirect navigates
  // away instead. It carries no author-supplied title/message, so it renders
  // the generic confirmation.
  if (submitted && (behavior.kind === 'thank-you' || behavior.kind === 'created-record')) {
    const title = behavior.kind === 'thank-you' ? behavior.title : undefined;
    const message = behavior.kind === 'thank-you' ? behavior.message : undefined;
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-md border bg-card p-6 text-center">
          <h2 className="mb-2 text-lg font-semibold">
            {title ?? t('publicForm.thankYouTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {message ?? t('publicForm.thankYouMessage')}
          </p>
        </div>
      </div>
    );
  }
  if (submitted && behavior.kind === 'redirect') {
    // A refused destination (objectui#4190) still confirms the write — it
    // happened — and shows why nothing was navigated to. "Redirecting…" is
    // reserved for a redirect that is actually pending.
    if (redirect?.kind === 'refused') {
      return (
        <div className="mx-auto max-w-2xl space-y-4 p-6">
          <div className="rounded-md border bg-card p-6 text-center">
            <h2 className="mb-2 text-lg font-semibold">{t('publicForm.thankYouTitle')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('publicForm.thankYouMessage')}
            </p>
          </div>
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {redirect.refusal}
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-2xl p-6 text-center text-sm text-muted-foreground">
        {t('publicForm.redirectPending')}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">
          {/*
            * objectui#13433 — a form view that names itself nowhere is headed
            * by its object's label, through the session's language, rather
            * than by its raw qualified name (`showcase_task.form`). The same
            * rule the public route applies in `loadPublicForm`; resolved here
            * because the session's bundle lives in render, not in the loader.
            * The object's API name stays the last resort, `||` so an empty
            * label cannot blank the heading.
            */}
          {loaded.label
            ?? objectLabel({
              name: loaded.object,
              label: loaded.objectSchema?.label || loaded.object,
            })}
        </h1>
        {/*
          * objectui#8408 — the subtitle slot renders the form's `description`.
          *
          * It used to read `loaded.form.label`, guarded by
          * `loaded.form.label !== loaded.label`, and that predicate was DEAD
          * on the public route rather than merely selective — both branches
          * were pushed through:
          *
          *   • `payload.label` absent  -> `loaded.label` IS `form.label`, so
          *     the inequality is false;
          *   • `payload.label` present -> `form.label` is undefined, so the
          *     first conjunct is false.
          *
          * Neither renders, which is why replacing the predicate is the fix
          * and adding a second condition beside it would not have been.
          *
          * `description` is what a form config actually carries next to
          * `title` (the same contract that REJECTS `label`), it arrives in the
          * payload untouched, and before this card the whole file never read
          * it once — the author's sentence explaining the form to an
          * anonymous visitor was fetched and dropped on the floor.
          *
          * No inequality guard: `description` and the heading are different
          * keys saying different things, so equality between them is the
          * author's business, not this renderer's.
          */}
        {loaded.form?.description && (
          <p className="mt-1 text-sm text-muted-foreground">{loaded.form.description}</p>
        )}
      </header>
      <form onSubmit={handleSubmit} className="space-y-6">
        {sections.map((sec, i) => {
          // A section conditioned away is skipped IN PLACE rather than filtered
          // out of the list first (objectui#5627). The key here is the section's
          // POSITION, and these predicates re-decide on every keystroke: filtering
          // would renumber every later section the moment one hid, remounting
          // their inputs and taking the caret with them. `null` keeps each
          // surviving section on the key it already had.
          if (!isSectionVisible(sec, values, loaded.record, predicateScope)) return null;
          return (
          <section key={i} className="rounded-md border bg-card p-4 sm:p-5">
            {sec.label && (
              <h2 className={sec.description ? 'mb-1 text-sm font-medium' : 'mb-3 text-sm font-medium'}>
                {/*
                  * objectui#8813 — the heading resolves
                  * `objects.{object}._sections.{name}.label` and falls back to
                  * the authored string, exactly as `ObjectForm` does on the
                  * app path. The KEY is `sec.name`; a section authored without
                  * one has no key and keeps its authored heading.
                  *
                  * The `sec.label &&` guard above is unchanged on purpose: this
                  * card translates a heading that already renders, it does not
                  * start rendering headings for sections that had none. A
                  * translation cannot conjure a heading the author did not
                  * write — that would be a different, wider change.
                  */}
                {sec.name ? sectionLabel(loaded.object, sec.name, sec.label) : sec.label}
              </h2>
            )}
            {/*
              * objectui#12333 — the served description, under the heading.
              * No client-side key is read for it: the signed-out visitor holds
              * no bundle, and the server already localized it.
              */}
            {sec.description && (
              <p className="mb-3 text-sm text-muted-foreground">{sec.description}</p>
            )}
            <div
              className={
                sec.columns === 1
                  ? 'grid grid-cols-1 gap-4'
                  : sec.columns === 2
                    ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
                    : sec.columns === 3
                      ? 'grid grid-cols-1 gap-4 sm:grid-cols-3'
                      : 'grid grid-cols-1 gap-4 sm:grid-cols-4'
              }
            >
              {sec.fields.map((f) => {
                // One resolution per row per render, read by all three of the
                // things that depend on it below — the row's presence, the
                // required marker, and the control's own attributes. Computing
                // it three times would be three chances to disagree.
                const state = resolveRowState(f, values, loaded.record, isCreateForm, predicateScope);
                if (!state.visible) return null;
                return (
                <div
                  key={f.name}
                  className={
                    f.colSpan === 2 ? 'sm:col-span-2'
                      : f.colSpan === 3 ? 'sm:col-span-3'
                        : f.colSpan === 4 ? 'sm:col-span-4'
                          : ''
                  }
                >
                  <label
                    // `for` the control, or an `id` the group / display answers
                    // to — the widget's declaration decides (objectui#10179).
                    {...rowLabelProps(f)}
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    {/*
                      * objectui#8813 — `fields.{object}.{name}`, the same
                      * resolver and the same fallback-to-the-served-label as
                      * the app path (`ObjectForm`). On this route the served
                      * label is usually ALREADY localized by the server
                      * payload, which is why the symptom looked like "field
                      * labels translate, section headings do not"; the client
                      * lookup is the overlay an app bundle can put on top,
                      * not a replacement for that server value.
                      */}
                    {fieldLabel(loaded.object, f.name, f.label)}
                    {/* Visual-only (objectui#3299): the control's `required` /
                        `aria-required` is the announced channel; hiding the `*`
                        keeps it out of the control's accessible name. */}
                    {state.required && (
                      <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                    )}
                  </label>
                  <FieldInput
                    field={f}
                    state={state}
                    value={values[f.name]}
                    values={values}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
                    onUploadingChange={(u) =>
                      setUploading((prev) => (prev[f.name] === u ? prev : { ...prev, [f.name]: u }))
                    }
                  />
                  {f.helpText && (
                    <p className="mt-1 text-xs text-muted-foreground">{f.helpText}</p>
                  )}
                </div>
                );
              })}
            </div>
          </section>
          );
        })}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          {mode === 'internal' && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="rounded-md border bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          )}
          {/* Blocked while an upload is in flight (objectui#10167): a file's
              value only becomes a `sys_file` id once the adapter settles, so a
              submit that beats it writes an empty field and still reports
              success. The widget contract exists for this — see
              `FieldInputProps.onUploadingChange`. */}
          <button
            type="submit"
            disabled={submitting || isUploading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting
              ? t('publicForm.submitting')
              : isUploading
                ? t('fields.file.uploading')
                : t('publicForm.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}

export default FormPage;
