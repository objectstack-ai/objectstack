// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `email-template-category-is-system-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `emailTemplateCategoryIsSystemRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `category` and `isSystem` on an email template — retired together (#22876,
 * ADR-0049 enforce-or-remove).
 *
 * Nothing read either key once ADR-0131 D6/D10 retired the projection of
 * declared templates into `sys_email_template` rows: `category` fed a Setup
 * column there and `isSystem` the built-in seeder's stand-down. The tombstones
 * on `EmailTemplateDefinitionSchema` refuse both at parse (see
 * `EMAIL_TEMPLATE_CATEGORY_REMOVED` and `EMAIL_TEMPLATE_IS_SYSTEM_REMOVED` in
 * `system/email-template.zod.ts`).
 *
 * ## Why a D2 strip
 *
 * Both keys carried a schema DEFAULT (`'custom'`, `false`), so a 17.x parse
 * wrote both into every template it emitted, whether or not the author wrote
 * them: every built artifact and every stored `email_template` row carries
 * them. After the tombstones the boot door refuses such a template
 * (`ObjectStackDefinitionSchema` spreads
 * `emailTemplates: z.array(EmailTemplateDefinitionSchema)`), and so does the
 * email plugin's loader, which re-parses every candidate at send time. Only
 * the D2 table is replayed at the rehydration seams
 * (`applyArtifactForwardConversions`, `applyConversionsToStoredItem`), so a
 * built artifact or a stored row loads and sends only through this entry. The
 * strip is lossless: nothing read either key, so no send renders differently.
 *
 * Each key leaves whatever it holds — the default, an authored value, or a
 * value no longer of the declared type: the tombstone refuses every value, so
 * a strip that kept any would leave a template that still cannot load. The
 * emitted path NAMES the template, as `cube-refresh-key-removed` names its
 * cube: an index into `emailTemplates[]` is a position, not a name. The D3
 * record is the semantic entry `email-template-category-is-system-retired`.
 */
const emailTemplateCategoryIsSystemRemoved: MetadataConversion = {
  id: 'email-template-category-is-system-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'emailTemplates[].category / emailTemplates[].isSystem',
  summary:
    "email template keys 'category' and 'isSystem' removed (ADR-0049 enforce-or-remove — nothing read "
    + 'either: the Studio listing never offered the category facet, and no door refused deleting a '
    + "template that set isSystem. Delete both keys; a built-in template is a code package's declaration "
    + 'that a Studio save overrides and a discard restores)',
  apply(stack, emit) {
    return mapCollection(stack, 'emailTemplates', (template, path) => {
      // Name the template, not just its index: the notice is the only record
      // an upgrading author gets of WHICH template lost the keys.
      const where = typeof template.name === 'string' ? `${path}(${template.name})` : path;
      return stripKeys(template, ['category', 'isSystem'], emit, where);
    });
  },
  fixture: {
    before: {
      emailTemplates: [
        {
          // The built-in auth templates' shape: both keys authored.
          name: 'auth.password_reset',
          label: 'Password Reset',
          category: 'auth',
          locale: 'en-US',
          subject: 'Reset your password',
          bodyHtml: '<p><a href="{{{resetUrl}}}">Reset</a></p>',
          variables: [{ name: 'resetUrl', type: 'url', required: true }],
          isSystem: true,
        },
        {
          // What a 17.x parse emitted for a template whose author wrote
          // neither key: both defaults, materialized.
          name: 'crm.welcome',
          label: 'Welcome',
          category: 'custom',
          locale: 'en-US',
          subject: 'Welcome',
          bodyHtml: '<p>Welcome</p>',
          isSystem: false,
        },
        {
          // Already canonical — rides through untouched. The fixture's own
          // control: the strip dispatches on key presence, and copy-on-write
          // keeps this reference.
          name: 'crm.follow_up',
          label: 'Follow-up',
          locale: 'en-US',
          subject: 'Following up',
          bodyHtml: '<p>Following up</p>',
        },
      ],
    },
    after: {
      emailTemplates: [
        {
          name: 'auth.password_reset',
          label: 'Password Reset',
          locale: 'en-US',
          subject: 'Reset your password',
          bodyHtml: '<p><a href="{{{resetUrl}}}">Reset</a></p>',
          variables: [{ name: 'resetUrl', type: 'url', required: true }],
        },
        {
          name: 'crm.welcome',
          label: 'Welcome',
          locale: 'en-US',
          subject: 'Welcome',
          bodyHtml: '<p>Welcome</p>',
        },
        {
          name: 'crm.follow_up',
          label: 'Follow-up',
          locale: 'en-US',
          subject: 'Following up',
          bodyHtml: '<p>Following up</p>',
        },
      ],
    },
    // Four notices, one per STRIPPED KEY: both keys on `auth.password_reset`
    // and on `crm.welcome`, none for the canonical `crm.follow_up`.
    expectedNotices: 4,
  },
};

export { emailTemplateCategoryIsSystemRemoved };
