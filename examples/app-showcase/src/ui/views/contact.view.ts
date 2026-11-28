// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'showcase_contact' };

/**
 * Contact views: the list. There is no form here on purpose.
 *
 * The create and edit forms lay a contact out by the object's `fieldGroups`
 * (data/objects/contact.object.ts): four sections, Contact, Work, Status and
 * Notes. The create form leaves out every field marked `showOnCreate: false`,
 * so it asks only for name, email, phone and company. A hand-written default
 * `form` or `formViews.create` would not be loaded by either surface
 * (lint: form-view-internal-not-loaded).
 *
 * Scenario guide: content/docs/ui/create-vs-edit-form.mdx
 * Decision record: ADR-0047 (object UI run modes).
 */
export const ContactViews = defineView({
  // Default list — carries `data` so the view registrar can resolve the object.
  list: {
    label: 'Contacts',
    type: 'grid',
    data,
    columns: [
      { field: 'name' },
      { field: 'email' },
      { field: 'company' },
      { field: 'stage' },
    ],
    // The Add button opens the object's create form: its fieldGroups, less
    // every `showOnCreate: false` field. Nothing here names a form.
    addRecord: { enabled: true },
  },
});
