// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  CreateRecordConfigSchema,
  DeleteRecordConfigSchema,
  GetRecordConfigSchema,
  UpdateRecordConfigSchema,
} from '@objectstack/spec/automation';

import {
  validateFlowNodeWrites,
  FLOW_NODE_WRITE_UNKNOWN_FIELD,
  FLOW_WRITE_NODE_TYPES,
  FLOW_WRITE_NODE_TYPES_DEFERRED,
} from './validate-flow-node-writes.js';
import { IMPLICIT_FIELDS } from './validate-hook-body-writes.js';

// Target objects — map-shaped and array-shaped `fields`, so both authoring
// shapes are resolved by the shared index.
const dealObject = {
  name: 'deal',
  label: 'Deal',
  fields: {
    stage: { type: 'text' },
    amount: { type: 'currency' },
    notes: { type: 'text' },
  },
};

const leadObject = {
  name: 'crm_lead',
  fields: [
    { name: 'company', type: 'text' },
    { name: 'converted_account', type: 'lookup' },
  ],
};

/** A flow with one `update_record` node at nodes[1]. */
function flowWith(
  fields: unknown,
  nodeConfigOverrides: Record<string, unknown> = {},
  nodeOverrides: Record<string, unknown> = {},
) {
  return {
    name: 'close_deal',
    type: 'record_change',
    nodes: [
      { id: 'start', type: 'start', config: {} },
      {
        id: 'mark',
        type: 'update_record',
        label: 'Mark won',
        config: { objectName: 'deal', filter: { id: '{recordId}' }, fields, ...nodeConfigOverrides },
        ...nodeOverrides,
      },
    ],
    edges: [],
  };
}

describe('FLOW_WRITE_NODE_TYPES — the covered-node ledger', () => {
  // The ledger's two halves are the published answer to "which flow node types
  // have their write map checked?". Their union must BE the set of CRUD node
  // types that carry one — derived from the spec's executor-written config
  // schemas, not restated here, so a node type that grows a `fields` write map
  // later fails this test until someone classifies it.
  const CRUD_CONFIG_SCHEMAS = {
    get_record: GetRecordConfigSchema,
    create_record: CreateRecordConfigSchema,
    update_record: UpdateRecordConfigSchema,
    delete_record: DeleteRecordConfigSchema,
  } as const;

  /**
   * True when the node type's config declares `fields` as a WRITE MAP.
   * Behavioural, not structural: a `{ some_key: value }` probe survives a
   * `z.record()` and is refused by `get_record`'s `z.array(z.string())`
   * projection or stripped by `delete_record`, which declares no `fields`.
   */
  const carriesWriteMap = (schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }): boolean => {
    const parsed = schema.safeParse({ objectName: 'probe', fields: { probe_key: 1 } });
    if (!parsed.success) return false;
    const fields = (parsed.data as Record<string, unknown> | undefined)?.fields;
    return !!fields && typeof fields === 'object' && !Array.isArray(fields);
  };

  it('partitions the fields-bearing CRUD node types exactly — no phantom, no unclassified type', () => {
    const withWriteMap = Object.entries(CRUD_CONFIG_SCHEMAS)
      .filter(([, schema]) => carriesWriteMap(schema))
      .map(([type]) => type)
      .sort();
    const classified = [
      ...FLOW_WRITE_NODE_TYPES,
      ...FLOW_WRITE_NODE_TYPES_DEFERRED.map((d) => d.type),
    ].sort();
    expect(classified).toEqual(withWriteMap);
  });

  it('gives every deferral a non-empty reason', () => {
    for (const deferral of FLOW_WRITE_NODE_TYPES_DEFERRED) {
      expect(deferral.reason.length, `deferral '${deferral.type}' carries no reason`).toBeGreaterThan(0);
    }
  });

  it('leaves every deferred type unchecked — the ledger describes behaviour, not intent', () => {
    for (const deferral of FLOW_WRITE_NODE_TYPES_DEFERRED) {
      const findings = validateFlowNodeWrites({
        objects: [dealObject],
        flows: [
          {
            name: 'f',
            nodes: [{ id: 'n', type: deferral.type, config: { objectName: 'deal', fields: { stagee: 'won' } } }],
          },
        ],
      });
      expect(findings, `deferred type '${deferral.type}' is being checked`).toEqual([]);
    }
  });
});

