// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Email Template Metadata Protocol
 *
 * Declarative template definition consumed by `IEmailService.sendTemplate()`
 * to render outbound mail. Persisted as rows of `sys_email_template` so
 * administrators can author/edit/translate templates in Studio without
 * shipping code, and tenants can override the built-in defaults
 * (`allowOrgOverride: true` in the metadata registry).
 *
 * Aligned with Salesforce `EmailTemplate` and ServiceNow
 * `sysevent_email_action` conventions: a single named template is
 * resolved by `(name, locale)`; subject/body strings carry simple
 * `{{path.to.value}}` placeholders rendered against a per-send
 * `data` payload.
 */

/**
 * Logical grouping; surfaces as a filter facet in Studio listings.
 */
export const EmailTemplateDefinitionCategorySchema = lazySchema(() => z.enum([
  'auth',          // Password reset, email verification, magic link, invitation
  'notification',  // System notifications, alerts
  'workflow',      // Approval/flow generated mail
  'marketing',     // Outbound campaigns
  'custom',        // App-defined
]));
export type EmailTemplateDefinitionCategory = z.infer<typeof EmailTemplateDefinitionCategorySchema>;

export const EmailTemplateDefinitionVariableSchema = lazySchema(() => z.object({
  name: z.string().describe('Variable name as referenced in placeholders (snake_case or dotted path)'),
  type: z.enum(['string', 'number', 'boolean', 'date', 'url', 'user', 'record']).default('string'),
  required: z.boolean().default(false),
  description: z.string().optional().describe('Author hint shown in Studio'),
}));
export type EmailTemplateDefinitionVariable = z.infer<typeof EmailTemplateDefinitionVariableSchema>;

export const EmailTemplateDefinitionSchema = lazySchema(() => z.object({
  /**
   * Stable identifier; used as the `template` key in
   * `IEmailService.sendTemplate({ template, ... })`. Convention:
   * dotted namespace prefix (`auth.password_reset`, `crm.welcome`).
   */
  name: z.string()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, 'name must be dotted snake_case')
    .describe('Template identifier (dotted snake_case)'),

  /** Human-readable label shown in Studio. */
  label: z.string().describe('Display label'),

  /** Logical grouping. */
  category: EmailTemplateDefinitionCategorySchema.default('custom'),

  /**
   * IETF BCP-47 locale tag. Multiple rows with the same `name` but
   * different `locale` form an i18n bundle; the service picks the
   * best match for the recipient's locale, falling back to `en-US`.
   */
  locale: z.string().default('en-US').describe('BCP-47 locale (e.g. en-US, zh-CN)'),

  /** Subject line; supports `{{var.path}}` placeholders. */
  subject: z.string().describe('Subject template'),

  /** HTML body; supports `{{var.path}}` placeholders. */
  bodyHtml: z.string().describe('HTML body template'),

  /**
   * Plain-text body. When omitted the service strips tags from
   * `bodyHtml` to derive a text alternative — recommended for spam
   * scoring but optional.
   */
  bodyText: z.string().optional().describe('Plain-text body template (auto-derived from HTML when omitted)'),

  /**
   * Declared variables; rendered as form hints in the Studio
   * authoring UI and validated by `sendTemplate()` when `required`.
   */
  variables: z.array(EmailTemplateDefinitionVariableSchema).default([]),

  /**
   * Per-template override of the service-level default From. Useful
   * when a specific category (e.g. transactional vs marketing)
   * should appear to come from a different address.
   */
  fromOverride: EmailAddressInlineSchema().optional(),

  /** Reply-To header override. */
  replyTo: z.string().optional(),

  /** When false, `sendTemplate()` returns an error (`TEMPLATE_INACTIVE`). */
  active: z.boolean().default(true),

  /**
   * When true the template is provided by a plugin / platform and
   * SHOULD NOT be deleted by tenants (overlay/edit still allowed).
   * Mirrors the `isSystem` flag on object schemas.
   */
  isSystem: z.boolean().default(false),

  /** Free-form description shown in Studio. */
  description: z.string().optional(),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this email template.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}));

/**
 * Inline From/ReplyTo block. Kept inline (not imported from
 * email-config.zod.ts) to avoid circular lazy-schema dependency.
 */
function EmailAddressInlineSchema() {
  return z.object({
    name: z.string().optional(),
    address: z.string().email(),
  });
}

export type EmailTemplateDefinition = z.infer<typeof EmailTemplateDefinitionSchema>;
/** Authoring input for {@link EmailTemplateDefinition} — defaulted fields are optional. */
export type EmailTemplateDefinitionInput = z.input<typeof EmailTemplateDefinitionSchema>;

/**
 * Type-safe factory for an email template. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: EmailTemplateDefinition` literal.
 */
export function defineEmailTemplateDefinition(config: z.input<typeof EmailTemplateDefinitionSchema>): EmailTemplateDefinition {
  return EmailTemplateDefinitionSchema.parse(config);
}
