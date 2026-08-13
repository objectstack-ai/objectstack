// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'showcase_inquiry' };

/**
 * Inquiry views — including the PUBLIC web-to-lead form (ADR-0056 Option A).
 *
 * `formViews.contact` declares `sharing.allowAnonymous: true` + a `publicLink`
 * slug, which wires the anonymous REST endpoints automatically:
 *
 *   GET  /api/v1/forms/contact-us          → resolved form + whitelisted schema
 *   POST /api/v1/forms/contact-us/submit   → INSERT a showcase_inquiry
 *
 * The submit route DERIVES authorization from this declaration — a narrow
 * `publicFormGrant: { object: 'showcase_inquiry' }` — so it works even though
 * the showcase boots with secure-by-default auth, and WITHOUT any
 * `guest_portal` profile. Only the `sections[].fields` below are accepted on
 * submit; `status` / `source` are stamped server-side by the guest-defaults
 * hook (`hooks/index.ts`).
 */
export const InquiryViews = defineView({
  // Default list shown when the object is opened — carries `data` so the view
  // registrar can resolve the target object (without it the whole view, public
  // form included, is dropped).
  list: {
    label: 'Inquiries',
    type: 'grid',
    data,
    columns: [
      { field: 'name' },
      { field: 'email' },
      { field: 'company' },
      { field: 'status' },
    ],
  },
  listViews: {
    triage: {
      type: 'grid',
      label: 'Inquiry Triage',
      data,
      columns: [
        { field: 'name' },
        { field: 'email' },
        { field: 'company' },
        { field: 'status' },
      ],
    },
  },
  formViews: {
    // PUBLIC — anonymous web-to-lead. The whitelist below is the authoritative
    // "what the public may set"; everything else is stripped server-side.
    contact: {
      type: 'simple',
      data,
      sections: [
        {
          name: 'tell_us_about_yourself',
          label: 'Tell us about yourself',
          columns: 1,
          fields: [
            { field: 'name', required: true },
            { field: 'email', required: true },
            { field: 'company' },
            { field: 'message', required: true },
          ],
        },
      ],
      sharing: {
        enabled: true,
        allowAnonymous: true,
        publicLink: '/forms/contact-us',
      },
      submitBehavior: {
        kind: 'thank-you',
        title: 'Thanks!',
        message: 'We received your message and a specialist will reach out shortly.',
      },
    },
  },
});
