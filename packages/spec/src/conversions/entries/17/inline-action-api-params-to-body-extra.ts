// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `inline-action-api-params-to-body-extra` conversion
// (`toMajor: 17`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `inlineActionApiParamsToBodyExtra` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents, renameKey } from '../../walk.js';
import { isDict } from '../shared.js';

/**
 * Inline `type:'api'` action: object-form `params` → `bodyExtra` (protocol 17,
 * #5777).
 *
 * One key carried two fact-contracts. `InlineActionSchema.params` is picked
 * from `ActionSchema` and is an `ActionParam[]` **definition array** — the
 * fields a dialog collects before the action runs. What the showcase's
 * pure-SDUI contact form authored on its submit button is a **request payload
 * map** (`params: { name: '{{page.inquiryName}}', … }`), and objectui's
 * `ActionRunner` took both: its own comment says "Accept both — when `params`
 * is an array, treat it as the input-collection definition", discriminating on
 * `Array.isArray`. A tolerant consumer fossilizing a wrong convention is Prime
 * Directive #12's exact shape, and here the fossil was load-bearing: the
 * generated reference could only describe the array, so an author following the
 * docs could not write a working `api` submit button at all.
 *
 * The maintainer's 2026-08-06 ruling on #5777 took **direction A — a separate
 * payload key**, explicitly refusing the same-name union of option B. The
 * separate key is `bodyExtra`, which `ActionSchema` has declared all along for
 * exactly this ("static body fragment merged into the outgoing request body for
 * `type:'api'` actions"); #5777's spec half picks it onto the inline shape, so
 * the rewrite target is a key the contract already owns rather than a third
 * name. `payload` is already an alias pointing there (#5013) and `body` is
 * already the `script` hook body, so those two spellings were never available.
 *
 * **Why a conversion and not a deletion.** The two shapes are disjoint —
 * `Array.isArray` decides, with no value that could be read either way — so the
 * rewrite is mechanical and lossless, which is the ADR-0087 D2 precondition.
 * Deleting instead would strand every page authored the old way on a bare
 * `expected array, received object`.
 *
 * **Scoped to `type:'api'`, deliberately.** Object-form `params` on an inline
 * `type:'url'` action is a THIRD meaning again — `ActionRunner.interpolateTarget`
 * reads it as the `${param.X}` interpolation scope, and `executeUrl` reads
 * `params.newTab` — so rewriting those into an api request body would be lossy,
 * not lossless. Nothing in the reachable corpus authors that shape; it stays
 * refused by the array-only field, and this entry does not touch it.
 *
 * **Not extended to registered actions.** `ActionSchema` is parsed at
 * `defineAction`, so its array-only `params` has always refused the object form
 * at the authoring door — the defect existed only on the inline path, where
 * `PageComponent.properties` is an open bag and nothing parsed the props until
 * #5068. Registered actions already reach the payload through `bodyExtra`.
 *
 * Precedence is {@link renameKey}'s house rule and nothing new: an
 * already-present `bodyExtra` WINS and a differing object-form `params` is left
 * exactly where it sits, for the author to reconcile (#4923).
 *
 * The reach is every position a button can be authored in, as for
 * {@link pageHeaderSubtitleAlias} and the retired `page-card-body-to-children`
 * (#6775, retired with the protocol-16.x kits in #25767):
 * `regions[].components[]`, `slots.<slot>`, and the containers a component
 * nests under its `properties` — which is where a submit button most often
 * sits, inside the card that holds the form. The array-only field still covers
 * anything the rewrite declines to touch: it refuses the object form with a
 * message naming `bodyExtra`, at any position.
 *
 * **Retired from the load path at 18** — its one-major window (protocol 17)
 * has run (#23421). The authoring funnel no longer rewrites the object form,
 * so an author meets that array-only field's refusal naming `bodyExtra` at
 * every door that judges page props — `os validate` / `os build` / `os lint`
 * and the metadata save door alike, where before the first two converted
 * silently and the save door refused. Stored rows keep healing: stored-row
 * rehydration replays the full chain, this entry included
 * (`applyConversionsToStoredItem`), and so do the artifact-ingestion door
 * (inside its window) and `os migrate meta`.
 */
