// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `element-input-target-variable-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helper
// `RECORD_PICKER_COMPONENT_TYPE` is read by this conversion alone). A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `elementInputTargetVariableRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * The SDUI component-props reconciliation (protocol 17, #5775) — three entries
 * below, one shared reason.
 *
 * #5068 wired the first parse `ComponentPropsMap` ever had and measured what
 * the corpus actually authors against it. The measurement came back with
 * divergence in BOTH directions: keys objectui's renderers honour that the
 * schema never declared, and keys the schema declared (one of them REQUIRED)
 * that no renderer has ever read. The maintainer's 2026-08-06 ruling took
 * direction A — the #5611 rule, "the delivered and authorized shape is the
 * contract" — so the honoured keys were declared and the unread ones retire
 * here.
 *
 * **The reach is every position a picker can be authored in** (#6775).
 * {@link mapPageComponents} walks `regions[].components[]`, `slots.<slot>` and
 * the containers a component nests under its `properties` — the same set
 * `walkPageComponents` lints — so a picker inside a card's `children` or a tab
 * panel is rewritten where it sits. The tombstones still carry the refusal at
 * parse time for anything a conversion declines to touch (a disagreeing pair
 * under {@link renameKey}'s house rule, or a source no migration ran over);
 * what changed is that "run `os migrate meta`" is now a prescription the
 * conversion can honour at a nested site, not only at region level.
 *
 * All three are **retired from the load path**: each key is tombstoned in
 * `ui/component.zod.ts`, so `os validate`, `os build` and `os lint` refuse it
 * with the prescription (the component-props gate, `@objectstack/lint`; the
 * load path keeps the open `properties` bag as written) and only
 * `os migrate meta` lists the mechanical edits for existing sources.
 */
const RECORD_PICKER_COMPONENT_TYPE = 'element:record_picker';

/**
 * `element:text_input.targetVariable` / `element:record_picker.targetVariable`
 * — a declarative hint with zero readers (protocol 18, #9198, ADR-0049).
 *
 * The key's own describe text admitted the split: "Declarative hint; the live
 * binding resolves via the variable whose `source` equals this component id".
 * Measured (objectstack-ai/objectui#3834, re-verified at retirement time):
 * no renderer, hook or runtime in objectui, framework or cloud reads it — the
 * console binds input elements through `usePageVariableBinding(schema?.id)`,
 * a reverse lookup over `PageVariableSchema.source`. So an author (human or
 * AI) who read the manifest, wrote `targetVariable` and skipped the
 * variable's `source` got an input that wrote nothing, with a success receipt
 * and no diagnostic anywhere — the ADR-0078 shape, on the exact surface AI
 * authors write from. Enforce-or-remove: removed, not deprecated; the same
 * disposition its sibling inert hint reached in objectui PR #4794.
 *
 * Pure lossless deletes — the key never had an effect to lose. The live
 * binding (`variables[].source`) is untouched, and the tombstone's
 * prescription tells the author how to declare it.
 */
const elementInputTargetVariableRemoved: MetadataConversion = {
  id: 'element-input-target-variable-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.0.0',
  surface:
    'page.component.element:text_input.targetVariable / page.component.element:record_picker.targetVariable',
  summary:
    "text-input/record-picker component prop 'targetVariable' removed (retired under ADR-0049 "
    + 'enforce-or-remove as a declarative hint nothing read; the live binding resolves from the '
    + 'page variable whose `source` names the component id)',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'element:text_input' && component.type !== RECORD_PICKER_COMPONENT_TYPE) {
        return component;
      }
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const stripped = stripKeys(properties, ['targetVariable'], emit, `${path}.properties`);
      if (stripped === properties) return component;
      return { ...component, properties: stripped };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'contact_capture',
          variables: [
            // The LIVE half of the binding — the variable's `source` names the
            // component id, and nothing here touches it.
            { name: 'contact_email', type: 'string', source: 'email_input' },
          ],
          regions: [
            {
              name: 'main',
              components: [
                {
                  id: 'email_input',
                  type: 'element:text_input',
                  properties: { inputType: 'email', targetVariable: 'contact_email' },
                },
                { type: 'element:record_picker', dataSource: { object: 'showcase_project' }, properties: { targetVariable: 'selected_id' } },
                // Negative control: a `targetVariable` on a type OUTSIDE this
                // conversion's dispatch proves the strip is scoped by the
                // component TYPE, not by the key name. It was originally an
                // `element:filter` row ("a DIFFERENT surface, outside #9198's
                // disposition") — #9220 then retired that element at element
                // grain and its conversion strips every `element:filter` key,
                // so the control moved to an open-union custom type, which no
                // conversion may ever touch (the #5068 gate's deliberate-skip
                // class). Same assertion, one hop further out.
                { type: 'custom:legacy_input', properties: { targetVariable: 'active_filter' } },
                // Nested one container down (#6775) — the walk descends.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Pick one',
                    children: [
                      { type: 'element:record_picker', dataSource: { object: 'b' }, properties: { targetVariable: 'picked' } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape, on a slotted record page.
        {
          name: 'contact_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: [
              { type: 'element:text_input', properties: { label: 'Note', targetVariable: 'note_draft' } },
            ],
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'contact_capture',
          variables: [
            { name: 'contact_email', type: 'string', source: 'email_input' },
          ],
          regions: [
            {
              name: 'main',
              components: [
                {
                  id: 'email_input',
                  type: 'element:text_input',
                  properties: { inputType: 'email' },
                },
                { type: 'element:record_picker', dataSource: { object: 'showcase_project' }, properties: {} },
                { type: 'custom:legacy_input', properties: { targetVariable: 'active_filter' } },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Pick one',
                    children: [
                      { type: 'element:record_picker', dataSource: { object: 'b' }, properties: {} },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'contact_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: [
              { type: 'element:text_input', properties: { label: 'Note' } },
            ],
          },
        },
      ],
    },
    // One per stripped key — the custom-typed control keeps its key.
    expectedNotices: 4,
  },
};

export { elementInputTargetVariableRemoved };
