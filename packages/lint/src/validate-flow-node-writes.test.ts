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
  FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR,
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

  // Every write-map node type is covered as of #4371, so the deferred list is
  // empty and the two tests below are vacuous TODAY. Both are kept live because
  // they are what makes a FUTURE deferral honest: the partition test above
  // forces a new node type into one list or the other, and these decide what
  // the uncovered list is allowed to mean.
  it('every covered type actually reports — the ledger describes behaviour, not intent', () => {
    for (const type of FLOW_WRITE_NODE_TYPES) {
      const findings = validateFlowNodeWrites({
        objects: [dealObject],
        flows: [
          {
            name: 'f',
            nodes: [{ id: 'n', type, config: { objectName: 'deal', fields: { stagee: 'won' } } }],
          },
        ],
      });
      expect(findings.map((f) => f.rule), `covered type '${type}' reports nothing`).toEqual([
        FLOW_NODE_WRITE_UNKNOWN_FIELD,
      ]);
      expect(findings[0].severity).toBe('error');
    }
  });

  it('gives every deferral a non-empty reason', () => {
    for (const deferral of FLOW_WRITE_NODE_TYPES_DEFERRED) {
      expect(deferral.reason.length, `deferral '${deferral.type}' carries no reason`).toBeGreaterThan(0);
    }
  });

  it('leaves every deferred type unchecked', () => {
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

  // A node type NOT in the ledger at all must stay silent — the guard that the
  // covered set is an allowlist rather than "anything with a fields key".
  it('ignores a fields-bearing node type outside the ledger', () => {
    const findings = validateFlowNodeWrites({
      objects: [dealObject],
      flows: [
        {
          name: 'f',
          nodes: [
            // `screen` carries `defaults`/`fields`, but an object-form screen
            // forwards them to the client renderer — an unknown key there is an
            // ignored prefill, not a write that reaches storage.
            { id: 'n', type: 'screen', config: { objectName: 'deal', fields: { stagee: 'won' } } },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
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

  // ── create_record — the same map on the INSERT surface (#4371) ───────
  it('errors when a create_record node writes a field the object never declares', () => {
    const flow = {
      name: 'seed_deal',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        {
          id: 'seed',
          type: 'create_record',
          label: 'Seed deal',
          config: { objectName: 'deal', fields: { name: 'ACME', stagee: 'won' }, outputVariable: 'created' },
        },
      ],
    };
    const findings = validateFlowNodeWrites({ objects: [dealObject], flows: [flow] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('flows[0].nodes[1].config.fields.stagee');
    expect(findings[0].where).toBe('flow "seed_deal" › node "Seed deal"');
    // The INSERT consequence is strictly worse than the UPDATE one and the
    // message says so: the row never exists, so `{created.id}` downstream is
    // reading from a record that was never written.
    expect(findings[0].message).toContain('the record is never created at all');
  });

  it('names only the UPDATE consequence for an update_record node', () => {
    const findings = validateFlowNodeWrites({
      objects: [dealObject],
      flows: [flowWith({ stagee: 'won' })],
    });
    expect(findings[0].message).not.toContain('never created at all');
  });

  it('takes every skip on create_record too', () => {
    const createFlow = (config: Record<string, unknown>) => ({
      name: 'f',
      nodes: [{ id: 'c', type: 'create_record', config }],
    });
    // templated object, non-literal fields, unknown object, fieldless object
    expect(
      validateFlowNodeWrites({
        objects: [dealObject],
        flows: [createFlow({ objectName: '{target}', fields: { stagee: 1 } })],
      }),
    ).toEqual([]);
    expect(
      validateFlowNodeWrites({ objects: [dealObject], flows: [createFlow({ objectName: 'deal', fields: '{all}' })] }),
    ).toEqual([]);
    expect(
      validateFlowNodeWrites({ objects: [], flows: [createFlow({ objectName: 'deal', fields: { stagee: 1 } })] }),
    ).toEqual([]);
    expect(
      validateFlowNodeWrites({
        objects: [{ name: 'deal', external: true }],
        flows: [createFlow({ objectName: 'deal', fields: { stagee: 1 } })],
      }),
    ).toEqual([]);
  });

  it('does NOT flag a readonly field on create_record — INSERT is engine-exempt from that strip', () => {
    // The readonly rule skips create_record entirely (a create may legitimately
    // seed readonly columns). This rule asks a different question, so a DECLARED
    // readonly field is clean here for its own reason: it resolves to a column.
    const withReadonly = {
      name: 'deal',
      fields: { stage: { type: 'text' }, approval_status: { type: 'text', readonly: true } },
    };
    const findings = validateFlowNodeWrites({
      objects: [withReadonly],
      flows: [{ name: 'f', nodes: [{ id: 'c', type: 'create_record', config: { objectName: 'deal', fields: { approval_status: 'approved' } } }] }],
    });
    expect(findings).toEqual([]);
  });

  // ── nested regions (#4380) ───────────────────────────────────────────
  //
  // A gating rule that stops at the top level stops gating the moment an author
  // wraps the write in error handling — which is exactly what a `catch` branch
  // holding an `update_record` is for. app-showcase ships one.
  describe('nested regions', () => {
    const nested = (containerType: string, config: Record<string, unknown>) => ({
      objects: [dealObject],
      flows: [
        {
          name: 'sync',
          nodes: [
            { id: 'start', type: 'start', config: {} },
            { id: 'guard', type: containerType, label: 'Guard', config },
          ],
        },
      ],
    });
    const badWrite = {
      id: 'flag',
      type: 'update_record',
      label: 'Flag',
      config: { objectName: 'deal', fields: { stagee: 'failed' } },
    };

    it('reaches a try_catch catch branch', () => {
      const findings = validateFlowNodeWrites(
        nested('try_catch', { try: { nodes: [], edges: [] }, catch: { nodes: [badWrite], edges: [] } }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].path).toBe('flows[0].nodes[1].config.catch.nodes[0].config.fields.stagee');
      expect(findings[0].where).toBe('flow "sync" › try_catch "Guard" › catch › node "Flag"');
    });

    it('reaches a loop body', () => {
      const findings = validateFlowNodeWrites(
        nested('loop', { collection: '{items}', body: { nodes: [badWrite], edges: [] } }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('flows[0].nodes[1].config.body.nodes[0].config.fields.stagee');
    });

    it('reaches every parallel branch', () => {
      const findings = validateFlowNodeWrites(
        nested('parallel', {
          branches: [
            { name: 'a', nodes: [badWrite], edges: [] },
            { name: 'b', nodes: [{ ...badWrite, id: 'flag2' }], edges: [] },
          ],
        }),
      );
      expect(findings).toHaveLength(2);
      expect(findings.map((f) => f.path)).toEqual([
        'flows[0].nodes[1].config.branches[0].nodes[0].config.fields.stagee',
        'flows[0].nodes[1].config.branches[1].nodes[0].config.fields.stagee',
      ]);
    });

    it('reaches a region nested inside a region', () => {
      const findings = validateFlowNodeWrites(
        nested('try_catch', {
          try: {
            nodes: [
              { id: 'each', type: 'loop', label: 'Each', config: { collection: '{x}', body: { nodes: [badWrite], edges: [] } } },
            ],
            edges: [],
          },
        }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe(
        'flows[0].nodes[1].config.try.nodes[0].config.body.nodes[0].config.fields.stagee',
      );
    });

    it('reports a nested finding exactly once, not also against its container', () => {
      const findings = validateFlowNodeWrites(
        nested('try_catch', { try: { nodes: [badWrite], edges: [] } }),
      );
      expect(findings).toHaveLength(1);
    });
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

// ─── [#8663] Unprovisioned injected anchors on the WRITE axis ────────────────
//
// The third consumer of the hook rule's IMPLICIT_FIELDS, and the only one whose
// existence finding GATES. The provenance finding deliberately does not: it is
// a claim about a remote schema this repo cannot see, so reclassifying it up to
// `error` would turn a silent case straight into a build break.
const federatedDeal = {
  name: 'wh_order',
  datasource: 'warehouse',
  external: { remoteName: 'fact_orders' },
  fields: { order_id: { type: 'text' }, amount: { type: 'currency' } },
};
const localWhOrder = { name: 'wh_order', fields: { order_id: { type: 'text' }, amount: { type: 'currency' } } };

const anchorFlow = (fields: unknown) => ({
  name: 'stamp_owner',
  type: 'record_change',
  nodes: [
    { id: 'start', type: 'start', config: {} },
    {
      id: 'mark',
      type: 'update_record',
      label: 'Stamp',
      config: { objectName: 'wh_order', filter: { id: '{recordId}' }, fields },
    },
  ],
  edges: [],
});

describe('[#8663] validateFlowNodeWrites — unprovisioned anchor writes', () => {
  it('warns (does NOT gate) when a node writes an anchor the federated object has no storage for', () => {
    const findings = validateFlowNodeWrites({ objects: [federatedDeal], flows: [anchorFlow({ owner_id: '{user.id}' })] });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR);
    // The whole point of the separate id: this rule's other finding is `error`.
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('flows[0].nodes[1].config.fields.owner_id');
    expect(findings[0].where).toBe('flow "stamp_owner" › node "Stamp"');
    expect(findings[0].message).toContain('external object (ADR-0015)');
    expect(findings[0].message).toContain('can never land');
  });

  it('the same node against the same object without the external binding is silent', () => {
    expect(validateFlowNodeWrites({ objects: [localWhOrder], flows: [anchorFlow({ owner_id: '{user.id}' })] })).toEqual([]);
  });

  it('an author-declared column of the same name is never flagged', () => {
    const declared = { ...federatedDeal, fields: { ...federatedDeal.fields, owner_id: { type: 'text' } } };
    expect(validateFlowNodeWrites({ objects: [declared], flows: [anchorFlow({ owner_id: '{user.id}' })] })).toEqual([]);
  });

  it('the gating unknown-field finding on the same federated object is unchanged', () => {
    const findings = validateFlowNodeWrites({ objects: [federatedDeal], flows: [anchorFlow({ ordr_id: 'x' })] });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_NODE_WRITE_UNKNOWN_FIELD);
    expect(findings[0].severity).toBe('error');
  });
});
