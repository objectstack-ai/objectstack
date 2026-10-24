// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The author-time half of the `notify` email-field recipient (ruling
// 6377731715 on #25496, letter B): `{ emailField }` must name an `email`-typed
// field of the record that triggered the flow. Each verdict is pinned by rule
// id, severity, path and the first clause of its message; the clean case and
// the unjudgeable skips are pinned beside them.

import { describe, expect, it } from 'vitest';

import {
  validateNotifyEmailFieldRecipients,
  NOTIFY_EMAIL_FIELD_UNKNOWN,
  NOTIFY_EMAIL_FIELD_NOT_EMAIL,
  NOTIFY_EMAIL_FIELD_NO_TRIGGER_RECORD,
} from './validate-notify-email-field-recipients.js';
import { validateReferenceIntegrity } from './reference-integrity-suite.js';

const application = {
  name: 'supplier_application',
  fields: {
    company: { type: 'text', label: 'Company' },
    contact_email: { type: 'email', label: 'Contact email' },
    billing_email: { type: 'email', label: 'Billing email' },
    website: { type: 'url', label: 'Website' },
  },
};

const notify = (emailField: string, id = 'tell_applicant') => ({
  id,
  type: 'notify',
  label: 'Tell the applicant',
  config: { title: 'Your application was received', channels: 'email', recipients: { emailField } },
});

const recordFlow = (...nodes: object[]) => ({
  name: 'application_received',
  type: 'record_change',
  nodes: [
    { id: 'start', type: 'start', config: { objectName: 'supplier_application', triggerType: 'record-after-create' } },
    ...nodes,
  ],
});

describe('validateNotifyEmailFieldRecipients', () => {
  it('passes an `email`-typed field of the trigger object', () => {
    expect(validateNotifyEmailFieldRecipients({ objects: [application], flows: [recordFlow(notify('contact_email'))] })).toEqual([]);
  });

  it('passes an `email`-typed field of a time-relative sweep\'s object', () => {
    const flow = {
      name: 'application_reminder',
      nodes: [
        { id: 'start', type: 'start', config: { timeRelative: { object: 'supplier_application', field: 'created_at', offset: '7d' } } },
        notify('billing_email'),
      ],
    };
    expect(validateNotifyEmailFieldRecipients({ objects: [application], flows: [flow] })).toEqual([]);
  });

  it('refuses a field the trigger object does not declare', () => {
    const [finding, ...rest] = validateNotifyEmailFieldRecipients({ objects: [application], flows: [recordFlow(notify('contact_emial'))] });
    expect(rest).toEqual([]);
    expect(finding.rule).toBe(NOTIFY_EMAIL_FIELD_UNKNOWN);
    expect(finding.severity).toBe('error');
    expect(finding.path).toBe('flows[0].nodes[1].config.recipients.emailField');
    expect(finding.where).toBe('flow "application_received" › node "Tell the applicant"');
    expect(finding.message).toMatch(/^notify recipient `\{ emailField: 'contact_emial' \}` names a field of the record that triggered the flow, and object 'supplier_application' declares no field 'contact_emial'/);
    expect(finding.hint).toContain('contact_email');
  });

  it('refuses a declared field that is not `email`-typed', () => {
    const [finding, ...rest] = validateNotifyEmailFieldRecipients({ objects: [application], flows: [recordFlow(notify('website'))] });
    expect(rest).toEqual([]);
    expect(finding.rule).toBe(NOTIFY_EMAIL_FIELD_NOT_EMAIL);
    expect(finding.severity).toBe('error');
    expect(finding.path).toBe('flows[0].nodes[1].config.recipients.emailField');
    expect(finding.message).toContain("'supplier_application.website' is typed 'url', not `email`");
    expect(finding.hint).toBe("Name one of its `email` fields ('contact_email', 'billing_email').");
  });

  it.each([
    ['a schedule flow', { name: 'nightly', type: 'schedule', nodes: [{ id: 'start', type: 'start', config: { schedule: '0 2 * * *' } }] }, 'it runs on a schedule'],
    ['an api flow', { name: 'inbound', type: 'api', nodes: [{ id: 'start', type: 'start', config: {} }] }, 'it is triggered by an inbound api call'],
    ['a record trigger with no object', { name: 'any_write', nodes: [{ id: 'start', type: 'start', config: { triggerType: 'record-after-update' } }] }, 'its record trigger names no object'],
    ['a flow with no trigger', { name: 'manual', nodes: [{ id: 'start', type: 'start', config: {} }] }, 'it has no record trigger'],
  ])('refuses the form in %s — no triggering record of a known object', (_label, flow, reason) => {
    const withNode = { ...flow, nodes: [...flow.nodes, notify('contact_email')] };
    const [finding, ...rest] = validateNotifyEmailFieldRecipients({ objects: [application], flows: [withNode] });
    expect(rest).toEqual([]);
    expect(finding.rule).toBe(NOTIFY_EMAIL_FIELD_NO_TRIGGER_RECORD);
    expect(finding.severity).toBe('error');
    expect(finding.message).toContain(`this flow has no triggering record of a known object: ${reason}`);
  });

  it('judges a notify node nested in a region, at its own path', () => {
    const flow = recordFlow({
      id: 'guard',
      type: 'try_catch',
      label: 'Guard',
      config: { try: { nodes: [notify('website', 'inner')] }, catch: { nodes: [] } },
    });
    const findings = validateNotifyEmailFieldRecipients({ objects: [application], flows: [flow] });
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      [NOTIFY_EMAIL_FIELD_NOT_EMAIL, 'flows[0].nodes[1].config.try.nodes[0].config.recipients.emailField'],
    ]);
  });

  it('skips a trigger object this stack does not declare, and every other recipient form', () => {
    const elsewhere = { ...recordFlow(notify('contact_email')), nodes: [{ id: 'start', type: 'start', config: { objectName: 'crm_lead', triggerType: 'record-after-create' } }, notify('nope')] };
    expect(validateNotifyEmailFieldRecipients({ objects: [application], flows: [elsewhere] })).toEqual([]);
    const others = recordFlow(
      { id: 'a', type: 'notify', config: { title: 't', recipients: 'website' } },
      { id: 'b', type: 'notify', config: { title: 't', recipients: { dialect: 'cel', source: 'record.website' } } },
    );
    expect(validateNotifyEmailFieldRecipients({ objects: [application], flows: [others] })).toEqual([]);
  });

  it('runs at the runtime publish door for a flow write', () => {
    const findings = validateReferenceIntegrity(
      { objects: [application], flows: [recordFlow(notify('website'))] },
      { runtimeWriteType: 'flow' },
    );
    expect(findings.filter((f) => f.rule.startsWith('notify-email-field')).map((f) => f.rule)).toEqual([NOTIFY_EMAIL_FIELD_NOT_EMAIL]);
  });
});
