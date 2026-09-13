// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

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
 * The one locale tag with standing in an email-template bundle: the schema
 * default for {@link EmailTemplateDefinitionSchema}.`locale` AND the sole rung
 * `IEmailService.sendTemplate` retries after an exact `(name, locale)` miss.
 *
 * Named because those two roles are the same fact and authors keep reading it
 * as neither: the resolver does no language-subtag folding, so this literal —
 * not the stack's `i18n.defaultLocale`, not a bare `en` — is what makes a
 * bundle reachable from a recipient locale nobody authored a row for. A bundle
 * without a row at this tag has no fallback floor at all.
 *
 * ⚠️ `@objectstack/plugin-email` spells the same value as its own
 * `DEFAULT_TEMPLATE_LOCALE` (that package implements the ladder; this one only
 * declares the contract). The two must stay equal — the ladder's shape is a
 * settled ruling, so this constant tracks it rather than the other way round.
 */
export const EMAIL_TEMPLATE_FLOOR_LOCALE = 'en-US';

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
export type EmailTemplateDefinitionCategory = z.input<typeof EmailTemplateDefinitionCategorySchema>;

export const EmailTemplateDefinitionVariableSchema = lazySchema(() => z.object({
  name: z.string().describe('Variable name as referenced in placeholders (snake_case or dotted path)'),
  type: z.enum(['string', 'number', 'boolean', 'date', 'url', 'user', 'record']).default('string'),
  required: z.boolean().default(false),
  description: z.string().optional().describe('Author hint shown in Studio'),
}));
export type EmailTemplateDefinitionVariable = z.input<typeof EmailTemplateDefinitionVariableSchema>;
/** Post-parse shape of {@link EmailTemplateDefinitionVariable} — defaults applied, transforms run (ADR-0122). */
export type EmailTemplateDefinitionVariableParsed = z.infer<typeof EmailTemplateDefinitionVariableSchema>;

export const EmailTemplateDefinitionSchema = lazySchema(() => strictObject({
  surface: 'this email template',
  history:
    'Until this shape was closed these were dropped silently — the item still registered, minus whatever the key was meant to configure.',
  // #5013 — five of these pointed at `body` and `fromAddress`, neither of which
  // this schema declares: every one of them prescribed a second rejection. The
  // real slots are the two bodies and the per-template From override.
  //
  // `content` goes to `bodyHtml` rather than `bodyText` deliberately: `bodyHtml`
  // is the REQUIRED body and accepts any string, and the service derives the
  // plain-text alternative from it when `bodyText` is omitted — so the rename
  // produces a template that actually renders whether the author's content was
  // markup or prose, which is the property a prescription has to have.
  aliases: {
    title: 'subject',
    content: 'bodyHtml', html: 'bodyHtml', text: 'bodyText',
    from: 'fromOverride', sender: 'fromOverride',
  },
}, {
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
   * IETF BCP-47 locale tag — the second half of the bundle key.
   *
   * Multiple rows sharing one `name` form an i18n bundle. The resolver
   * (`IEmailService.sendTemplate`) matches `(name, locale)` **exactly** and
   * then retries exactly one rung: the **literal** string
   * {@link EMAIL_TEMPLATE_FLOOR_LOCALE}. There is no language-subtag folding
   * on that path — `en-US` does not fall back to `en`, and `en` is not
   * reachable from `en-US`.
   *
   * ⚠️ So `en-US` is the bundle's FLOOR, and a bundle carrying no `en-US` row
   * has none: every recipient locale the bundle does not itself carry a row
   * for raises `TEMPLATE_NOT_FOUND`, which classifies **permanent** — the
   * delivery dead-letters with no retry. The reachable locale set is not the
   * set the author enumerated either: `sys_user.locale` is user-editable
   * free-text BCP-47, unconstrained by the stack's `i18n.supportedLocales`,
   * so a recipient can select a legal tag nobody authored.
   *
   * ⛔ The stack's own declared `i18n.defaultLocale` is the WRONG tag here
   * whenever it is not spelled `en-US`. An app that declares
   * `defaultLocale: 'en'` and then authors `locale: 'en'` has done the
   * consistent thing throughout and still shipped a bundle with no floor —
   * it validates, builds and installs clean. Author the English row at the
   * `en-US` default and add the other tags beside it; `defineStack` reports a
   * bundle that carries `supportedLocales` rows without an `en-US` one.
   */
  locale: z.string().default(EMAIL_TEMPLATE_FLOOR_LOCALE).describe(
    'BCP-47 locale (e.g. en-US, zh-CN) — the bundle key the resolver matches EXACTLY, with one '
    + 'retry rung: the literal `en-US`. No language-subtag folding, so `en` and `en-US` are '
    + 'different bundles and neither reaches the other. A bundle with no `en-US` row therefore has '
    + 'no fallback floor: any recipient locale it does not carry a row for raises '
    + 'TEMPLATE_NOT_FOUND, which is permanent — the delivery dead-letters with no retry. Your '
    + "stack's own `i18n.defaultLocale` is the wrong tag here unless it is spelled `en-US`.",
  ),

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

export type EmailTemplateDefinition = z.input<typeof EmailTemplateDefinitionSchema>;
/** Post-parse shape of {@link EmailTemplateDefinition} — defaults applied, transforms run (ADR-0122). */
export type EmailTemplateDefinitionParsed = z.infer<typeof EmailTemplateDefinitionSchema>;

/**
 * Type-safe factory for an email template. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: EmailTemplateDefinition` literal.
 */
export function defineEmailTemplateDefinition(config: z.input<typeof EmailTemplateDefinitionSchema>): EmailTemplateDefinitionParsed {
  return EmailTemplateDefinitionSchema.parse(config);
}
