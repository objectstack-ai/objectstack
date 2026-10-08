// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * EmailTemplate — canonical FormView layout.
 *
 * Bound to `EmailTemplateDefinitionSchema` (the canonical `email_template`
 * metadata type). Bodies are rendered with the `code` widget so admins
 * get syntax highlighting for the HTML body; the plain-text body uses
 * a textarea since it is rarely styled.
 */
export const emailTemplateForm = defineForm({
  schemaId: 'email_template',
  type: 'simple',
  sections: [
    {
      label: 'Identity',
      // Delivery resolves a template through
      // `IEmailService.sendTemplate({ template: name, locale, ... })`. This
      // description is form help in Studio, so it says what that means for
      // the author and leaves the interface name here (#22093).
      description: 'Senders address this template by its name; the locale selects which language version of it is sent.',
      columns: 2,
      fields: [
        { field: 'name', required: true, colSpan: 1, helpText: 'Dotted snake_case (e.g. auth.password_reset, crm.welcome)' },
        { field: 'label', required: true, colSpan: 1 },
        { field: 'category', type: 'select', colSpan: 1, options: [
          { label: 'Auth', value: 'auth' },
          { label: 'Notification', value: 'notification' },
          { label: 'Workflow', value: 'workflow' },
          { label: 'Marketing', value: 'marketing' },
          { label: 'Custom', value: 'custom' },
        ]},
        { field: 'locale', colSpan: 1, helpText: 'BCP-47 tag — e.g. en-US, zh-CN' },
        { field: 'description', widget: 'textarea', colSpan: 2 },
      ],
    },
    {
      label: 'Subject',
      description: 'Subject line. Supports {{var.path}} interpolation.',
      columns: 1,
      fields: [
        { field: 'subject', required: true, widget: 'textarea' },
      ],
    },
    {
      label: 'HTML body',
      description: 'Rich HTML body. Most clients strip <head>, so use inline styles.',
      columns: 1,
      fields: [
        { field: 'bodyHtml', required: true, type: 'code', language: 'html' },
      ],
    },
    {
      label: 'Plain-text body',
      description: 'Optional plain-text alternative. When omitted, the service strips tags from the HTML body to derive one. Providing one improves spam scoring.',
      columns: 1,
      fields: [
        { field: 'bodyText', widget: 'textarea' },
      ],
    },
    {
      label: 'Variables',
      description: 'Declared variables. Rendered as hints in Studio and validated by sendTemplate() when required.',
      columns: 1,
      fields: [
        { field: 'variables', widget: 'json', helpText: '[{ "name": "user.name", "type": "string", "required": true, "description": "..." }]' },
      ],
    },
    {
      label: 'Delivery overrides',
      description: 'Optional per-template overrides for From / Reply-To.',
      columns: 2,
      fields: [
        { field: 'fromOverride', widget: 'json', colSpan: 2, helpText: '{ "name": "Acme Sales", "address": "sales@acme.com" }' },
        { field: 'replyTo', colSpan: 2, helpText: 'Reply-To email address' },
      ],
    },
    {
      label: 'Status',
      columns: 2,
      fields: [
        { field: 'active', type: 'boolean', colSpan: 1, helpText: 'When unchecked, sendTemplate() returns TEMPLATE_INACTIVE.' },
        { field: 'isSystem', type: 'boolean', colSpan: 1, helpText: 'Built-in template; tenants may override but should not delete.' },
      ],
    },
  ],
});
