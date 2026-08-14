// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_email_template — Outbound Email Template (metadata row)
 *
 * Backing persistence for the `email_template` metadata type. Each
 * row is the runtime representation of an `EmailTemplate` Zod
 * envelope. Resolved by `(name, locale)`; the EmailService picks the
 * best-matching locale for the recipient, falling back to `en-US`.
 *
 * Authoring: built-in templates are seeded by `EmailServicePlugin`
 * on `kernel:ready`; administrators may edit subject/body in Studio
 * and tenants may overlay specific rows.
 *
 * @namespace sys
 */
export const SysEmailTemplate = ObjectSchema.create({
  name: 'sys_email_template',
  label: 'Email Template',
  pluralLabel: 'Email Templates',
  icon: 'mail',
  isSystem: true,
  managedBy: 'config',
  description: 'Outbound email template (subject + body + variables) resolved by name+locale',
  displayNameField: 'label',
  nameField: 'label', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{label}',
  highlightFields: ['name', 'label', 'category', 'locale', 'active'],

  fields: {
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    // ── Identity ─────────────────────────────────────────────────
    name: Field.text({
      label: 'Name',
      required: true,
      maxLength: 128,
      description: 'Dotted snake_case identifier (e.g. auth.password_reset)',
      group: 'Identity',
    }),
    label: Field.text({
      label: 'Label',
      required: true,
      maxLength: 200,
      description: 'Human-readable name shown in Studio',
      group: 'Identity',
    }),
    category: Field.select(
      ['auth', 'notification', 'workflow', 'marketing', 'custom'],
      {
        label: 'Category',
        required: true,
        defaultValue: 'custom',
        group: 'Identity',
      },
    ),
    locale: Field.text({
      label: 'Locale',
      required: true,
      defaultValue: 'en-US',
      maxLength: 16,
      description: 'BCP-47 locale tag (en-US, zh-CN, …)',
      group: 'Identity',
    }),
    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

    // ── Content ──────────────────────────────────────────────────
    subject: Field.text({
      label: 'Subject',
      required: true,
      maxLength: 500,
      description: 'Subject template; supports {{var.path}} placeholders',
      group: 'Content',
    }),
    body_html: Field.textarea({
      label: 'HTML Body',
      required: true,
      description: 'HTML body template; supports {{var.path}} placeholders',
      group: 'Content',
    }),
    body_text: Field.textarea({
      label: 'Plain Text Body',
      required: false,
      description: 'Optional plain-text alternative (auto-derived from HTML when blank)',
      group: 'Content',
    }),

    // ── Envelope overrides ───────────────────────────────────────
    from_name: Field.text({
      label: 'From Name',
      required: false,
      maxLength: 200,
      group: 'Envelope',
    }),
    from_address: Field.text({
      label: 'From Address',
      required: false,
      maxLength: 255,
      group: 'Envelope',
    }),
    reply_to: Field.text({
      label: 'Reply-To',
      required: false,
      maxLength: 255,
      group: 'Envelope',
    }),

    // ── Lifecycle ────────────────────────────────────────────────
    active: Field.boolean({
      label: 'Active',
      required: true,
      defaultValue: true,
      group: 'Lifecycle',
    }),
    is_system: Field.boolean({
      label: 'System Template',
      required: false,
      defaultValue: false,
      readonly: true,
      description: 'Provided by a plugin / platform; tenants may edit but should not delete',
      group: 'Lifecycle',
    }),

    /**
     * Variables declared by the template author. Stored as JSON text
     * (array of {name,type,required,description}). Used by the Studio
     * authoring UI to render form hints and by sendTemplate() to
     * validate required vars at runtime.
     */
    variables_json: Field.textarea({
      label: 'Variables (JSON)',
      required: false,
      description: 'JSON array of {name,type,required,description}',
      group: 'Lifecycle',
    }),

    // ── Provenance (#4509 — record-authoritative seed-not-clobber) ──
    // Mirrors sys_webhook (#3461) / sys_sharing_rule (#2909). `is_system`
    // remains the built-in-auth-template axis; these two track the DECLARED
    // metadata door: bootstrapDeclaredEmailTemplates seeds `package` rows and
    // re-seeds them every boot, while an admin's edit stamps `customized` and
    // freezes the row. Both are `readonly` — the engine strips them from
    // non-system payloads, and only the seeder / stamp hook (isSystem) write
    // them. Deliberately NOT a write gate: editing a template in Studio is a
    // first-class admin action, it just has to be remembered.
    managed_by: Field.select(
      ['platform', 'package', 'admin'],
      {
        label: 'Managed By',
        required: false,
        readonly: true,
        defaultValue: 'admin',
        description:
          'Record provenance: platform = framework built-in / package = app/package-declared ' +
          '(boot-seeded from declared email_template metadata) / admin = created in Studio.',
        group: 'System',
      },
    ),

    customized: Field.boolean({
      label: 'Customized',
      required: false,
      readonly: true,
      defaultValue: false,
      description:
        'Set when an admin edits a package-declared template; boot seeding will no longer ' +
        'overwrite the row (a reworded password-reset mail survives redeploys). Meaningless on admin rows.',
      group: 'System',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
    updated_at: Field.datetime({ label: 'Updated At', required: false, group: 'System' }),
  },

  indexes: [
    // [#8554] Scope spelled EXPLICITLY (ADR-0120 D1). On a DECLARED index bare
    // `unique: true` is the positional spelling of `'global'` — the listed
    // columns VERBATIM, composite included — so `(name, locale)` was an
    // installation-wide key on a tenant-scoped object. Measured live before the
    // fix: org_jia creates (welcome, en-US) 201 / org_yi the SAME pair 409
    // UNIQUE_VIOLATION / org_yi (other_tpl, en-US) 201 / org_yi (welcome, zh-CN)
    // 201 / org_yi's own GET on the colliding pair 0 rows. The last two controls
    // are what prove the key was the composite rather than `name` alone.
    // Admins author and overlay templates per tenant, so two organizations both
    // holding a `welcome` / `en-US` template is the normal case.
    { fields: ['name', 'locale'], unique: 'organization' },
    { fields: ['category'] },
    { fields: ['active'] },
  ],
});
