// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineFlow } from '@objectstack/spec';

/**
 * Send one document out for signature and record the envelope. Run it with
 * `POST /api/v1/automation/docusign_send_envelope/trigger` and a body of
 * `{ "params": { "account_id": "…", "email_subject": "…", "document_name":
 * "contract.pdf", "document_base64": "…", "signer_name": "…", "signer_email":
 * "…" } }`.
 *
 * The envelope is created with `status: "sent"`, so DocuSign emails the
 * signer at once. DocuSign's answer (`envelopeId`, `status`,
 * `statusDateTime`) is the run's `send.body` output; when DocuSign accepted
 * it, a `docusign_envelope` record keeps the envelope id and its status.
 * When DocuSign refused it, the step does not fail: the answer lands as
 * `send.status`, `send.ok` false and DocuSign's error in `send.body`, and no
 * record is written.
 *
 * An `openapi` action takes its path parameters as one `path` object and its
 * request body as one `body` value, each a single CEL value envelope. A CEL
 * map's values share one type, so every literal beside a variable read is
 * wrapped in `dyn(…)`, at every level.
 */
export const DocuSignSendEnvelopeFlow = defineFlow({
  name: 'docusign_send_envelope',
  label: 'DocuSign: send envelope',
  description: 'Sends one document to one signer through the docusign connector and records the envelope.',
  type: 'autolaunched',
  status: 'active',
  variables: [
    { name: 'account_id', type: 'text', isInput: true },
    { name: 'email_subject', type: 'text', isInput: true },
    { name: 'document_name', type: 'text', isInput: true },
    { name: 'document_base64', type: 'text', isInput: true },
    { name: 'signer_name', type: 'text', isInput: true },
    { name: 'signer_email', type: 'text', isInput: true },
    { name: 'send.body', type: 'json', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'send',
      type: 'connector_action',
      label: 'Envelopes_PostEnvelopes',
      connectorConfig: {
        connectorId: 'docusign',
        actionId: 'Envelopes_PostEnvelopes',
        input: {
          path: { dialect: 'cel', source: '{"accountId": account_id}' },
          body: {
            dialect: 'cel',
            source:
              '{"emailSubject": email_subject, "status": dyn("sent"), ' +
              '"documents": dyn([{"documentId": dyn("1"), "name": document_name, "documentBase64": document_base64}]), ' +
              '"recipients": dyn({"signers": [{"recipientId": dyn("1"), "routingOrder": dyn("1"), "name": signer_name, "email": signer_email}]})}',
          },
        },
      },
    },
    { id: 'accepted', type: 'decision', label: 'Did DocuSign accept it?' },
    {
      id: 'record',
      type: 'create_record',
      label: 'Record the envelope',
      config: {
        objectName: 'docusign_envelope',
        fields: {
          envelope_id: { dialect: 'cel', source: 'send.body.envelopeId' },
          signature_status: { dialect: 'cel', source: 'has(send.body.status) ? send.body.status : null' },
          email_subject: { dialect: 'cel', source: 'email_subject' },
          status_changed_at: { dialect: 'cel', source: 'has(send.body.statusDateTime) ? send.body.statusDateTime : null' },
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'send' },
    { id: 'e2', source: 'send', target: 'accepted' },
    { id: 'e3', source: 'accepted', target: 'record', label: 'accepted', condition: 'send.ok && has(send.body.envelopeId)' },
    { id: 'e4', source: 'accepted', target: 'end', label: 'refused', isDefault: true },
    { id: 'e5', source: 'record', target: 'end' },
  ],
});

/**
 * Read one envelope and refresh its record. Run it with
 * `POST /api/v1/automation/docusign_get_envelope/trigger` and a body of
 * `{ "params": { "account_id": "…", "envelope_id": "…" } }`; DocuSign's
 * envelope is the run's `envelope.body` output. When DocuSign answered it,
 * every `docusign_envelope` record with that `envelope_id` takes DocuSign's
 * `status` and `statusChangedDateTime` (none, when the envelope was not sent
 * by this app: the update matches no record and writes nothing).
 */
export const DocuSignGetEnvelopeFlow = defineFlow({
  name: 'docusign_get_envelope',
  label: 'DocuSign: get envelope',
  description: "Reads one DocuSign envelope through the docusign connector and refreshes its record's signature status.",
  type: 'autolaunched',
  status: 'active',
  variables: [
    { name: 'account_id', type: 'text', isInput: true },
    { name: 'envelope_id', type: 'text', isInput: true },
    { name: 'envelope.body', type: 'json', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'envelope',
      type: 'connector_action',
      label: 'Envelopes_GetEnvelope',
      connectorConfig: {
        connectorId: 'docusign',
        actionId: 'Envelopes_GetEnvelope',
        input: { path: { dialect: 'cel', source: '{"accountId": account_id, "envelopeId": envelope_id}' } },
      },
    },
    { id: 'answered', type: 'decision', label: 'Did DocuSign answer it?' },
    {
      id: 'refresh',
      type: 'update_record',
      label: 'Refresh the signature status',
      config: {
        objectName: 'docusign_envelope',
        filter: { envelope_id: { dialect: 'cel', source: 'envelope_id' } },
        fields: {
          signature_status: { dialect: 'cel', source: 'envelope.body.status' },
          status_changed_at: {
            dialect: 'cel',
            source: 'has(envelope.body.statusChangedDateTime) ? envelope.body.statusChangedDateTime : null',
          },
        },
        // The filter names the envelope, not the record id: a predicate update.
        multi: true,
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'envelope' },
    { id: 'e2', source: 'envelope', target: 'answered' },
    { id: 'e3', source: 'answered', target: 'refresh', label: 'answered', condition: 'envelope.ok && has(envelope.body.status)' },
    { id: 'e4', source: 'answered', target: 'end', label: 'refused', isDefault: true },
    { id: 'e5', source: 'refresh', target: 'end' },
  ],
});

/**
 * Reflect DocuSign's status changes on the envelope records — the poll that
 * stands in for a callback. DocuSign Connect signs its posts with its own
 * header, which the `api` flow door does not verify, so this app does not
 * take Connect posts; run this flow on a schedule instead. Run it with
 * `POST /api/v1/automation/docusign_poll_status_changes/trigger` and a body of
 * `{ "params": { "account_id": "…", "from_date": "2026-11-01T00:00:00Z" } }`.
 *
 * It lists the account's envelopes whose status changed since `from_date`
 * (at most 100), returns DocuSign's list as `changes.body`, and gives every
 * `docusign_envelope` record named in it DocuSign's status. An envelope this
 * app did not send matches no record and writes nothing. Each update is
 * contained: one refused write does not end the sweep.
 */
export const DocuSignPollStatusChangesFlow = defineFlow({
  name: 'docusign_poll_status_changes',
  label: 'DocuSign: poll status changes',
  description: 'Lists DocuSign envelope status changes since a date and copies each status onto its envelope record.',
  type: 'autolaunched',
  status: 'active',
  variables: [
    { name: 'account_id', type: 'text', isInput: true },
    { name: 'from_date', type: 'text', isInput: true },
    { name: 'changes.body', type: 'json', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'changes',
      type: 'connector_action',
      label: 'Envelopes_GetEnvelopes',
      connectorConfig: {
        connectorId: 'docusign',
        actionId: 'Envelopes_GetEnvelopes',
        input: {
          path: { dialect: 'cel', source: '{"accountId": account_id}' },
          query: { dialect: 'cel', source: '{"from_date": from_date, "count": dyn("100")}' },
        },
      },
    },
    { id: 'listed', type: 'decision', label: 'Did DocuSign answer it?' },
    {
      // The node's ordinary out-edge is the after-loop continuation; the
      // per-envelope step is `config.body`.
      id: 'each_change',
      type: 'loop',
      label: 'For each changed envelope',
      config: {
        // DocuSign leaves `envelopes` out of a list with no entries.
        collection: { dialect: 'cel', source: 'has(changes.body.envelopes) ? changes.body.envelopes : []' },
        iteratorVariable: 'changed',
        // The list asks for at most 100, so this is the same bound on the side
        // that iterates: a longer collection fails the node rather than
        // truncating in silence.
        maxIterations: 100,
        body: {
          nodes: [
            {
              // Per-iteration containment: a loop body has no error handling of
              // its own, so one refused update would otherwise end the sweep.
              id: 'guard_update',
              type: 'try_catch',
              label: 'Guarded update',
              config: {
                try: {
                  nodes: [
                    {
                      id: 'apply_status',
                      type: 'update_record',
                      label: 'Apply the status',
                      config: {
                        objectName: 'docusign_envelope',
                        filter: { envelope_id: { dialect: 'cel', source: 'changed.envelopeId' } },
                        fields: {
                          signature_status: { dialect: 'cel', source: 'changed.status' },
                          status_changed_at: {
                            dialect: 'cel',
                            source: 'has(changed.statusChangedDateTime) ? changed.statusChangedDateTime : null',
                          },
                        },
                        multi: true,
                      },
                    },
                  ],
                },
                catch: {
                  nodes: [{ id: 'update_failed', type: 'assignment', label: 'Update failed (contained)' }],
                },
              },
            },
          ],
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'changes' },
    { id: 'e2', source: 'changes', target: 'listed' },
    { id: 'e3', source: 'listed', target: 'each_change', label: 'answered', condition: 'changes.ok' },
    { id: 'e4', source: 'listed', target: 'end', label: 'refused', isDefault: true },
    { id: 'e5', source: 'each_change', target: 'end' },
  ],
});

export const allFlows = [DocuSignSendEnvelopeFlow, DocuSignGetEnvelopeFlow, DocuSignPollStatusChangesFlow];
