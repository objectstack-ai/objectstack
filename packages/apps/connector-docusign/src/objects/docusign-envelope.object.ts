// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * One envelope this app sent, and the signature status last read from
 * DocuSign. The two fields a contract record needs to follow its signature
 * are `envelope_id` (DocuSign's envelope GUID) and `signature_status`
 * (DocuSign's own status word: `sent`, `delivered`, `completed`, `declined`,
 * `voided`, …).
 *
 * The status is DocuSign's, mirrored: `docusign_send_envelope` writes it when
 * the envelope is created, and `docusign_get_envelope` /
 * `docusign_poll_status_changes` overwrite it with what DocuSign answers. It is
 * a text field, not a select, because DocuSign's status vocabulary is
 * DocuSign's to grow; a word this object refused would fail the poll that read
 * it. Nothing here is the system of record — DocuSign is — so the object is
 * shared across the organization and any flow run may refresh it.
 */
export const DocuSignEnvelope = ObjectSchema.create({
  name: 'docusign_envelope',
  label: 'DocuSign Envelope',
  pluralLabel: 'DocuSign Envelopes',
  icon: 'file-signature',
  description: 'An envelope sent for signature through DocuSign, with the signature status last read from DocuSign.',
  // Org-shared on purpose: the record mirrors DocuSign's state, and the flows
  // that refresh it run for whoever polls.
  sharingModel: 'public_read_write',

  fields: {
    envelope_id: Field.text({
      label: 'Envelope ID',
      description: "DocuSign's envelope GUID, as `Envelopes_PostEnvelopes` answered it.",
      required: true,
      searchable: true,
      maxLength: 64,
    }),
    signature_status: Field.text({
      label: 'Signature Status',
      description: "DocuSign's envelope status word (`sent`, `delivered`, `completed`, `declined`, `voided`, …), as last read.",
      maxLength: 32,
    }),
    email_subject: Field.text({
      label: 'Email Subject',
      description: 'The subject line DocuSign sent the envelope under.',
      maxLength: 255,
    }),
    status_changed_at: Field.text({
      label: 'Status Changed At',
      description: "DocuSign's `statusChangedDateTime` for the status above, verbatim (an ISO 8601 instant).",
      maxLength: 40,
    }),
  },
});