describe('validateFlowNodeWrites', () => {
  // ── the gap this rule closes ─────────────────────────────────────────
  it('errors when an update_record node writes a field the object never declares', () => {
    const findings = validateFlowNodeWrites({
      objects: [dealObject],
      flows: [flowWith({ stagee: 'won' })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(FLOW_NODE_WRITE_UNKNOWN_FIELD);
    expect(findings[0].path).toBe('flows[0].nodes[1].config.fields.stagee');
    expect(findings[0].where).toBe('flow "close_deal" › node "Mark won"');
    expect(findings[0].message).toContain('stagee');
    expect(findings[0].message).toContain("object 'deal'");
    // Did-you-mean off the object's declared fields.
    expect(findings[0].hint).toMatch(/Did you mean (one of: )?'stage'/);
  });

  it('flags every unknown key in one node, and only those', () => {
    const findings = validateFlowNodeWrites({
      objects: [dealObject],
      flows: [flowWith({ stage: 'won', stagee: 'won', amountt: 1, notes: 'ok' })],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'flows[0].nodes[1].config.fields.stagee',
      'flows[0].nodes[1].config.fields.amountt',
    ]);
  });

  it('resolves array-shaped object.fields', () => {
    const findings = validateFlowNodeWrites({
      objects: [leadObject],
      flows: [flowWith({ comapny: 'ACME' }, { objectName: 'crm_lead' })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].hint).toMatch(/Did you mean (one of: )?'company'/);
  });

  it('resolves the target object via the `object` alias (pre-conversion source)', () => {
    const findings = validateFlowNodeWrites({
      objects: [dealObject],
      flows: [flowWith({ stagee: 'won' }, { objectName: undefined, object: 'deal' })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_NODE_WRITE_UNKNOWN_FIELD);
  });

  it('checks a runAs:system flow too — no run identity conjures a column', () => {
    const flow = { ...flowWith({ stagee: 'won' }), runAs: 'system' };
    const findings = validateFlowNodeWrites({ objects: [dealObject], flows: [flow] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('checks flows given as a name-keyed map, not only an array', () => {
    const findings = validateFlowNodeWrites({
      objects: [dealObject],
      flows: {
        close_deal: {
          nodes: [{ id: 'mark', type: 'update_record', config: { objectName: 'deal', fields: { stagee: 'x' } } }],
        },
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('flow "close_deal" › node "mark"');
  });

  // ── clean: writes that resolve ───────────────────────────────────────
  it('does NOT flag declared fields', () => {
    const findings = validateFlowNodeWrites({
      objects: [dealObject],
      flows: [flowWith({ stage: 'won', amount: 100, notes: 'x' })],
    });
    expect(findings).toEqual([]);
  });

  it('does NOT flag implicitly-writable system columns', () => {
    // The same set the hook and action rules exempt — the three surfaces agree
    // on what is writable without being authored in `fields`.
    const fields = Object.fromEntries([...IMPLICIT_FIELDS].map((f) => [f, 'x']));
    const findings = validateFlowNodeWrites({ objects: [dealObject], flows: [flowWith(fields)] });
    expect(findings).toEqual([]);
  });

  // ── silent bails: nothing statically knowable ────────────────────────
  it('skips a templated objectName (target resolved at run time)', () => {
    const findings = validateFlowNodeWrites({
      objects: [dealObject],
      flows: [flowWith({ stagee: 'won' }, { objectName: '{targetObject}' })],
    });
    expect(findings).toEqual([]);
  });

  it('skips a non-literal fields map', () => {
    expect(validateFlowNodeWrites({ objects: [dealObject], flows: [flowWith('{allFields}')] })).toEqual([]);
    expect(validateFlowNodeWrites({ objects: [dealObject], flows: [flowWith([{ stagee: 1 }])] })).toEqual([]);
    expect(validateFlowNodeWrites({ objects: [dealObject], flows: [flowWith(undefined)] })).toEqual([]);
    expect(validateFlowNodeWrites({ objects: [dealObject], flows: [flowWith({})] })).toEqual([]);
  });

  it('skips an object this stack does not define (another package)', () => {
    const findings = validateFlowNodeWrites({ objects: [], flows: [flowWith({ stagee: 'won' })] });
    expect(findings).toEqual([]);
  });

  it('skips an object that declares no fields (external / introspected schema)', () => {
    const findings = validateFlowNodeWrites({
      objects: [{ name: 'deal', label: 'Deal', external: true }],
      flows: [flowWith({ stagee: 'won' })],
    });
    expect(findings).toEqual([]);
  });

  it('skips a dotted key (a nested-path write, not a top-level column)', () => {
    const findings = validateFlowNodeWrites({
      objects: [dealObject],
      flows: [flowWith({ 'address.city': 'Beijing' })],
    });
    expect(findings).toEqual([]);
  });

  it('skips a node with no config at all', () => {
    const flow = { name: 'f', nodes: [{ id: 'n', type: 'update_record' }] };
    expect(validateFlowNodeWrites({ objects: [dealObject], flows: [flow] })).toEqual([]);
  });

  // ── shape robustness ─────────────────────────────────────────────────
  it('returns [] for a stack with no flows', () => {
    expect(validateFlowNodeWrites({ objects: [dealObject] })).toEqual([]);
    expect(validateFlowNodeWrites({})).toEqual([]);
  });

  it('falls back to node id, then index, for the location label', () => {
    const byId = {
      name: 'f',
      nodes: [{ id: 'my_node', type: 'update_record', config: { objectName: 'deal', fields: { stagee: 'x' } } }],
    };
    expect(validateFlowNodeWrites({ objects: [dealObject], flows: [byId] })[0].where).toBe(
      'flow "f" › node "my_node"',
    );

    const byIndex = {
      nodes: [{ type: 'update_record', config: { objectName: 'deal', fields: { stagee: 'x' } } }],
    };
    expect(validateFlowNodeWrites({ objects: [dealObject], flows: [byIndex] })[0].where).toBe(
      'flow "#0" › node "#0"',
    );
  });

  // ── the family boundary ──────────────────────────────────────────────
  it('does not duplicate the readonly rule: a declared readonly field is that rule’s business, not this one', () => {
    const withReadonly = {
      name: 'deal',
      fields: { stage: { type: 'text' }, approval_status: { type: 'text', readonly: true } },
    };
    const findings = validateFlowNodeWrites({
      objects: [withReadonly],
      flows: [flowWith({ approval_status: 'approved' })],
    });
    expect(findings).toEqual([]);
  });
});
