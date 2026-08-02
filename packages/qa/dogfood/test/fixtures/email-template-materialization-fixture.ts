// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Email-template materialization fixture — the deterministic ADR-0054 proof for
// the `email-template-materialization` high-risk class.
//
// An `email_template` prop is `live` in the ledger because a stack-authored
// `emailTemplates:` entry is materialized into the `sys_email_template` row that
// `sendTemplate` reads (#4509) — but "materialized" is not "reaches the send
// path". The authored value crosses manifest-decomposition → the ObjectQL
// registry (type `email_template`) → `bootstrapDeclaredEmailTemplates` →
// `engine.insert('sys_email_template')` → the plugin's `TemplateLoader` →
// `EmailService.sendTemplate`, and the break can live in any seam — the whole
// disconnect this closes was exactly such a break, with an authoring surface on
// one side and the renderer on the other.
//
// The template deliberately overrides a BUILT-IN auth template name
// (`auth.password_reset`): that is the case #4509 called out as ADR-0078 false
// compliance — an admin "fixes" the password-reset mail and users keep receiving
// the built-in copy. The proof asserts the authored wording actually wins.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { defineEmailTemplateDefinition } from '@objectstack/spec/system';

/** One trivial object — a stack needs a data surface to boot against. */
export const EtNote = ObjectSchema.create({
  name: 'et_note',
  // [ADR-0090 D1] grandfather stamp: the gate under test is email-template
  // materialization, not owner-sharing — keep RLS out of the way.
  sharingModel: 'public_read_write',
  label: 'ET Note',
  pluralLabel: 'ET Notes',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

/**
 * The stack-authored override of the built-in password-reset mail. `bodyHtml`
 * (spec) must land as `body_html` (runtime col) and the authored subject must
 * beat the built-in seed — the outcomes the proof asserts.
 */
export const etPasswordReset = defineEmailTemplateDefinition({
  name: 'auth.password_reset',
  label: 'ET Password Reset',
  category: 'auth',
  subject: 'Authored reset for {{user.name}}',
  bodyHtml: '<p>Authored body: <a href="{{url}}">reset</a></p>',
  variables: [{ name: 'url', type: 'string', required: true }],
});

export const emailTemplateFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.email_template_fixture',
    namespace: 'et',
    version: '0.0.0',
    type: 'app',
    name: 'Email Template Materialization Fixture',
    description: 'Single-object app that authors one email template to prove stack `emailTemplates:` entries materialize into the sys_email_template rows sendTemplate reads (ADR-0054, #4509).',
  },
  objects: [EtNote],
  emailTemplates: [etPasswordReset],
});
