// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

/**
 * The envelopes this app sent, newest status change first: what an
 * administrator opens to see where each signature stands, as DocuSign last
 * answered it.
 */
export const DocuSignEnvelopeViews = defineView({
  list: {
    label: 'DocuSign Envelopes',
    type: 'grid',
    data: { provider: 'object', object: 'docusign_envelope' },
    columns: [
      { field: 'email_subject' },
      { field: 'signature_status' },
      { field: 'status_changed_at' },
      { field: 'envelope_id' },
    ],
    sort: [{ field: 'status_changed_at', order: 'desc' }],
  },
});
