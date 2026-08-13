// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateFlowTemplatePaths,
  FLOW_TEMPLATE_UNKNOWN_FIELD,
  FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
  FLOW_TEMPLATE_FIELD_UNPROVISIONED,
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
          { id: 'start', type: 'start', config: { objectName, triggerType: 'record-after-create' } },
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
            { id: 'start', type: 'start', config: { objectName: 'sys_user', triggerType: 'record-after-create' } },
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
            { id: 'start', type: 'start', start: { objectName: 'crm_lead', triggerType: 'record-after-create' } },
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
            { id: 'start', type: 'start', config: { objectName: 'crm_lead', triggerType: 'record-after-create' } },
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
              config: { objectName: 'crm_lead', triggerType: 'record-after-create', expand: ['crm_account'] },
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
              config: { objectName: 'crm_lead', triggerType: 'record-after-create', expand: ['target_channels'] },
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

  // ── severity follows position (#3810) ───────────────────────────────────
  // Outside a filter an unresolved token blanks a value (advisory); inside a
  // filter-guarded CRUD node's filter it DELETES the condition, so the node
  // refuses to run — the build must not ship it.
  describe('filter-position severity (#3810)', () => {
    /** A record-change flow with one CRUD node carrying the given config. */
    function crudFlow(type: string, config: AnyRec): AnyRec {
      return {
        objects: [LEAD_OBJECT],
        flows: [
          {
            name: 'crud_flow',
            type: 'record_change',
            nodes: [
              { id: 'start', type: 'start', config: { objectName: 'crm_lead', triggerType: 'record-after-create' } },
              { id: 'c1', type, config },
            ],
          },
        ],
      };
    }

    it.each(['get_record', 'update_record', 'delete_record'])(
      'raises an unknown field inside a %s filter to error',
      (type) => {
        const findings = validateFlowTemplatePaths(
          crudFlow(type, { objectName: 'crm_lead', filter: { company: '{record.compnay}' } }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].rule).toBe(FLOW_TEMPLATE_UNKNOWN_FIELD);
        expect(findings[0].severity).toBe('error');
        expect(findings[0].message).toContain('refuses to run');
      },
    );

    it('raises a lookup traversal inside a filter to error', () => {
      const findings = validateFlowTemplatePaths(
        crudFlow('delete_record', { objectName: 'crm_lead', filter: { company: '{record.crm_account.name}' } }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].rule).toBe(FLOW_TEMPLATE_LOOKUP_TRAVERSAL);
      expect(findings[0].severity).toBe('error');
    });

    it('keeps a bad reference OUTSIDE the filter advisory on the same node', () => {
      const findings = validateFlowTemplatePaths(
        crudFlow('update_record', {
          objectName: 'crm_lead',
          filter: { company: '{record.company}' },
          fields: { last_name: '{record.compnay}' },
        }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warning');
    });

    it('reports a reference used in BOTH positions once, at error severity', () => {
      const findings = validateFlowTemplatePaths(
        crudFlow('update_record', {
          objectName: 'crm_lead',
          filter: { company: '{record.compnay}' },
          fields: { last_name: 'echo {record.compnay}' },
        }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
    });

    it('stays advisory for create_record, which has no filter to widen', () => {
      const findings = validateFlowTemplatePaths(
        crudFlow('create_record', { objectName: 'crm_lead', filter: { company: '{record.compnay}' } }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warning');
    });

    it('does NOT flag a valid filter reference', () => {
      const findings = validateFlowTemplatePaths(
        crudFlow('delete_record', {
          objectName: 'crm_lead',
          filter: { company: '{record.company}', owner: '{record.owner}' },
        }),
      );
      expect(findings).toHaveLength(0);
    });

    it('respects declared expand for a filter traversal (#3475)', () => {
      const findings = validateFlowTemplatePaths({
        objects: [LEAD_OBJECT],
        flows: [
          {
            name: 'expanded_filter',
            type: 'record_change',
            nodes: [
              {
                id: 'start',
                type: 'start',
                config: { objectName: 'crm_lead', triggerType: 'record-after-create', expand: ['crm_account'] },
              },
              {
                id: 'c1',
                type: 'get_record',
                config: { objectName: 'crm_lead', filter: { company: '{record.crm_account.name}' } },
              },
            ],
          },
        ],
      });
      expect(findings).toHaveLength(0);
    });
  });
  // ── nested regions (#4380) ─────────────────────────────────────────────
  //
  // This rule was not merely blind to nested nodes — it was WORSE than blind.
  // The recursive string-leaf scan already saw a nested node's tokens through
  // its container's `config`, but the `filter` split only looked at the top
  // level of the node it was handed, so a nested filter token lost its position
  // and the gating #3810 finding silently degraded to a warning reported
  // against the wrapping `try_catch`.
  describe('nested regions', () => {
    const nestedFilterFlow = (container: Record<string, unknown>) => ({
      objects: [LEAD_OBJECT],
      flows: [
        {
          name: 'guarded',
          type: 'record_change',
          nodes: [
            { id: 'start', type: 'start', config: { objectName: 'crm_lead', triggerType: 'record-after-create' } },
            { id: 'guard', type: 'try_catch', label: 'Guard', config: container },
          ],
        },
      ],
    });
    const badFilterNode = {
      id: 'fetch',
      type: 'get_record',
      label: 'Fetch',
      config: { objectName: 'crm_lead', filter: { company: '{record.budget}' } },
    };

    it('keeps the gating filter-position severity inside a region', () => {
      const findings = validateFlowTemplatePaths(
        nestedFilterFlow({ try: { nodes: [badFilterNode], edges: [] } }),
      );
      expect(findings).toHaveLength(1);
      // The whole point: `error`, not the `warning` it used to degrade to.
      expect(findings[0].severity).toBe('error');
      expect(findings[0].path).toBe('flows[0].nodes[1].config.try.nodes[0]');
      expect(findings[0].where).toBe('flow "guarded" try_catch "Guard" › try node "get_record"');
    });

    it('reports a nested token once, not also against the container', () => {
      const findings = validateFlowTemplatePaths(
        nestedFilterFlow({ catch: { nodes: [badFilterNode], edges: [] } }),
      );
      expect(findings).toHaveLength(1);
    });

    it('still checks the container node\'s own config', () => {
      const findings = validateFlowTemplatePaths({
        objects: [LEAD_OBJECT],
        flows: [
          {
            name: 'looped',
            type: 'record_change',
            nodes: [
              { id: 'start', type: 'start', config: { objectName: 'crm_lead', triggerType: 'record-after-create' } },
              {
                id: 'each',
                type: 'loop',
                label: 'Each',
                // The loop's OWN collection token is a non-filter position on
                // the container itself — warning, and not swallowed by the
                // region-stripping that prevents double reporting.
                config: { collection: '{record.budget}', body: { nodes: [], edges: [] } },
              },
            ],
          },
        ],
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].path).toBe('flows[0].nodes[1]');
    });
  });
});

describe('validateFlowTemplatePaths — unprovisioned injected anchors (#8340)', () => {
  /** The #8116 fixture shape: an ADR-0015 `external` trigger object. */
  const EXT_OBJECT = (extra: AnyRec = {}): AnyRec => ({
    name: 'ext_customer',
    external: { remoteName: 'customers' },
    fields: { email: { name: 'email', type: 'text' } },
    ...extra,
  });

  /** A record-change flow on the external object, with one node of `type`. */
  function extFlow(type: string, block: AnyRec, object: AnyRec = EXT_OBJECT()): AnyRec {
    return {
      objects: [object],
      flows: [
        {
          name: 'ext_flow',
          type: 'record_change',
          nodes: [
            { id: 'start', type: 'start', config: { objectName: 'ext_customer', triggerType: 'record-after-create' } },
            { id: 'n1', type, config: block },
          ],
        },
      ],
    };
  }
  const only = (findings: { rule: string }[]) =>
    findings.filter((f) => f.rule === FLOW_TEMPLATE_FIELD_UNPROVISIONED);

  it('warns on a filter token over an unprovisioned anchor — the existence rule stays silent', () => {
    const findings = validateFlowTemplatePaths(
      extFlow('get_record', { objectName: 'ext_customer', filter: { email: '{record.owner_id}' } }),
    );
    expect(findings.filter((f) => f.rule === FLOW_TEMPLATE_UNKNOWN_FIELD)).toHaveLength(0);
    const warned = only(findings);
    expect(warned).toHaveLength(1);
    // WARNING even in the filter position, where a typo would be an ERROR:
    // the provenance question has no closed oracle here (#8116).
    expect(warned[0].severity).toBe('warning');
    expect(warned[0].message).toContain('owner_id');
    expect(warned[0].message).toContain('external object (ADR-0015)');
    expect(warned[0].message).toContain('refuses to run');
    expect(warned[0].hint).toContain('columnMap');
  });

  it('warns outside a filter too, naming the blank-string consequence', () => {
    const findings = validateFlowTemplatePaths(
      extFlow('notify', { title: 'Owned by {record.owner_id}' }),
    );
    const warned = only(findings);
    expect(warned).toHaveLength(1);
    expect(warned[0].message).toContain('empty string on every run');
  });

  it('is silent on the local twin — platform storage is real (mutation: drop `external`)', () => {
    const findings = validateFlowTemplatePaths(
      extFlow('notify', { title: '{record.owner_id}' }, EXT_OBJECT({ external: undefined })),
    );
    expect(findings).toEqual([]);
  });

  it('is silent when the author DECLARES the column (#7859)', () => {
    const findings = validateFlowTemplatePaths(
      extFlow('notify', { title: '{record.owner_id}' }, EXT_OBJECT({
        fields: { email: { name: 'email', type: 'text' }, owner_id: { name: 'owner_id', type: 'text' } },
      })),
    );
    expect(only(findings)).toHaveLength(0);
  });

  it('is silent on a declared field of the same external object', () => {
    expect(validateFlowTemplatePaths(extFlow('notify', { title: '{record.email}' }))).toEqual([]);
  });

  it('reports one finding per node for a token repeated in two positions', () => {
    const findings = validateFlowTemplatePaths(
      extFlow('update_record', {
        objectName: 'ext_customer',
        filter: { email: '{record.owner_id}' },
        fields: { email: 'echo {record.owner_id}' },
      }),
    );
    expect(only(findings)).toHaveLength(1);
  });
});
