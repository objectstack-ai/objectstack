// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateFlowTemplatePaths,
  FLOW_TEMPLATE_UNKNOWN_FIELD,
  FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
} from './validate-flow-template-paths.js';

type AnyRec = Record<string, unknown>;

/** A crm_lead object with a scalar, a formula, a lookup, and a multi-lookup. */
const LEAD_OBJECT: AnyRec = {
  name: 'crm_lead',
  fields: {
    first_name: { name: 'first_name', type: 'text' },
    last_name: { name: 'last_name', type: 'text' },
    company: { name: 'company', type: 'text' },
    full_name: { name: 'full_name', type: 'formula' },
    crm_account: { name: 'crm_account', type: 'lookup', reference_to: 'crm_account' },
    target_channels: { name: 'target_channels', type: 'lookup', reference_to: 'channel', multiple: true },
    payload: { name: 'payload', type: 'json' },
  },
};

/** Build a record-change flow with one notify node carrying the given templates. */
function flowWith(notify: AnyRec, objectName = 'crm_lead'): AnyRec {
  return {
    objects: [LEAD_OBJECT],
    flows: [
      {
        name: 'notify_lead',
        type: 'record_change',
        nodes: [
          { id: 'start', type: 'start', config: { objectName, triggerType: 'record-created' } },
          { id: 'n1', type: 'notify', notify },
        ],
      },
    ],
  };
}

describe('validateFlowTemplatePaths', () => {
  it('flags an unknown field in a {record.<x>} template (typo)', () => {
    const findings = validateFlowTemplatePaths(
      flowWith({ title: 'New lead: {record.full_naem}', body: 'x' }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_TEMPLATE_UNKNOWN_FIELD);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('full_naem');
  });

  it('flags a lookup cross-object hop {record.<lookup>.<field>}', () => {
    const findings = validateFlowTemplatePaths(
      flowWith({ title: 'From {record.crm_account.name}', body: 'x' }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_TEMPLATE_LOOKUP_TRAVERSAL);
    expect(findings[0].message).toContain('crm_account.name');
  });

  it('does NOT flag a formula field (valid, hydrated since #3445)', () => {
    const findings = validateFlowTemplatePaths(
      flowWith({ title: 'New lead: {record.full_name}', body: '{record.company}' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag a plain scalar field', () => {
    const findings = validateFlowTemplatePaths(
      flowWith({ title: '{record.first_name} {record.last_name}', body: '{record.company}' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag a bare lookup id (no sub-path)', () => {
    const findings = validateFlowTemplatePaths(
      flowWith({ title: 'acct {record.crm_account}', body: 'x' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag a numeric index into a multiple lookup (#1872)', () => {
    const findings = validateFlowTemplatePaths(
      flowWith({ title: 'ch {record.target_channels.0}', body: 'x' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag a sub-path into a json field', () => {
    const findings = validateFlowTemplatePaths(
      flowWith({ title: '{record.payload.foo}', body: 'x' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag system/audit columns', () => {
    const findings = validateFlowTemplatePaths(
      flowWith({ title: '{record.id} {record.created_at} {record.owner}', body: 'x' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('ignores non-record tokens (flow vars, NOW(), $User)', () => {
    const findings = validateFlowTemplatePaths(
      flowWith({ title: '{some_var.field} {NOW()} {$User.Email}', body: 'x' }),
    );
    expect(findings).toHaveLength(0);
  });

  it('skips a flow whose object is not defined in this stack', () => {
    const findings = validateFlowTemplatePaths({
      objects: [LEAD_OBJECT],
      flows: [
        {
          name: 'external',
          type: 'record_change',
          nodes: [
            { id: 'start', type: 'start', config: { objectName: 'sys_user', triggerType: 'record-created' } },
            { id: 'n1', type: 'notify', notify: { title: '{record.anything.deep}', body: 'x' } },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it('skips non-record-triggered flows', () => {
    const findings = validateFlowTemplatePaths({
      objects: [LEAD_OBJECT],
      flows: [
        {
          name: 'manual',
          type: 'screen',
          nodes: [
            { id: 'start', type: 'start', config: {} },
            { id: 'n1', type: 'notify', notify: { title: '{record.full_naem}', body: 'x' } },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it('dedupes a repeated bad reference to one finding per node', () => {
    const findings = validateFlowTemplatePaths(
      flowWith({ title: '{record.full_naem}', body: 'again {record.full_naem}' }),
    );
    expect(findings).toHaveLength(1);
  });

  it('resolves objectName from the typed start block too', () => {
    const findings = validateFlowTemplatePaths({
      objects: [LEAD_OBJECT],
      flows: [
        {
          name: 'typed_start',
          type: 'record_change',
          nodes: [
            { id: 'start', type: 'start', start: { objectName: 'crm_lead', triggerType: 'record-created' } },
            { id: 'n1', type: 'notify', notify: { title: '{record.crm_account.name}', body: 'x' } },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_TEMPLATE_LOOKUP_TRAVERSAL);
  });

  it('detects references in freeform config and other node types (http url)', () => {
    const findings = validateFlowTemplatePaths({
      objects: [LEAD_OBJECT],
      flows: [
        {
          name: 'webhook',
          type: 'record_change',
          nodes: [
            { id: 'start', type: 'start', config: { objectName: 'crm_lead', triggerType: 'record-created' } },
            { id: 'h1', type: 'http', http: { url: 'https://x.test/{record.full_naem}', method: 'GET' } },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_TEMPLATE_UNKNOWN_FIELD);
  });

  it('does NOT flag a lookup traversal when the start config declares expand (#3475)', () => {
    const findings = validateFlowTemplatePaths({
      objects: [LEAD_OBJECT],
      flows: [
        {
          name: 'expand_ok',
          type: 'record_change',
          nodes: [
            {
              id: 'start',
              type: 'start',
              config: { objectName: 'crm_lead', triggerType: 'record-created', expand: ['crm_account'] },
            },
            { id: 'n1', type: 'notify', notify: { title: 'From {record.crm_account.name}', body: 'x' } },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it('still flags a lookup traversal NOT covered by the declared expand (#3475)', () => {
    const findings = validateFlowTemplatePaths({
      objects: [LEAD_OBJECT],
      flows: [
        {
          name: 'expand_partial',
          type: 'record_change',
          nodes: [
            {
              id: 'start',
              type: 'start',
              config: { objectName: 'crm_lead', triggerType: 'record-created', expand: ['target_channels'] },
            },
            { id: 'n1', type: 'notify', notify: { title: 'From {record.crm_account.name}', body: 'x' } },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_TEMPLATE_LOOKUP_TRAVERSAL);
  });

  it('returns empty when there are no flows', () => {
    expect(validateFlowTemplatePaths({ objects: [LEAD_OBJECT] })).toHaveLength(0);
  });
});
