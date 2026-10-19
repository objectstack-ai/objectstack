// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema } from '@objectstack/spec/data';
import { SysEmail } from './sys-email.object.js';

/**
 * sys_identity_email — Outbound Identity Mail Log
 *
 * The deployment-level sibling of `sys_email` (ADR-0131 D7, ruling of record
 * 6257510973, letter Q2 A). Identity mail is mail about a PERSON rather than
 * an organization — verification, password reset, magic link, email-change
 * notice, an account invitation to someone who belongs to no organization
 * yet — so it has no organization to stamp. It lives here, with no
 * organization column, instead of as an organization-less row in the tenant
 * mail log: ⛔ neither a nullable column nor unpersisted mail.
 *
 * Same row shape as `sys_email` — the fields ARE `sys_email`'s, so the two
 * cannot drift — and the same pipeline: `IEmailService.send` with
 * `identityMail: true` writes the row, and the queue worker, the outbox drain
 * hook, the boot outbox sweep and attachment reclamation read it by id and
 * status exactly as they read `sys_email`.
 *
 * Expand-first: rows an 18.0 install wrote to `sys_email` for this mail stay
 * there; the mail pipeline keeps reading them, and moving them is the 18.x
 * upgrade ceremony's.
 *
 * `systemFields: { tenant: false }` removes the injected organization column.
 * With no column there is no tenant wall, so who may read is object
 * permission (D7): these rows carry password-reset and sign-in links, so the
 * platform-only capability, as on `sys_job` — under a wall an organization's
 * administrator must not read every person's links.
 *
 * Typical writers: `IEmailService.send()` / `sendTemplate()` with `identityMail: true`
 * (plugin-auth's identity mails).
 * Typical readers: the mail delivery pipeline, the platform administrator.
 *
 * @namespace sys
 */
export const SysIdentityEmail = ObjectSchema.create({
  name: 'sys_identity_email',
  label: 'Identity Email',
  pluralLabel: 'Identity Emails',
  icon: 'mail',
  isSystem: true,
  managedBy: 'append-only',
  systemFields: { tenant: false },
  requiredPermissions: ['manage_platform_settings'],
  description: 'Outbound identity mail log — verification, password reset and sign-in mail about a person, not an organization',
  displayNameField: 'subject',
  nameField: 'subject', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{subject}',
  highlightFields: ['subject', 'to_addresses', 'status', 'sent_at'],

  fields: SysEmail.fields,

  indexes: [
    { fields: ['status', 'created_at'] },
    { fields: ['related_object', 'related_id'] },
    { fields: ['sent_by'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned append-only mail log, as `sys_email`: written
    // only by the mail service (SYSTEM_CTX). Reads behind the permission above.
    apiMethods: ['get', 'list'],
  },
});
