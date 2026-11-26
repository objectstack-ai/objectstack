// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '@objectstack/spec';

/**
 * [ADR-0159] The showcase's one authored `form` item: a public feedback form
 * on `showcase_inquiry`, served at its own address (`/forms/showcase-feedback`;
 * `/forms/contact-us` is the old-shape form in `inquiry.view.ts`, and two
 * forms on one address are refused).
 *
 *   GET  /api/v1/forms/showcase-feedback          → resolved form + whitelisted schema
 *   POST /api/v1/forms/showcase-feedback/submit   → INSERT a showcase_inquiry
 *   GET  /api/v1/meta/form/showcase_inquiry.feedback
 *
 * The name is `OBJECT.KEY` and its prefix is the form's `object`; the body is
 * at the top level (no `config`, no `data`). ⛔ No action opens it: the console
 * reads forms from `view` until card ③ (#37087), so an action-opened `form`
 * item would answer not found.
 */
export const FeedbackForm = defineForm({
  name: 'showcase_inquiry.feedback',
  object: 'showcase_inquiry',
  label: 'Share feedback',
  type: 'simple',
  sections: [
    {
      name: 'feedback',
      label: 'Your feedback',
      columns: 1,
      fields: [
        { field: 'name', required: true },
        { field: 'email', required: true },
        { field: 'message', required: true },
      ],
    },
  ],
  sharing: {
    enabled: true,
    allowAnonymous: true,
    publicLink: '/forms/showcase-feedback',
  },
  submitBehavior: {
    kind: 'thank-you',
    title: 'Thank you',
    message: 'Your feedback reached the showcase team.',
  },
});
