/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What an object's declared field `defaultValue`s mean to a CREATE form —
 * which ones it seeds (#4047) and which ones excuse it from the client-side
 * `required` rule (#4069).
 *
 * Both halves hang off ONE classifier, {@link isRuntimeDefault}: a default the
 * server resolves per insert is neither seedable nor missing. Keeping the two
 * consumers on one predicate is the point of this module — a second copy would
 * be free to disagree about, say, a CEL envelope, and then a form would seed a
 * field it also refuses to submit. Since #4085 that classifier LIVES in
 * `@object-ui/core` (this module re-exports it) so a third consumer — the
 * `requiredWhen` suppression inside `resolveFieldRuleState` — reads the very
 * same one from a package `@object-ui/components` is allowed to depend on.
 *
 * ## What this is for
 *
 * A CREATE form starts from a blank record, so the values it opens with are
 * whatever the form puts there. `ObjectForm` derived them from the object
 * schema's `defaultValue`s; the sectioned/overlay containers (Modal / Drawer /
 * Tabbed / Split / Wizard) did not, and the console's create dialog is one of
 * those — a field declared `required: true, defaultValue: 'draft'` opened
 * empty, with a required marker, forcing the user to pick a value the system
 * already knew (and putting every neighbouring option one click away).
 *
 * ## Which spellings are honoured: the producer's, in the producer's order
 *
 * Two declarations name a field's initial value, and this module reads both
 * exactly as the server's insert path (`ObjectQL.applyFieldDefaults`) does —
 * the form previews the value omitting the field would store, never a value
 * of its own:
 *
 *   1. `field.defaultValue`, whenever it is present (`!= null`).
 *   2. Otherwise, the option a field's option list marks `default: true`
 *      (`@objectstack/spec`'s `SelectOptionSchema.default`). The engine falls
 *      back to it since objectstack#7246 (`resolveOptionDefault`); see
 *      {@link optionListDefault} for the rule, which mirrors that method.
 *
 * Until objectui#11914 this module read (1) only, on the then-true ground
 * that the server read nothing else — so the tutorial's required `priority`
 * and `status` selects, which mark an option and declare no `defaultValue`,
 * opened on the placeholder while a create that omitted them stored the
 * marked options. The producer moved; the reading follows it. A flag the
 * server does NOT apply (an option marked beside a present `defaultValue`)
 * is not seeded either, so there is still exactly one default contract.
 *
 * ## Which defaults are seeded, and why the rest are skipped
 *
 * Only STATIC defaults. A `defaultValue` may also be an *instruction* the
 * server resolves per insert:
 *
 *   - a runtime token — `'NOW()'` / `'current_user'`, the whole
 *     `DEFAULT_VALUE_TOKENS` family from `@objectstack/spec/data`
 *   - a CEL Expression envelope — `{ dialect: 'cel', source: 'today()' }`
 *
 * Seeding those literally is worse than leaving the control empty: the string
 * `NOW()` lands in a datetime input and is then SUBMITTED as that field's
 * value, which suppresses the server-side resolution the declaration asked for
 * (`applyFieldDefaults` only fills fields that arrive empty). Skipping them
 * leaves the field absent from the create payload, which is precisely the case
 * the engine resolves. `ObjectForm` had been seeding them verbatim — that is
 * fixed here along with the missing-seeding half.
 *
 * Left empty is not left unexplained: the form renderer in
 * `@object-ui/components` draws "Set automatically when saved." under such a
 * control while it stays empty (objectui#12108). It is drawn there, not seeded
 * here as a placeholder, because the renderer is where the live value and the
 * one description slot every field type shares both live.
 *
 * ONE token is additionally RESOLVED (not seeded literally) when the caller
 * threads a {@link SeedContext}: `current_user`, whose engine-side resolution
 * is "the acting user's id" — a value this very session knows exactly. That is
 * the "surface what the server WILL supply" follow-up the #4069 notes promised
 * (#5683): the seeded id is the same one `applyFieldDefaults` would stamp, so
 * submitting it explicitly and omitting it are equivalent by construction.
 *
 * ## Create only
 *
 * An EDIT form shows a persisted row and must show it as the server holds it.
 * Folding a default in over a column the record leaves unset would arm a silent
 * write of a value the user never chose, on the next save of any other field.
 * Callers gate on create; this module never sees the mode.
 */

import { isMissingForRequired, isRuntimeDefault } from '@object-ui/core';
import { isCurrentUserDefaultToken, isMultiValueField } from '@objectstack/spec/data';

// Re-exported (not re-implemented) so this package's long-standing import site
// keeps working while there is exactly ONE classifier in the workspace. It
// moved down to `@object-ui/core` for #4085: the form renderer and the
// wizard's step gate need the same fact to suppress `requiredWhen`, and
// `@object-ui/components` cannot depend on a `plugin-*` package.
export { isRuntimeDefault };

/**
 * An object schema as the data source serves it (`{ fields: { [name]: def } }`),
 * narrowed to `defaultValue` and the two members the `current_user` seed reads
 * (`type`, `reference`). The keys the option-list fallback reads
 * (objectui#11914) sit on the package-local `SeedFieldLike` below instead: the
 * one published function that reads them, `optionListDefault`, names its own
 * `OptionListFieldLike` (objectui#13049), and every member added here is
 * published surface somebody then has to keep.
 *
 * Exported and published (objectui#7324) because `omitServerResolvedDefaults`
 * is published and this is its second parameter: a host with its own form
 * renderer has to hold that schema in a variable or a prop, and until now it
 * could not name the variable's type. Structural typing meant such a host
 * still compiled by writing the shape out by hand — which is a copy of a
 * producer-owned shape in every consumer, invisible to every gate until the
 * producer's shape moves.
 *
 * `FieldDefaults`, not `ObjectSchema`: `deriveMasterDetail.ts` holds a
 * different shape that used to carry the same `ObjectSchemaLike` name, and the
 * two are NOT interchangeable — see `ChildObjectSchemaLike` there. This one is
 * the stricter of the pair (its field values are pinned, not `any`), so a
 * value legal here is legal there but not the reverse.
 *
 * NOT `@object-ui/types`' `ObjectSchemaMetadata`: that type requires `name`
 * and requires a `type` on every field. `isCurrentUserSeedField` below reads
 * the target as `reference`, the one spelling the spec declares and ObjectUI
 * reads (objectui#11070 round 4).
 */
export interface FieldDefaultsSchemaLike {
  fields?: Record<
    string,
    { defaultValue?: unknown; type?: unknown; reference?: unknown } | undefined
  >;
}

/**
 * One field as the SEEDING half of this module reads it: the published
 * {@link FieldDefaultsSchemaLike} member set plus the two keys the option-list
 * fallback reads (objectui#11914) — `options`, and `multiple` for the arity.
 *
 * Package-local, and derived from the published type rather than restating
 * it: seeding is not on the package entry (`schemaDefaultValues` and
 * `seedCreateValues` are withheld, see `index.tsx`), so the keys only it reads
 * stay off the published shape, whose members are pinned to what the
 * published pair reads (`parameterTypesNameable-7324.test.ts`). Every value of
 * the published type is still a value of this one.
 */
type SeedFieldLike = NonNullable<NonNullable<FieldDefaultsSchemaLike['fields']>[string]> & {
  options?: unknown;
  multiple?: unknown;
};

/**
 * One field as {@link optionListDefault} reads it: the option list and the two
 * arity inputs, nothing else (objectui#13049).
 *
 * Published because `optionListDefault` is, and a consumer must be able to
 * name what it passes (objectui#7324). Its own shape rather than a widening of
 * {@link FieldDefaultsSchemaLike}, whose members are pinned to what the
 * published `omitServerResolvedDefaults` / `isRequiredInForm` pair reads. A
 * served object field is assignable to it as it arrives.
 */
export interface OptionListFieldLike {
  type?: unknown;
  multiple?: unknown;
  options?: unknown;
}

/** An object schema as the seeding half reads it — see {@link SeedFieldLike}. */
interface SeedSchemaLike {
  fields?: Record<string, SeedFieldLike | undefined>;
}

/**
 * The session facts create-form seeding may draw on (#5683). Callers thread it
 * from `usePermissions()`; every key is optional so existing call sites keep
 * compiling and behaving unchanged until they opt in.
 */
export interface SeedContext {
  /**
   * The acting user's id (`usePermissions().userId`), or null/undefined when
   * unknown — no provider, anonymous, or still loading. Unknown seeds nothing:
   * the field stays empty and OMITTED from the payload, which is the case the
   * engine's own `current_user` resolution handles at insert.
   */
  currentUserId?: string | null;
}

/**
 * Can this declared `defaultValue` be used as a form's initial value as-is?
 *
 * True for static literals only — see the module docblock for why runtime
 * tokens and Expression envelopes are left to the server.
 */
export function isSeedableDefault(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return !isRuntimeDefault(v);
}

/**
 * Does this form have no persisted record behind it — i.e. is it a CREATE form?
 *
 * The one "no persisted record" test, shared by everything that must agree
 * about it: the containers' data-fetch branch, the default seeding (#4047) and
 * the create-mode `required` suppression (#4069). Two spellings of this test
 * WOULD drift — a form seeded as create but validated as edit is exactly the
 * bug #4069 fixes, in mirror image.
 */
export function isCreateFormMode(
  form: { mode?: string | null; recordId?: unknown } | null | undefined,
): boolean {
  return form?.mode === 'create' || !form?.recordId;
}

/**
 * The `required` a form should ENFORCE on this field, given the mode (#4069).
 *
 * A field may declare `required: true` alongside a runtime `defaultValue`:
 *
 * ```ts
 * remind_at: Field.datetime({ required: true, defaultValue: 'NOW()' }),
 * ```
 *
 * That is coherent authoring, not an error — storage-level required, with the
 * value guaranteed by the producer (`ObjectQL.applyFieldDefaults` resolves the
 * token for every field that arrives absent or null). But a CREATE form cannot
 * seed it (see {@link isRuntimeDefault}), so the control opens empty; enforcing
 * `required` there refuses the submit with *nothing sensible for the user to
 * type* — the declaration already said what the value is, and omitting the
 * field is precisely what makes the server supply it. The field is not
 * "missing"; it is server-owned.
 *
 * So in CREATE mode a runtime default suppresses the rule. Three boundaries,
 * each pinned in `createDefaults.test.tsx`:
 *
 *   - **Create only.** An EDIT form shows a persisted row, where the token was
 *     already resolved at insert; blanking a required column there is a real
 *     removal of a value and stays refused.
 *   - **Runtime defaults only.** A STATIC literal default IS seeded into the
 *     control (#4068), so if the user clears it they have removed a value that
 *     was there — `required` still fires.
 *   - **The rule, not the field.** Suppression only removes the "must not be
 *     empty" check. A value the user DOES type is still submitted normally and
 *     wins over the declared default.
 *
 * Note this drops the required MARKER (and `aria-required`) too, since both are
 * driven by this one boolean — which is the honest reading: in create mode the
 * user really is not required to provide the value. The form renderer says
 * THAT the server supplies it — "Set automatically when saved." under the
 * empty control (objectui#12108), keyed on the same classifier. Previewing
 * WHAT it will supply is issue #4069's option B, still a separate card.
 *
 * The CONDITIONAL spelling (`requiredWhen`) reaches the same verdict, ruled
 * identically in #4085 — but it cannot be decided here, because it is resolved
 * downstream against the live record. It is suppressed in the one evaluator
 * that resolves it, `resolveFieldRuleState`, which reads the same fact off
 * `@object-ui/core`'s `isServerOwnedValue` (and therefore the same
 * {@link isRuntimeDefault} classifier this function reads). That evaluator
 * subsumes this function on every path that threads the fact; this static
 * answer stays because it is also the one the containers publish as the
 * FormField's `required` flag, and because it is what re-runs when a form VIEW
 * restates `required` over the object field (see `normalizeSectionField`).
 */
export function isRequiredInForm(
  field: { required?: unknown; defaultValue?: unknown } | null | undefined,
  isCreateForm: boolean,
): boolean {
  if (!field?.required) return false;
  if (isCreateForm && isRuntimeDefault(field.defaultValue)) return false;
  return true;
}

/**
 * The static defaults an object schema declares, as a form-values patch: each
 * field's `defaultValue`, or — for a field that declares none — the option its
 * option list marks `default: true` ({@link optionListDefault}).
 *
 * Returns a fresh object (never shared), and `{}` for a missing/!object schema
 * so callers can spread it unconditionally.
 */
export function schemaDefaultValues(
  objectSchema: SeedSchemaLike | null | undefined,
  ctx?: SeedContext,
): Record<string, unknown> {
  const fields = objectSchema?.fields;
  if (!fields || typeof fields !== 'object') return {};
  const defaults: Record<string, unknown> = {};
  for (const name of Object.keys(fields)) {
    const f = fields[name];
    const dv = f?.defaultValue;
    if (isSeedableDefault(dv)) {
      defaults[name] = dv;
    } else if (isCurrentUserSeedField(f) && ctx?.currentUserId) {
      // #5683 — the ONE runtime token the client can resolve exactly. The
      // engine's `current_user` resolution is "the acting user's id"
      // (`ObjectQL.applyFieldDefaults` → `execCtx.userId`), and this session
      // IS that actor, so seeding `usePermissions().userId` pre-fills the very
      // value the server would have stamped — no second default contract, a
      // preview of the same one. `NOW()` and CEL envelopes stay server-owned:
      // form-open time is NOT insert time, and the client cannot evaluate CEL,
      // so seeding either would submit a DIFFERENT value than the declaration
      // resolves to. With no known user (`ctx` absent, provider-less, or
      // anonymous) the field seeds nothing and the pre-#5683 contract holds:
      // empty control, key omitted, server resolves.
      defaults[name] = ctx.currentUserId;
    } else if (dv == null) {
      // objectui#11914 — no `defaultValue`, so the option list speaks. The
      // `== null` gate is the engine's own presence test (`applyFieldDefaults`
      // reaches `resolveOptionDefault` only through `f.defaultValue == null`),
      // which is what keeps a runtime `defaultValue` — skipped above, resolved
      // by the server at insert — from being replaced here by a flag the
      // server never applies to that field.
      const fromOptions = optionListDefault(f);
      if (fromOptions !== undefined) defaults[name] = fromOptions;
    }
  }
  return defaults;
}

/**
 * The value a field's option list declares as its initial value — the option
 * marked `default: true` — or `undefined` when it marks none (objectui#11914).
 *
 * The client reading of `ObjectQL.resolveOptionDefault` (objectstack#7246),
 * rule for rule, so a create form preselects exactly what omitting the field
 * would store:
 *
 *   - **Only `default === true`, on the canonical key.** The authoring aliases
 *     (`isDefault`, `selected`) are normalized by `SelectOptionSchema` before
 *     metadata is served, and the engine reads the canonical key alone.
 *   - **A marked option with no value declares nothing** and is skipped.
 *   - **Single-valued: the FIRST marked option wins** — the schema does not
 *     dedupe the flag, so declaration order decides.
 *   - **Multi-valued: every marked option, as an array** — even one, since the
 *     field stores an array. Arity is `@objectstack/spec`'s `isMultiValueField`,
 *     the one predicate the engine asks too (`declaredMultiValued`), ⛔ never a
 *     raw `multiple` read: `multiselect` stores an array without the flag.
 *
 * Not gated on `type: 'select'`, as the engine's is not: `options` is a
 * field-level key, and a field the server defaults must not open empty here.
 *
 * Applies only to a field that declares no `defaultValue` — the caller's gate,
 * not this function's: {@link schemaDefaultValues} reaches it through
 * `dv == null`, the engine's own presence test, and so must every other
 * reader. Published on the package entry for the SECOND form renderer, the
 * console's public form page (objectui#13049), so both renderers seed from
 * this one reading instead of two.
 */
export function optionListDefault(field: OptionListFieldLike | null | undefined): unknown {
  const options = field?.options;
  if (!Array.isArray(options)) return undefined;
  const marked: unknown[] = [];
  for (const option of options as unknown[]) {
    if (!isMarkedOption(option)) continue;
    if (option.value === undefined || option.value === null) continue;
    marked.push(option.value);
  }
  if (marked.length === 0) return undefined;
  const multiValued = isMultiValueField({
    type: typeof field?.type === 'string' ? field.type : '',
    multiple: field?.multiple === true,
  });
  return multiValued ? marked : marked[0];
}

/** Is this option-list entry an object marked `default: true`? */
function isMarkedOption(option: unknown): option is { value?: unknown; default: true } {
  return typeof option === 'object' && option !== null && 'default' in option && option.default === true;
}

/**
 * Is this field one the `current_user` token may legally default — and does it
 * declare that token?
 *
 * The type gate mirrors the spec's own authoring rule (`field.zod` objectstack-ai/objectstack#7127:
 * `current_user` is legal "on `user` or `lookup` with `reference: 'sys_user'`
 * only"), so a token that somehow reached an illegal field type is left alone
 * here exactly as the engine's validator would refuse it. The target is read
 * as `reference` alone — the spelling the spec's own rule names, and the only
 * one `LookupField` reads (objectui#11070 round 4).
 */
function isCurrentUserSeedField(
  f: { defaultValue?: unknown; type?: unknown; reference?: unknown } | undefined,
): boolean {
  if (!f || !isCurrentUserDefaultToken(f.defaultValue)) return false;
  if (f.type === 'user') return true;
  return f.type === 'lookup' && f.reference === 'sys_user';
}

/**
 * The initial values a CREATE form opens with: the schema's static defaults,
 * overlaid with whatever the caller supplied.
 *
 * Caller values win — `initialData` / `initialValues` are the more specific
 * instruction (a lookup prefill, a "duplicate this record" seed, a wizard
 * carrying state forward), and an explicit `null` from a caller is a real
 * "leave this blank", not an absence.
 */
export function seedCreateValues(
  objectSchema: SeedSchemaLike | null | undefined,
  initial?: Record<string, unknown> | null,
  ctx?: SeedContext,
): Record<string, unknown> {
  return { ...schemaDefaultValues(objectSchema, ctx), ...(initial ?? {}) };
}

/**
 * Drop the fields a CREATE payload must leave to the producer (#4069).
 *
 * The other half of {@link isRequiredInForm}: excusing a server-owned field
 * from `required` is only half an answer if the form then submits the key
 * anyway. A rendered control registers with the form whether or not anything
 * seeded it, so an untouched runtime-default field reaches the payload as
 * `undefined` — or as `''` once anything has focused it — and `undefined` is
 * invisible to a `JSON.stringify` check while still being a KEY that a data
 * source is free to translate into an explicit column write.
 *
 * `ObjectQL.applyFieldDefaults` resolves a declared default for a field that
 * arrives absent or null. A blank string is neither, so submitting one stores
 * `''` and silently defeats the declaration — the exact suppression #4068
 * avoided by not seeding the token in the first place. Omitting the key is what
 * makes the server the single authority for the value.
 *
 * Only EMPTY values are dropped, and emptiness is `isMissingForRequired` — the
 * very predicate the required rule uses, so "left empty" cannot come to mean
 * two different things in the two halves of this fix. A value the user actually
 * typed is submitted normally: the suppression is of the rule, not of the
 * field.
 *
 * CREATE only. On an edit form the token was resolved at insert; a cleared
 * column there is a deliberate removal, and dropping the key would silently
 * discard the user's edit.
 */
export function omitServerResolvedDefaults(
  data: Record<string, unknown>,
  objectSchema: FieldDefaultsSchemaLike | null | undefined,
): Record<string, unknown> {
  if (!data || typeof data !== 'object') return data;
  const fields = objectSchema?.fields;
  if (!fields || typeof fields !== 'object') return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isRuntimeDefault(fields[key]?.defaultValue) && isMissingForRequired(value)) continue;
    out[key] = value;
  }
  return out;
}
