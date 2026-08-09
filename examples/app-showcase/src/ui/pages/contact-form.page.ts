// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Contact Form — a pure-SDUI DATA-ENTRY page (the data-entry half of SDUI pages).
 *
 * Demonstrates the SDUI form loop end to end, with NO custom code:
 *   1. `variables` declares one page variable per field, each fed by a text
 *      input (PageVariableSchema.source = that input's component id).
 *   2. `element:text_input` writes each keystroke into its bound variable
 *      (objectui components/src/renderers/basic/text-input.tsx).
 *   3. The submit `element:button` runs an `api` action whose `bodyExtra`
 *      references the variables as `{{page.<var>}}`. The console action runtime
 *      resolves those tokens against the live page-variable snapshot (published
 *      by PageVariableActionBridge) and POSTs the body to the public
 *      web-to-lead endpoint, creating a `showcase_inquiry`.
 *
 *   POST /api/v1/forms/contact-us/submit   (ADR-0056 public form -> showcase_inquiry)
 *
 * This is the showcase analog of a branded cloud onboarding screen — collect a
 * few free-text fields, post them to a backend endpoint — but rendered by the
 * console design system (dark mode, i18n) instead of hand-rolled vanilla HTML.
 */
export const ContactFormPage = definePage({
  name: 'showcase_contact_form',
  label: 'Contact Form (SDUI data entry)',
  icon: 'mail-plus',
  type: 'app',
  template: 'header-sidebar-main',
  isDefault: false,
  // One page variable per field, each written by the text input whose `id`
  // matches `source`. Read back at submit time as `{{page.<name>}}`.
  variables: [
    { name: 'inquiryName', type: 'string', source: 'field_name' },
    { name: 'inquiryEmail', type: 'string', source: 'field_email' },
    { name: 'inquiryCompany', type: 'string', source: 'field_company' },
    { name: 'inquiryMessage', type: 'string', source: 'field_message' },
  ],
  regions: [
    {
      name: 'header',
      width: 'full',
      components: [
        {
          type: 'page:header',
          properties: {
            title: 'Get in touch',
            subtitle:
              'A pure-SDUI form — each text input writes a page variable; Submit posts them as one request. No custom code.',
          },
        },
      ],
    },
    {
      name: 'main',
      width: 'large',
      components: [
        {
          type: 'element:text',
          properties: {
            content:
              'Tell us about yourself and we’ll reach out. Each field writes a `page.<var>`; the Submit button reads them back as `{{page.<var>}}` and posts them to the web-to-lead endpoint.',
            variant: 'body',
          },
        },
        {
          type: 'element:text_input',
          id: 'field_name',
          properties: { label: 'Name', placeholder: 'Ada Lovelace', required: true },
        },
        {
          type: 'element:text_input',
          id: 'field_email',
          properties: {
            label: 'Email',
            inputType: 'email',
            placeholder: 'ada@example.com',
            required: true,
          },
        },
        {
          type: 'element:text_input',
          id: 'field_company',
          properties: { label: 'Company', placeholder: 'Analytical Engines Ltd.' },
        },
        {
          type: 'element:text_input',
          id: 'field_message',
          properties: { label: 'Message', placeholder: 'What can we help with?', required: true },
        },
        // Live page-variable feedback — appears the instant an email is typed,
        // proving the input wrote `page.inquiryEmail` (re-evaluated, no reload).
        {
          type: 'element:text',
          id: 'ready_hint',
          visibleWhen: "page.inquiryEmail != ''",
          properties: {
            content: '✓ Looks good — hit Submit to send your inquiry.',
            variant: 'caption',
          },
        },
        { type: 'element:divider' },
        {
          type: 'element:button',
          id: 'submit_inquiry',
          properties: {
            label: 'Submit inquiry',
            variant: 'primary',
            icon: 'send',
            // `api` action -> absolute endpoint. The runtime resolves the
            // `{{page.<var>}}` tokens against the live snapshot before POSTing.
            //
            // The payload goes in `bodyExtra`, NOT `params` (#5777, maintainer
            // ruling 2026-08-06 direction A). `params` is the ActionParam[]
            // DEFINITION array — the dialog fields collected from the user
            // before the action runs — and this form collects nothing that way:
            // its inputs write page variables, and submit sends them. The two
            // are different concepts, so they get different keys instead of one
            // key discriminated by `Array.isArray`.
            action: {
              type: 'api',
              target: '/api/v1/forms/contact-us/submit',
              method: 'POST',
              bodyExtra: {
                name: '{{page.inquiryName}}',
                email: '{{page.inquiryEmail}}',
                company: '{{page.inquiryCompany}}',
                message: '{{page.inquiryMessage}}',
              },
              successMessage: 'Thanks! We received your inquiry.',
              refreshAfter: false,
            },
          },
        },
      ],
    },
  ],
});
