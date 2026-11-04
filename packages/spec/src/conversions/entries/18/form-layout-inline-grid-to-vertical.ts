// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `form-layout-inline-grid-to-vertical` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `formLayoutInlineGridToVertical` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, mapPageComponents, mapViewPayloads } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, isDict } from '../shared.js';

/**
 * Form `layout` sheds its `inline` and `grid` arms (protocol 18, #20221 —
 * ADR-0049 enforce-or-remove; triage direction under the maintainer's #18900
 * family criterion: the capability exists under another key, so the two arms
 * are redundant vocabulary ⇒ retire, with no alias window).
 *
 * Two surfaces declared the same four-arm enum — `ObjectFormPropsSchema.layout`
 * (the `object-form` page component) and `FormViewSchema.layout` — and no
 * renderer ever gave `inline` or `grid` a behaviour of its own. Measured at the
 * `.objectui-sha` pin `f8a9d0fb0`: the simple arm folds both to `vertical`
 * (`ObjectForm.tsx:1406-1410`), the drawer/modal arms pass only
 * `vertical`/`horizontal` through, and the tabbed/split/wizard sub-forms
 * hard-code `vertical`. Multi-column — what `grid` would mean — is `columns`,
 * honoured under every arm; `inline` is a toolbar / filter-row pattern, not a
 * record-form layout.
 *
 * **A behaviour-preserving REWRITE to `vertical`, not a strip.** Both values
 * rendered as `vertical`, so writing `vertical` keeps what the author saw and
 * keeps the author's explicit choice visible in the source; `columns` beside
 * it is untouched, which is what carries a multi-column intent. Deleting the
 * key would render identically too (`vertical` is the renderer default); the
 * rewrite is the triage's execution note, followed.
 *
 * **Three reaches, because a form payload travels in three places.**
 *   - page components of type `object-form` (`properties.layout`), through
 *     {@link mapPageComponents} — regions, slots and container nesting;
 *   - every FORM payload a `views` entry carries, through
 *     {@link mapViewPayloads} — `form`, `formViews.*`, a form view item's
 *     `config`, and a flattened form overlay — scoped by `kind === 'form'`,
 *     so a list payload's keys are never judged;
 *   - the assembled-manifest `viewItems` channel
 *     ({@link ASSEMBLED_VIEW_ITEMS_KEY}): a form view item's `config`, or a
 *     flattened form overlay's own top level (`viewKind` is required there).
 *     An artifact assembled before this release would otherwise be refused at
 *     registration over a value that never had an effect — the
 *     `view-item-owner-hidden-removed` reasoning, one key over.
 *
 * `retiredFromLoadPath`: both enums refuse the two values outright, each with
 * a per-value prescription (`OBJECT_FORM_LAYOUT_RETIRED` in
 * ui/component.zod.ts, `FORM_VIEW_LAYOUT_RETIRED` in ui/view.zod.ts), so a
 * live author is taught at parse rather than silently rewritten. The entry
 * exists so stored rows and assembled artifacts replay clean, and so
 * `os migrate meta` lists the mechanical edits for author sources. Idempotent
 * by construction: the rewrite's output is outside its own input set.
 */
const formLayoutInlineGridToVertical: MetadataConversion = {
  id: 'form-layout-inline-grid-to-vertical',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'page.component.object-form.layout / view.form.layout / view.formViews.*.layout',
  summary:
    "form 'layout' arms 'inline' and 'grid' rewritten to 'vertical' (ADR-0049 — no renderer "
    + "ever gave either a behaviour of its own: every form presentation folded both to 'vertical'. "
    + "Multi-column is 'columns', honoured under either layout, and is left untouched)",
  apply(stack, emit) {
    const RETIRED_LAYOUTS: ReadonlySet<unknown> = new Set(['inline', 'grid']);
    const rewriteLayout = (payload: Dict, path: string): Dict => {
      const layout = payload.layout;
      if (!RETIRED_LAYOUTS.has(layout)) return payload;
      emit({ from: String(layout), to: 'vertical', path: `${path}.layout` });
      return { ...payload, layout: 'vertical' };
    };
    const withPages = mapPageComponents(stack, (component, path) => {
      if (component.type !== 'object-form') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const next = rewriteLayout(properties, `${path}.properties`);
      return next === properties ? component : { ...component, properties: next };
    });
    const withViews = mapViewPayloads(withPages, (payload, kind, path) =>
      kind === 'form' ? rewriteLayout(payload, path) : payload);
    return mapCollection(withViews, ASSEMBLED_VIEW_ITEMS_KEY, (item, path) => {
      if (item.viewKind !== 'form') return item;
      if (isDict(item.config)) {
        const config = rewriteLayout(item.config, `${path}.config`);
        return config === item.config ? item : { ...item, config };
      }
      // A flattened form overlay — the body IS the payload. A present but
      // malformed `config` is neither shape and is left for the parse.
      return item.config === undefined ? rewriteLayout(item, path) : item;
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'intake_forms',
          regions: [
            {
              name: 'main',
              components: [
                // `grid` with the key that actually carries a multi-column
                // intent: the value is rewritten, `columns` is kept.
                {
                  type: 'object-form',
                  properties: { objectName: 'crm_lead', layout: 'grid', columns: 2 },
                },
                // `inline` rendered as `vertical` too.
                { type: 'object-form', properties: { objectName: 'crm_lead', layout: 'inline' } },
                // A surviving arm is untouched.
                { type: 'object-form', properties: { objectName: 'crm_lead', layout: 'horizontal' } },
                // The same key on a component that is NOT an `object-form` is a
                // different surface and survives byte-identically.
                { type: 'element:custom', properties: { layout: 'grid' } },
              ],
            },
          ],
        },
      ],
      views: [
        {
          object: 'crm_lead',
          // A container: the default form and a named form view.
          form: { type: 'simple', layout: 'grid', columns: 3 },
          formViews: { quick: { type: 'simple', layout: 'inline' } },
        },
      ],
      viewItems: [
        // An assembled form view item record, and a flattened form overlay.
        {
          name: 'crm_lead.intake',
          object: 'crm_lead',
          viewKind: 'form',
          config: { type: 'tabbed', layout: 'grid' },
        },
        { name: 'crm_lead.edit', object: 'crm_lead', viewKind: 'form', type: 'simple', layout: 'inline' },
      ],
    },
    after: {
      pages: [
        {
          name: 'intake_forms',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-form',
                  properties: { objectName: 'crm_lead', layout: 'vertical', columns: 2 },
                },
                { type: 'object-form', properties: { objectName: 'crm_lead', layout: 'vertical' } },
                { type: 'object-form', properties: { objectName: 'crm_lead', layout: 'horizontal' } },
                { type: 'element:custom', properties: { layout: 'grid' } },
              ],
            },
          ],
        },
      ],
      views: [
        {
          object: 'crm_lead',
          form: { type: 'simple', layout: 'vertical', columns: 3 },
          formViews: { quick: { type: 'simple', layout: 'vertical' } },
        },
      ],
      viewItems: [
        {
          name: 'crm_lead.intake',
          object: 'crm_lead',
          viewKind: 'form',
          config: { type: 'tabbed', layout: 'vertical' },
        },
        { name: 'crm_lead.edit', object: 'crm_lead', viewKind: 'form', type: 'simple', layout: 'vertical' },
      ],
    },
    // One per rewritten `layout`: two page components, the container's `form`
    // and its named form view, the assembled record and the assembled overlay.
    // The `horizontal` arm and the non-`object-form` component emit none.
    expectedNotices: 6,
  },
};

export { formLayoutInlineGridToVertical };