const inlineActionApiParamsToBodyExtra: MetadataConversion = {
  id: 'inline-action-api-params-to-body-extra',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.component.element:button.action.params',
  summary:
    "inline type:'api' action prop 'params' (object form) → 'bodyExtra' (a static payload and a parameter definition are two things, so the payload gets its own key; `params` stays the ActionParam[] definition array)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'element:button') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const action = properties.action;
      if (!isDict(action)) return component;
      // Only the payload meaning converts. `Array.isArray` is the whole
      // discriminator — a definition array stays put — and the `api` guard
      // keeps the url-action interpolation scope out of it.
      if (action.type !== 'api') return component;
      if (!isDict(action.params)) return component;
      const renamed = renameKey(action, 'params', 'bodyExtra');
      if (!renamed) return component;
      emit({ from: 'params', to: 'bodyExtra', path: `${path}.properties.action.bodyExtra` });
      return { ...component, properties: { ...properties, action: renamed } };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'showcase_contact_form',
          regions: [
            {
              name: 'main',
              components: [
                // The measured site: a pure-SDUI form submit posting page vars.
                {
                  type: 'element:button',
                  properties: {
                    label: 'Submit inquiry',
                    action: {
                      type: 'api',
                      target: '/api/v1/forms/contact-us/submit',
                      method: 'POST',
                      params: { name: '{{page.inquiryName}}', email: '{{page.inquiryEmail}}' },
                    },
                  },
                },
                // A real ActionParam[] definition array — the other meaning of
                // the same key, untouched.
                {
                  type: 'element:button',
                  properties: {
                    label: 'Close order',
                    action: {
                      type: 'api',
                      target: '/api/v1/sales_order/close',
                      params: [{ name: 'reason', label: 'Reason', type: 'text' }],
                    },
                  },
                },
                // Both spellings, DIFFERENT payloads: kept, so the author
                // reconciles the two bodies rather than the loader picking.
                {
                  type: 'element:button',
                  properties: {
                    label: 'Both',
                    action: {
                      type: 'api',
                      target: '/api/v1/x',
                      params: { a: 1 },
                      bodyExtra: { b: 2 },
                    },
                  },
                },
                // `type:'url'` — object-form `params` is the `${param.X}`
                // interpolation scope there, a third meaning. Not this entry's.
                {
                  type: 'element:button',
                  properties: {
                    label: 'Open',
                    action: { type: 'url', target: '/x?id=${param.id}', params: { id: 'abc' } },
                  },
                },
                // The shape a pure-SDUI form is actually built in (#6775): the
                // submit button sits in the card's `footer`, one container down.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Contact us',
                    footer: [
                      {
                        type: 'element:button',
                        properties: {
                          label: 'Send',
                          action: { type: 'api', target: '/api/v1/forms/send', params: { note: '{{page.note}}' } },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape: an action button in a slotted page's `actions`.
        {
          name: 'showcase_contact_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            actions: [
              {
                type: 'element:button',
                properties: {
                  label: 'Resend',
                  action: { type: 'api', target: '/api/v1/forms/resend', params: { id: '{{record.id}}' } },
                },
              },
            ],
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'showcase_contact_form',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'element:button',
                  properties: {
                    label: 'Submit inquiry',
                    action: {
                      type: 'api',
                      target: '/api/v1/forms/contact-us/submit',
                      method: 'POST',
                      bodyExtra: { name: '{{page.inquiryName}}', email: '{{page.inquiryEmail}}' },
                    },
                  },
                },
                {
                  type: 'element:button',
                  properties: {
                    label: 'Close order',
                    action: {
                      type: 'api',
                      target: '/api/v1/sales_order/close',
                      params: [{ name: 'reason', label: 'Reason', type: 'text' }],
                    },
                  },
                },
                {
                  type: 'element:button',
                  properties: {
                    label: 'Both',
                    action: {
                      type: 'api',
                      target: '/api/v1/x',
                      params: { a: 1 },
                      bodyExtra: { b: 2 },
                    },
                  },
                },
                {
                  type: 'element:button',
                  properties: {
                    label: 'Open',
                    action: { type: 'url', target: '/x?id=${param.id}', params: { id: 'abc' } },
                  },
                },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Contact us',
                    footer: [
                      {
                        type: 'element:button',
                        properties: {
                          label: 'Send',
                          action: { type: 'api', target: '/api/v1/forms/send', bodyExtra: { note: '{{page.note}}' } },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'showcase_contact_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            actions: [
              {
                type: 'element:button',
                properties: {
                  label: 'Resend',
                  action: { type: 'api', target: '/api/v1/forms/resend', bodyExtra: { id: '{{record.id}}' } },
                },
              },
            ],
          },
        },
      ],
    },
    expectedNotices: 3,
  },
};

export { inlineActionApiParamsToBodyExtra };
