/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Does a form have anything to submit TO? — the ONE answer for every renderer
 * `ObjectForm` routes to (objectui#6300).
 *
 * ## What went wrong
 *
 * Each of the five variant containers opened `handleSubmit` with
 *
 *     if (!dataSource) { await schema.onSuccess?.(data); return data; }
 *
 * — a SUCCESS signal emitted without consulting `submitHandler` and without
 * persisting anything. Measured on `main` with a `submitHandler` supplied and no
 * `dataSource`, all five read `onSuccess 1 / submitHandler 0`. Through
 * `MasterDetailForm` — whose parent schema declares BOTH
 * `submitHandler: submitViaBatch` and `onSuccess: handleSaved` — that early
 * return reached `handleSaved` directly: a success toast (measured:
 * `toast.success("Created")`) and, in create mode, a form reset clearing the
 * line items nobody wrote. Silent data loss in the worst direction, because the
 * submitter is told it worked.
 *
 * ## The rule this module carries
 *
 * A form has a submit target when it has EITHER a `dataSource` (it writes) or a
 * declared `submitHandler` (the host writes — objectui#6176's seam, which needs
 * no adapter of its own). With neither, exactly one shape is still legitimate:
 * fields authored INLINE, where the author's `onSuccess` IS the write. Anything
 * else must refuse, loudly, instead of confirming.
 *
 * ## What counts as inline, and why it has two limbs
 *
 * Neither limb is a new predicate. Both name a shape this package already
 * documents as working with no adapter, and the test refuses everything else.
 *
 * **(a) `customFields` is non-empty.** `SimpleObjectForm` (`ObjectForm.tsx`)
 * gates its own carve-out on exactly this, the `object-form` element gate
 * (`index.tsx`) declares `requiresDataSource={!(schema?.customFields?.length > 0)
 * && …}` and says so in as many words — *"The one escape hatch is inline
 * `customFields`, which is exactly what `hasInlineFields` gates on inside the
 * component, so the two stay in step"* — and `ObjectFormSchema` glosses the key
 * as *"when used with inline field definitions (without dataSource), this
 * becomes the primary field source"*.
 *
 * **(b) every section field is an inline runtime `FormField`.** This limb is not
 * optional and not an invention: it is how a sectioned form expresses the same
 * thing with no `customFields` at all — its sections carry the definitions.
 * This package's README documents the shape and ships an example of
 * it, `<WizardForm schema={wizard} />` under the comment *"dataSource omitted:
 * every step lists inline fields"*, introduced by *"The inline shape is what
 * lets a wizard run with no data source at all"*. Measured before this module
 * existed: that example renders and submits. A `customFields`-only test would
 * have made the repo's own published example throw — which is why the limb is
 * here.
 *
 * The limb is deliberately ALL-or-nothing, and it is the taxonomy
 * `normalizeSectionField` already keeps: a section field is a name string
 * (shape 1), a spec `FormFieldSchema` whose identity key `field` is a STRING
 * (shape 2), or an inline runtime `FormField` carrying its own `name` (shape 3).
 * Only shape 3 is self-describing; shapes 1 and 2 name fields that only an
 * object schema — and therefore only an adapter — can resolve. So one bare name
 * anywhere in the sections means the form DID need metadata it could not get,
 * and it refuses. Erring that way is the loud direction; the silent one is the
 * defect.
 *
 * `TabbedForm` / `SplitForm` / `WizardForm` receive `customFields` through
 * `ObjectForm`'s `{...schema}` spread. Until objectui#10254 they neither
 * declared nor rendered it, and limb (a) read it there only as a SIGNAL; they
 * now declare it and draw a member a section names, as the drawer and modal do.
 */

/** The shape this module reads — deliberately narrower than any form schema. */
export interface InlineFieldSource {
  customFields?: unknown;
  sections?: unknown;
}

/**
 * `normalizeSectionField`'s shape (3): an already-built runtime `FormField`,
 * carrying its own `name`, needing no object schema to resolve.
 *
 * A STRING `field` is the disambiguator for shape (2), the spec
 * `FormFieldSchema` — there `field` is the field NAME; on a runtime `FormField`
 * the `field` slot holds the metadata OBJECT. A missing `name` is not treated as
 * inline either: shape 3 without one is what used to crash the form renderer on
 * `name.split('.')`, so it is malformed rather than self-describing.
 *
 * Exported because it is also what `buildSectionFields` (`sectionFields.ts`)
 * asks of a section entry before its parent field pool may drop it
 * (objectui#11615): a self-describing entry is drawn whatever the pool holds,
 * as the pool-less arms draw it. One predicate, so "inline enough to need no
 * adapter" and "inline enough to need no pool" cannot drift apart.
 */
export function isInlineFieldDef(def: unknown): boolean {
  if (def === null || typeof def !== 'object' || Array.isArray(def)) return false;
  const fd = def as { field?: unknown; name?: unknown };
  return typeof fd.field !== 'string' && typeof fd.name === 'string';
}

/** Whether EVERY field the sections declare is self-describing (and there is one). */
function sectionsAreFullyInline(sections: unknown): boolean {
  if (!Array.isArray(sections) || sections.length === 0) return false;
  let seen = 0;
  for (const section of sections) {
    if (section === null || typeof section !== 'object') return false;
    const fields = (section as { fields?: unknown }).fields;
    if (!Array.isArray(fields)) return false;
    for (const def of fields) {
      if (!isInlineFieldDef(def)) return false;
      seen += 1;
    }
  }
  return seen > 0;
}

/**
 * Whether the author declared the form's fields inline, i.e. the form is a
 * self-contained collector whose `onSuccess` is the write.
 *
 * Literally `SimpleObjectForm`'s test, kept in one place so the six renderers
 * cannot answer it six ways.
 *
 * The parameter is `object`, not `InlineFieldSource`: TypeScript's weak-type
 * check rejects an argument sharing no property with a wholly-optional
 * interface, so a caller whose schema type declares neither key could not pass
 * it. `TabbedFormSchema` / `SplitFormSchema` / `WizardFormSchema` declared no
 * `customFields` while they did not render it, since declaring a field source a
 * renderer ignores is the declared-≠-enforced shape objectui#6300 set out to
 * undo; they declare it since objectui#10254, which made them render it.
 */
export function hasInlineFieldSource(schema: object | null | undefined): boolean {
  const s = schema as InlineFieldSource | null | undefined;
  if (Array.isArray(s?.customFields) && s.customFields.length > 0) return true;
  return sectionsAreFullyInline(s?.sections);
}

/**
 * The refusal message. `SimpleObjectForm`'s own wording, verbatim, so a host
 * that already matches on it sees one string from all six renderers.
 */
export const NO_SUBMIT_TARGET_MESSAGE =
  'DataSource is required for form submission (inline mode not configured)';

/**
 * The refusal itself.
 *
 * Thrown from INSIDE each container's persistence chain — as the branch taken
 * when none of the real routes (host seam / create / OCC-guarded edit) applies
 * — rather than from a pre-`try` guard, for two reasons:
 *
 *  1. it is where the fact belongs: "there is no route to persist by" is a
 *     verdict about the persistence chain, and expressing it there is also what
 *     lets TypeScript narrow `dataSource` for the routes that use it, with no
 *     assertion;
 *  2. the container's `catch` runs `schema.onError?.(err)` and RETHROWS, so the
 *     host learns why. That is what turns the `MasterDetailForm` reading above
 *     from `toast.success("Created")` into `toast.error(<this message>)` with
 *     the form left intact — the visible half of the fix.
 */
export function noSubmitTargetError(): Error {
  return new Error(NO_SUBMIT_TARGET_MESSAGE);
}
