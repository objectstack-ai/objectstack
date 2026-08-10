import { describe, it, expect } from 'vitest';
import {
  FlowSchema,
  FlowNodeSchema,
  FlowEdgeSchema,
  FlowVariableSchema,
  FlowNodeAction,
  FlowVersionHistorySchema,
  defineFlow,
  type Flow,
  type FlowNode,
  type FlowEdge,
} from './flow.zod';
// #4924 — the per-node-type config contracts the executors parse at run time.
// `FlowNodeSchema.config` is deliberately open (`z.record(z.unknown())`, ADR-0018:
// `node.type` is a plugin namespace and a plugin executor brings its own
// `configSchema`), so `FlowSchema.parse` green says NOTHING about whether a
// builtin's config could run. These are the contracts that do.
import {
  GetRecordConfigSchema,
  CreateRecordConfigSchema,
  UpdateRecordConfigSchema,
  DeleteRecordConfigSchema,
} from './builtin-node-config.zod';
// #5500 — the `loop` container contract (ADR-0031). A `loop` with no
// `config.body` is the LEGACY flat-graph shape: `loop-node.ts` reads
// `config.collection` as a bare VARIABLE NAME, binds `$loopItems`/`$loopIndex`
// and falls through without iterating — so no `iteratorVariable` is ever set
// and a `{item.…}` token downstream references nothing.
import { LoopConfigSchema } from './control-flow.zod';

describe('FlowNodeAction', () => {
  it('should accept all node action types', () => {
    const actions = [
      'start', 'end', 'decision', 'assignment', 'loop',
      'create_record', 'update_record', 'delete_record', 'get_record',
      'http', 'notify', 'script', 'screen', 'wait', 'subflow', 'connector_action',
      'parallel_gateway', 'join_gateway', 'boundary_event',
    ];
    
    actions.forEach(action => {
      expect(() => FlowNodeAction.parse(action)).not.toThrow();
    });
  });

  it('should reject invalid action types', () => {
    expect(() => FlowNodeAction.parse('invalid')).toThrow();
    expect(() => FlowNodeAction.parse('custom_action')).toThrow();
  });
});

describe('FlowVariableSchema', () => {
  it('should accept basic variable', () => {
    const variable = {
      name: 'recordId',
      type: 'text',
    };

    const result = FlowVariableSchema.parse(variable);
    expect(result.isInput).toBe(false);
    expect(result.isOutput).toBe(false);
  });

  it('should accept input variable', () => {
    const variable = {
      name: 'accountId',
      type: 'text',
      isInput: true,
    };

    expect(() => FlowVariableSchema.parse(variable)).not.toThrow();
  });

  it('should accept output variable', () => {
    const variable = {
      name: 'totalAmount',
      type: 'number',
      isOutput: true,
    };

    expect(() => FlowVariableSchema.parse(variable)).not.toThrow();
  });

  it('should accept various data types', () => {
    const types = ['text', 'number', 'boolean', 'object', 'list'];

    types.forEach(type => {
      const variable = {
        name: 'testVar',
        type,
      };
      expect(() => FlowVariableSchema.parse(variable)).not.toThrow();
    });
  });

  // ── #4697: `defaultValue` — the key that makes "declared" mean "bound" ──
  //
  // The engine binds an `isInput` variable only when `params[name] !== undefined`,
  // so before this key a declaration guaranteed nothing at run time. Conditions
  // are strict CEL, where an unbound name ABORTS the predicate instead of reading
  // as `false` — the whole run stops (hotcrm#643). The engine half of the contract
  // is pinned in `service-automation/src/flow-variable-default.test.ts`; this half
  // is the authorable surface.
  describe('defaultValue (#4697)', () => {
    it('accepts a declared default, and keeps it as authored', () => {
      const parsed = FlowVariableSchema.parse({
        name: 'createOpportunity', type: 'boolean', isInput: true, defaultValue: false,
      });
      expect(parsed.defaultValue).toBe(false);
      // Not coerced away by the `isInput`/`isOutput` defaults sitting beside it.
      expect(parsed.isInput).toBe(true);
      expect(parsed.isOutput).toBe(false);
    });

    it('is OPTIONAL — a variable without it parses exactly as before, and reads back absent', () => {
      const parsed = FlowVariableSchema.parse({ name: 'v', type: 'text' });
      expect(parsed.defaultValue).toBeUndefined();
      expect('defaultValue' in parsed).toBe(false);
      // The distinction the engine's `!== undefined` boundary rests on: an
      // absent key and an authored `null` are different declarations.
      expect(FlowVariableSchema.parse({ name: 'v', type: 'object', defaultValue: null }).defaultValue).toBeNull();
    });

    it('carries a value of any shape — `type` is an open string, so there is no vocabulary to check against', () => {
      // Same posture as every other `defaultValue` on the authoring surface (a
      // mapping's, an action param's, a page state slot's, a screen field's):
      // the value is not cross-validated against the declared `type`. Pinned so
      // that adding such a check reads as the deliberate new validation surface
      // it would be, rather than as a tightening nobody notices.
      for (const defaultValue of [false, 0, '', 'text', [], {}, { nested: { deep: 1 } }, [1, 2, 3]]) {
        expect(() => FlowVariableSchema.parse({ name: 'v', type: 'boolean', defaultValue })).not.toThrow();
      }
    });

    it('a flow carries variables with defaults through FlowSchema', () => {
      const flow = FlowSchema.parse({
        name: 'lead_conversion',
        label: 'Lead Conversion',
        type: 'screen',
        variables: [
          { name: 'createOpportunity', type: 'boolean', isInput: true, defaultValue: false },
          { name: 'attempts', type: 'number', defaultValue: 0 },
        ],
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      });
      expect(flow.variables?.map(v => v.defaultValue)).toEqual([false, 0]);
    });
  });
});

describe('FlowNodeSchema', () => {
  it('should accept minimal node', () => {
    const node: FlowNode = {
      id: 'node_1',
      type: 'start',
      label: 'Start',
    };

    expect(() => FlowNodeSchema.parse(node)).not.toThrow();
  });

  it('should accept node with position', () => {
    const node: FlowNode = {
      id: 'node_2',
      type: 'decision',
      label: 'Check Amount',
      position: { x: 100, y: 200 },
    };

    expect(() => FlowNodeSchema.parse(node)).not.toThrow();
  });

  it('should accept node with config', () => {
    const node: FlowNode = {
      id: 'node_3',
      type: 'create_record',
      label: 'Create Account',
      // #5500 — was `object:`, the retired spelling the ADR-0087 D2 conversion
      // `flow-node-crud-object-alias` rewrites at load (live through this major,
      // retires at 18). A fixture is a teaching surface, so it spells the
      // canonical key the executor actually reads.
      config: {
        objectName: 'account',
        fields: {
          name: '{input.companyName}',
          status: 'active',
        },
      },
    };

    expect(() => FlowNodeSchema.parse(node)).not.toThrow();

    // #5500 — `FlowNodeSchema.config` is deliberately open (ADR-0018), so the
    // parse above stays green on a config no executor could run. Pin the config
    // against the contract `create_record` actually parses: this is a VALUE
    // verdict (the executor refuses the node without `objectName`), so full
    // safeParse green is the right bar, and the alias spelling turns it red.
    expect(CreateRecordConfigSchema.safeParse(node.config).success).toBe(true);
  });

  it('should accept all node types', () => {
    const types = [
      'start', 'end', 'decision', 'assignment', 'loop',
      'create_record', 'update_record', 'delete_record', 'get_record',
      'http', 'notify', 'script', 'screen', 'wait', 'subflow', 'connector_action',
      'parallel_gateway', 'join_gateway', 'boundary_event',
    ] as const;

    types.forEach(type => {
      const node: FlowNode = {
        id: `node_${type}`,
        type,
        label: type,
      };
      expect(() => FlowNodeSchema.parse(node)).not.toThrow();
    });
  });

  it('should accept node with timeoutMs', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'http_1',
      type: 'http',
      label: 'Call API',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeoutMs).toBe(5000);
    }
  });

  it('should accept node with inputSchema (outputSchema retired, #3896)', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'script_1',
      type: 'script',
      label: 'Process Data',
      inputSchema: {
        name: { type: 'string', required: true, description: 'User name' },
        age: { type: 'number', required: false },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.inputSchema).toBeDefined();
    }
  });
});

describe('FlowEdgeSchema', () => {
  it('should accept minimal edge', () => {
    const edge: FlowEdge = {
      id: 'edge_1',
      source: 'node_1',
      target: 'node_2',
    };

    expect(() => FlowEdgeSchema.parse(edge)).not.toThrow();
  });

  it('should accept edge with condition', () => {
    const edge: FlowEdge = {
      id: 'edge_2',
      source: 'decision_1',
      target: 'node_3',
      condition: 'amount > 1000',
    };

    expect(() => FlowEdgeSchema.parse(edge)).not.toThrow();
  });

  it('should accept edge with label', () => {
    const edge: FlowEdge = {
      id: 'edge_3',
      source: 'node_1',
      target: 'node_2',
      label: 'Yes',
    };

    expect(() => FlowEdgeSchema.parse(edge)).not.toThrow();
  });

  it('should accept edge with both condition and label', () => {
    const edge: FlowEdge = {
      id: 'edge_4',
      source: 'decision_1',
      target: 'approve_path',
      condition: 'status == "approved"',
      label: 'Approved',
    };

    expect(() => FlowEdgeSchema.parse(edge)).not.toThrow();
  });
});

describe('FlowSchema', () => {
  describe('Basic Properties', () => {
    it('should accept minimal flow', () => {
      const flow: Flow = {
        name: 'simple_flow',
        label: 'Simple Flow',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'edge_1', source: 'start', target: 'end' },
        ],
      };

      const result = FlowSchema.parse(flow);
      expect(result.runAs).toBe('user');
    });

    it('should enforce snake_case for flow name', () => {
      const validNames = ['approval_flow', 'send_email', 'create_record', '_internal'];
      validNames.forEach(name => {
        expect(() => FlowSchema.parse({
          name,
          label: 'Test',
          type: 'autolaunched',
          nodes: [],
          edges: [],
        })).not.toThrow();
      });

      const invalidNames = ['approvalFlow', 'Approval-Flow', '123flow'];
      invalidNames.forEach(name => {
        expect(() => FlowSchema.parse({
          name,
          label: 'Test',
          type: 'autolaunched',
          nodes: [],
          edges: [],
        })).toThrow();
      });
    });

    it('should accept all flow types', () => {
      const types = ['autolaunched', 'record_change', 'schedule', 'screen', 'api'] as const;
      
      types.forEach(type => {
        const flow: Flow = {
          name: 'test_flow',
          label: 'Test Flow',
          type,
          nodes: [],
          edges: [],
        };
        expect(() => FlowSchema.parse(flow)).not.toThrow();
      });
    });

    it('REJECTS the retired `active` with the status prescription (#3896)', () => {
      let message = '';
      try {
        FlowSchema.parse({
          name: 'test_flow', label: 'Test', type: 'autolaunched', nodes: [], edges: [], active: false,
        });
      } catch (e) {
        message = String((e as Error).message);
      }
      expect(message).toMatch(/status/);
      expect(message).toMatch(/#3896/);
    });

    it('should default runAs to user', () => {
      const flow = {
        name: 'test_flow',
        label: 'Test',
        type: 'autolaunched' as const,
        nodes: [],
        edges: [],
      };

      const result = FlowSchema.parse(flow);
      expect(result.runAs).toBe('user');
    });
  });

  describe('Flow with Variables', () => {
    it('should accept flow with variables', () => {
      const flow: Flow = {
        name: 'data_flow',
        label: 'Data Processing Flow',
        type: 'autolaunched',
        variables: [
          { name: 'recordId', type: 'text', isInput: true },
          { name: 'amount', type: 'number', isInput: true },
          { name: 'result', type: 'boolean', isOutput: true },
        ],
        nodes: [],
        edges: [],
      };

      expect(() => FlowSchema.parse(flow)).not.toThrow();
    });
  });

  describe('Real-World Flow Examples', () => {
    it('should accept approval flow', () => {
      const approvalFlow: Flow = {
        name: 'opportunity_approval',
        label: 'Opportunity Approval Flow',
        description: 'Handles approval process for large opportunities',
        type: 'record_change',
        variables: [
          { name: 'opportunityId', type: 'text', isInput: true },
          { name: 'approvalRequired', type: 'boolean', isOutput: true },
        ],
        nodes: [
          {
            id: 'start',
            type: 'start',
            label: 'Start',
            position: { x: 100, y: 50 },
          },
          {
            id: 'get_opportunity',
            type: 'get_record',
            label: 'Get Opportunity',
            // #4924 — was `{ object, recordId }`, and GetRecordConfigSchema declares
            // NEITHER: `object` is the retired spelling the ADR-0087 D2 conversion
            // `flow-node-crud-object-alias` rewrites at load, and `recordId` is not a
            // key any CRUD executor has ever read. CRUD nodes address rows through
            // `filter` only, so the id goes in as a filter VALUE. `outputVariable` is
            // what actually binds the row to a variable — without it the downstream
            // `opportunity.*` predicate below referenced nothing.
            config: {
              objectName: 'opportunity',
              filter: { id: '{opportunityId}' },
              outputVariable: 'opportunity',
            },
            position: { x: 100, y: 150 },
          },
          {
            id: 'check_amount',
            type: 'decision',
            label: 'Amount > $100K?',
            // #4924 — the `config.condition` that used to live here was inert:
            // the key is the trigger gate on a `start` node and is read on no other
            // node type, which is what `lint-flow-patterns`' `flow-inert-node-condition`
            // advisory reports (#4414). A `decision` branches on its OUT-EDGES
            // (`condition` per branch + `isDefault: true` on the fallback) or on
            // `config.conditions[]` — one mechanism, never both. The out-edges below
            // already carried the predicate, so the third copy is simply gone.
            position: { x: 100, y: 250 },
          },
          {
            id: 'auto_approve',
            type: 'update_record',
            label: 'Auto Approve',
            // #4924 — `recordId` again (unread; see `get_opportunity`). `objectName`
            // is execute-time REQUIRED — without it the executor refuses the node
            // outright — so this fixture could not have run as written either.
            config: {
              objectName: 'opportunity',
              filter: { id: '{opportunityId}' },
              fields: {
                status: 'approved',
                approved_by: 'system',
              },
            },
            position: { x: 50, y: 350 },
          },
          {
            id: 'send_approval_request',
            type: 'http',
            label: 'Send to Manager',
            config: {
              url: '/api/approvals',
              method: 'POST',
              body: {
                recordId: '{opportunityId}',
                approver: '{opportunity.owner.manager}',
              },
            },
            position: { x: 250, y: 350 },
          },
          {
            id: 'end',
            type: 'end',
            label: 'End',
            position: { x: 100, y: 450 },
          },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'get_opportunity' },
          { id: 'e2', source: 'get_opportunity', target: 'check_amount' },
          {
            // #4924 — the fallback branch. `isDefault: true` is traversed only when
            // no sibling condition matched; carrying a `condition` as well is
            // self-contradictory (BPMN forbids a conditional default flow) and the
            // flow linter gates it as `flow-default-edge-with-condition` (#4414).
            id: 'e3',
            source: 'check_amount',
            target: 'auto_approve',
            isDefault: true,
            label: 'No',
          },
          {
            // #4924 — the one guarded branch, in the dialect the slot declares:
            // edge conditions are BARE CEL (ADR-0032). `{…}` template braces parse as
            // a CEL map literal, so `registerFlow`'s expression pass rejects them
            // outright — the #1491 trap this fixture used to teach.
            id: 'e4',
            source: 'check_amount',
            target: 'send_approval_request',
            condition: 'opportunity.amount > 100000',
            label: 'Yes',
          },
          { id: 'e5', source: 'auto_approve', target: 'end' },
          { id: 'e6', source: 'send_approval_request', target: 'end' },
        ],
        runAs: 'system',
      };

      expect(() => FlowSchema.parse(approvalFlow)).not.toThrow();

      // #4924 — and that green tells us nothing about the node configs, which is
      // exactly how this fixture taught three shapes that cannot run. Check each
      // corrected node against the contract its executor parses.
      const configOf = (id: string) => approvalFlow.nodes.find(n => n.id === id)?.config;
      expect(GetRecordConfigSchema.safeParse(configOf('get_opportunity')).success).toBe(true);
      expect(UpdateRecordConfigSchema.safeParse(configOf('auto_approve')).success).toBe(true);

      // The decision declares no config at all: its branching lives on the
      // out-edges — exactly one guarded branch and exactly one `isDefault`
      // fallback, and the fallback carries no condition (#4414).
      expect(configOf('check_amount')).toBeUndefined();
      const branches = approvalFlow.edges.filter(e => e.source === 'check_amount');
      expect(branches.filter(e => e.condition && e.isDefault !== true)).toHaveLength(1);
      expect(branches.filter(e => e.isDefault === true && !e.condition)).toHaveLength(1);
      // Bare CEL, not `{…}` template braces — the #1491 trap (ADR-0032).
      const guarded = branches.find(e => e.condition);
      expect(String(guarded?.condition)).not.toContain('{');
    });

    it('should accept screen flow for user input', () => {
      const screenFlow: Flow = {
        name: 'contact_creation_wizard',
        label: 'Contact Creation Wizard',
        type: 'screen',
        variables: [
          { name: 'firstName', type: 'text', isInput: true },
          { name: 'lastName', type: 'text', isInput: true },
          { name: 'email', type: 'text', isInput: true },
          { name: 'contactId', type: 'text', isOutput: true },
        ],
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          {
            id: 'create_contact',
            type: 'create_record',
            label: 'Create Contact',
            // #5500 — `object:` → `objectName:` (see `should accept node with
            // config`). The `{firstName}` &c. tokens are declared INPUT
            // variables, which the engine binds by name, so they resolve.
            config: {
              objectName: 'contact',
              fields: {
                first_name: '{firstName}',
                last_name: '{lastName}',
                email: '{email}',
              },
            },
          },
          {
            id: 'assign_output',
            type: 'assignment',
            label: 'Set Output',
            // #5500 — was `{ variable: 'contactId', value: '{create_contact.id}' }`,
            // which set NEITHER. `logic-nodes.ts` normalizes three assignment
            // shapes and its last branch is "no `assignments` wrapper → the
            // top-level config keys ARE the variable names", so that config
            // declared two variables literally named `variable` and `value`,
            // and `contactId` — declared `isOutput: true` right above — was
            // never written. Measured: with the old shape the run ends with
            // `variable='contactId'`, `value='<the new id>'`, `contactId=undefined`.
            //
            // The VALUE token was fine and is kept verbatim: the engine binds
            // every node's `result.output` under `<nodeId>.<key>` and the
            // template resolver reads that flat key, so `{create_contact.id}`
            // resolves to the created row's id (`create_record` outputs `id`).
            config: {
              assignments: { contactId: '{create_contact.id}' },
            },
          },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'create_contact' },
          { id: 'e2', source: 'create_contact', target: 'assign_output' },
          { id: 'e3', source: 'assign_output', target: 'end' },
        ],
      };

      expect(() => FlowSchema.parse(screenFlow)).not.toThrow();

      // #5500 — pin the create node against the contract its executor parses.
      const cfgOf = (id: string) => screenFlow.nodes.find(n => n.id === id)?.config;
      expect(CreateRecordConfigSchema.safeParse(cfgOf('create_contact')).success).toBe(true);

      // #5500 — pin the assignment's SHAPE, which no spec schema governs (the
      // executor reads `config` directly, so `FlowSchema.parse` can never catch
      // this). The writes must live under `assignments`, and every name written
      // must be a variable this flow declares — reverting to the bare
      // `{ variable, value }` shape leaves `assignments` undefined and turns
      // both assertions red.
      const assignCfg = cfgOf('assign_output') as { assignments?: Record<string, unknown> };
      expect(Object.keys(assignCfg?.assignments ?? {})).toEqual(['contactId']);
      const declared = new Set((screenFlow.variables ?? []).map(v => v.name));
      for (const written of Object.keys(assignCfg?.assignments ?? {})) {
        expect(declared.has(written)).toBe(true);
      }
    });

    it('should accept scheduled flow', () => {
      const scheduledFlow: Flow = {
        name: 'daily_cleanup',
        label: 'Daily Data Cleanup',
        description: 'Runs daily to archive old records',
        type: 'schedule',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          {
            id: 'get_old_records',
            type: 'get_record',
            label: 'Find Old Records',
            // #5500 — three defects in two keys:
            //  • `object:` → `objectName:` (the ADR-0087 D2 alias, as above).
            //  • `filter` was the STRING `'created_at < DAYS_AGO(90)'`. The
            //    contract declares `z.record(z.string(), z.unknown())`, so a
            //    string fails safeParse outright ("expected record, received
            //    string"), and `DAYS_AGO()` is a function no layer implements.
            //    The date window is spelled in the dialect that OWNS a filter
            //    value position: `{90_days_ago}` is a spec date macro
            //    (`DATE_MACRO_PARAM_RE`), and `interpolateFilter` hands a known
            //    filter token through VERBATIM for the query engine's
            //    `resolveFilterTokens` to expand (#3810 ownership transfer) —
            //    `date-macros.zod.ts` names "flow node filters" as a consumer.
            //  • `limit` was absent. The executor branches on it: `limit > 1`
            //    runs `find` and outputs a `records` LIST; otherwise `findOne`
            //    and a single `record`. A cleanup sweep wants the list, and the
            //    loop below needs an array, so the limit is what makes the
            //    downstream `collection` an array at all.
            config: {
              objectName: 'log_entry',
              filter: { created_at: { $lt: '{90_days_ago}' } },
              limit: 200,
              outputVariable: 'oldRecords',
            },
          },
          {
            id: 'loop_records',
            type: 'loop',
            label: 'For Each Record',
            // #5500 — was a LEGACY flat-graph loop: no `config.body`, so
            // `loop-node.ts` took its back-compat branch, which reads
            // `config.collection` as a bare VARIABLE NAME (not a template),
            // found no variable literally named `{get_old_records.records}`,
            // bound nothing and returned success. The `loop → delete → loop`
            // back-edge was ordinary graph traversal, and `{item.id}` in the
            // delete node below referenced a variable no one ever set.
            // Measured on the old shape: `$loopItems` unset, `item` undefined.
            //
            // This is now the ADR-0031 structured container: the per-item steps
            // live in `config.body` (a single-entry/single-exit region run in
            // the enclosing scope) and `iteratorVariable` is what binds `item`.
            config: {
              collection: '{oldRecords}',
              iteratorVariable: 'item',
              maxIterations: 200,
              body: {
                nodes: [
                  {
                    id: 'delete_record',
                    type: 'delete_record',
                    label: 'Delete Record',
                    // #4924 — this was the worst of the three shapes: `recordId` was the
                    // node's ONLY key, no executor reads it, and a `delete_record` whose
                    // single "constraint" is unread is a match-everything delete (#3810)
                    // wearing a key that reads like a constraint. The executor locates rows
                    // through `filter` and refuses the node without `objectName`.
                    // The per-item token is the loop's `iteratorVariable` (default `item`),
                    // NOT `{<node id>.item}` — and #5500 moved the node INSIDE the loop
                    // body, which is what makes `item` actually bound per iteration.
                    config: {
                      objectName: 'log_entry',
                      filter: { id: '{item.id}' },
                    },
                  },
                ],
                edges: [],
              },
            },
          },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'get_old_records' },
          { id: 'e2', source: 'get_old_records', target: 'loop_records' },
          // #5500 — the `loop → delete → loop` back-edge pair is gone: the
          // delete node now lives in `config.body`, so the loop's ordinary
          // out-edge is simply the after-loop continuation (ADR-0031).
          { id: 'e3', source: 'loop_records', target: 'end', label: 'Done' },
        ],
        runAs: 'system',
      };

      expect(() => FlowSchema.parse(scheduledFlow)).not.toThrow();

      // #4924 — the delete node addresses rows the only way the executor does.
      // #5500 — it is now reached through the loop's body region.
      const loopConfig = scheduledFlow.nodes.find(n => n.id === 'loop_records')?.config;
      const parsedLoop = LoopConfigSchema.safeParse(loopConfig);
      expect(parsedLoop.success).toBe(true);
      const deleteConfig = parsedLoop.success
        ? parsedLoop.data.body?.nodes.find(n => n.id === 'delete_record')?.config
        : undefined;
      expect(DeleteRecordConfigSchema.safeParse(deleteConfig).success).toBe(true);

      // #5500 — pin the loop as a STRUCTURED container. `body` is what separates
      // it from the legacy flat-graph shape that iterated nothing, and
      // `iteratorVariable` is the only thing that binds the `{item.…}` token the
      // body's filter reads. Dropping `body` puts the fixture back on the
      // legacy branch and turns both of these red.
      expect(parsedLoop.success && parsedLoop.data.body).toBeDefined();
      expect(parsedLoop.success && parsedLoop.data.iteratorVariable).toBe('item');
      // …and no main-graph edge targets a body node any more.
      const bodyNodeIds = new Set(
        parsedLoop.success ? (parsedLoop.data.body?.nodes ?? []).map(n => n.id) : [],
      );
      expect(scheduledFlow.edges.filter(e => bodyNodeIds.has(e.target))).toHaveLength(0);

      // #5500 — the upstream read must produce an ARRAY for the loop to iterate:
      // `limit > 1` is what selects the `find`/`records` branch over
      // `findOne`/`record`, so it is a contract detail, not a tuning knob.
      const getConfig = scheduledFlow.nodes.find(n => n.id === 'get_old_records')?.config;
      const parsedGet = GetRecordConfigSchema.safeParse(getConfig);
      expect(parsedGet.success).toBe(true);
      expect(parsedGet.success && (parsedGet.data.limit ?? 0) > 1).toBe(true);
      expect(parsedGet.success && parsedGet.data.outputVariable).toBe('oldRecords');
    });

    it('should accept API flow with webhook', () => {
      const apiFlow: Flow = {
        name: 'external_api_integration',
        label: 'External API Integration',
        type: 'api',
        variables: [
          { name: 'payload', type: 'object', isInput: true },
          { name: 'response', type: 'object', isOutput: true },
        ],
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          {
            id: 'call_external_api',
            type: 'http',
            label: 'Call External API',
            config: {
              url: 'https://api.external.com/v1/data',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer {$Credential.token}',
              },
              body: '{payload}',
            },
          },
          {
            id: 'process_response',
            type: 'script',
            label: 'Process Response',
            config: {
              script: 'return JSON.parse(response.body);',
            },
          },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'call_external_api' },
          { id: 'e2', source: 'call_external_api', target: 'process_response' },
          { id: 'e3', source: 'process_response', target: 'end' },
        ],
      };

      expect(() => FlowSchema.parse(apiFlow)).not.toThrow();
    });
  });
});

// ============================================================================
// Protocol Improvement Tests: Flow errorHandling
// ============================================================================

describe('FlowSchema - errorHandling', () => {
  it('should accept flow with errorHandling config', () => {
    const result = FlowSchema.parse({
      name: 'resilient_flow',
      label: 'Resilient Flow',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
      errorHandling: {
        strategy: 'retry',
        maxRetries: 3,
        backoffMs: 2000,
      },
    });
    expect(result.errorHandling?.strategy).toBe('retry');
    expect(result.errorHandling?.maxRetries).toBe(3);
    expect(result.errorHandling?.backoffMs).toBe(2000);
  });

  it('should default errorHandling strategy to fail', () => {
    const result = FlowSchema.parse({
      name: 'default_flow',
      label: 'Default',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
      ],
      edges: [],
      errorHandling: {},
    });
    expect(result.errorHandling?.strategy).toBe('fail');
    expect(result.errorHandling?.maxRetries).toBe(0);
  });

  /**
   * #4247 — `maxRetries` had two defaults: `.default(0)` here and
   * `errorHandling.maxRetries ?? 3` in the engine's `retryExecution`. Because
   * `??` only fires on `undefined`, an unstated count meant 0 retries for a
   * parsed flow and 3 for a hand-built one — the retry count depended on the
   * route into the engine, not on what the author wrote.
   *
   * The engine's copy is gone; this block is the only source. The count that
   * was ambiguous is also the one that was inert — `strategy: 'retry'` with 0
   * attempts runs the flow once and stops, i.e. `strategy: 'fail'` under
   * another name — so it is refused rather than defaulted to some number
   * nobody wrote. A retry re-runs the WHOLE flow, side effects included; that
   * is not a count to guess on the author's behalf.
   */
  describe('#4247 — one default, and no zero-attempt "retry"', () => {
    const retryFlow = (errorHandling: unknown) => FlowSchema.safeParse({
      name: 'retry_flow',
      label: 'Retry Flow',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
      errorHandling,
    });

    it("REJECTS strategy: 'retry' with no maxRetries — the count is stated, never guessed", () => {
      const result = retryFlow({ strategy: 'retry' });

      expect(result.success).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === 'errorHandling.maxRetries');
      expect(issue, 'the refusal should point at maxRetries').toBeDefined();
      // The message carries the prescription, not just the complaint.
      expect(issue!.message).toContain('maxRetries: 3');
      expect(issue!.message).toContain("strategy: 'fail'");
    });

    it("REJECTS strategy: 'retry' with an explicit maxRetries: 0 — same no-op, spelled out", () => {
      const result = retryFlow({ strategy: 'retry', maxRetries: 0 });

      expect(result.success).toBe(false);
      expect(result.error!.issues.some((i) => i.path.join('.') === 'errorHandling.maxRetries')).toBe(true);
    });

    it("accepts the smallest honest retry — strategy: 'retry' with maxRetries: 1", () => {
      const result = retryFlow({ strategy: 'retry', maxRetries: 1 });

      expect(result.success).toBe(true);
      expect(result.data!.errorHandling?.maxRetries).toBe(1);
    });

    it("keeps maxRetries: 0 legal under 'fail' and 'continue' — they never read it", () => {
      for (const strategy of ['fail', 'continue'] as const) {
        const result = retryFlow({ strategy, maxRetries: 0, backoffMs: 0, backoffMultiplier: 1 });
        expect(result.success, `${strategy} should accept a spelled-out block`).toBe(true);
      }
    });

    it('parses every retry knob to a concrete value — the engine reads them with no fallback', () => {
      const result = retryFlow({ strategy: 'retry', maxRetries: 2 });

      // `retryExecution` destructures these five directly. Each must survive
      // the parse as a number/boolean, or the engine would be back to
      // re-inventing a default for whichever one went missing.
      expect(result.data!.errorHandling).toMatchObject({
        strategy: 'retry',
        maxRetries: 2,
        backoffMs: 1000,
        backoffMultiplier: 1,
        maxRetryDelayMs: 30000,
        jitter: false,
      });
    });
  });

  it('REJECTS the retired errorHandling.fallbackNodeId — faults route via fault edges (#3896)', () => {
    expect(() => FlowSchema.parse({
      name: 'fallback_flow',
      label: 'Fallback',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'fallback', type: 'end', label: 'Fallback' },
      ],
      edges: [],
      errorHandling: { strategy: 'continue', fallbackNodeId: 'fallback' },
    })).toThrow(/fault edge/);
  });

  it('should accept flow without errorHandling (optional)', () => {
    const result = FlowSchema.parse({
      name: 'simple_flow',
      label: 'Simple',
      type: 'autolaunched',
      nodes: [{ id: 'start', type: 'start', label: 'Start' }],
      edges: [],
    });
    expect(result.errorHandling).toBeUndefined();
  });

  it('should accept exponential backoff configuration', () => {
    const result = FlowSchema.safeParse({
      name: 'backoff_flow',
      label: 'Backoff Flow',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
      errorHandling: {
        strategy: 'retry',
        maxRetries: 5,
        backoffMs: 1000,
        backoffMultiplier: 2,
        maxRetryDelayMs: 30000,
        jitter: true,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errorHandling!.backoffMultiplier).toBe(2);
      expect(result.data.errorHandling!.maxRetryDelayMs).toBe(30000);
      expect(result.data.errorHandling!.jitter).toBe(true);
    }
  });

  it('should use defaults for backoff fields', () => {
    const result = FlowSchema.safeParse({
      name: 'default_backoff',
      label: 'Default Backoff',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
      // `maxRetries` is stated because #4247 refuses a zero-attempt 'retry';
      // the backoff knobs under test still default.
      errorHandling: { strategy: 'retry', maxRetries: 3 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errorHandling!.backoffMultiplier).toBe(1);
      expect(result.data.errorHandling!.maxRetryDelayMs).toBe(30000);
      expect(result.data.errorHandling!.jitter).toBe(false);
    }
  });
});

describe('defineFlow', () => {
  it('should return a parsed flow', () => {
    const result = defineFlow({
      name: 'on_task_create',
      label: 'On Task Create',
      type: 'record_change',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    });
    expect(result.name).toBe('on_task_create');
    expect(result.label).toBe('On Task Create');
    expect(result.type).toBe('record_change');
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it('should apply defaults', () => {
    const result = defineFlow({
      name: 'simple',
      label: 'Simple',
      type: 'autolaunched',
      nodes: [{ id: 'start', type: 'start', label: 'Start' }],
      edges: [],
    });
    expect(result.version).toBe(1);
    expect(result.status).toBe('draft');
    expect(result.runAs).toBe('user');
  });

  it('should throw on invalid flow name', () => {
    expect(() => defineFlow({
      name: 'INVALID',
      label: 'Bad Flow',
      type: 'autolaunched',
      nodes: [],
      edges: [],
    })).toThrow();
  });
});

describe('FlowVersionHistorySchema', () => {
  it('should validate a flow version history entry', () => {
    const result = FlowVersionHistorySchema.safeParse({
      flowName: 'my_flow',
      version: 1,
      definition: {
        name: 'my_flow',
        label: 'My Flow',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: 'admin',
      changeNote: 'Initial version',
    });
    expect(result.success).toBe(true);
  });

  it('should require flowName, version, definition, and createdAt', () => {
    const result = FlowVersionHistorySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// BPMN Business Semantics Tests
// ============================================================================

describe('BPMN — Parallel Gateway & Join Gateway', () => {
  it('should accept parallel_gateway node type', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'pg_1',
      type: 'parallel_gateway',
      label: 'Fork — parallel approval',
      position: { x: 200, y: 100 },
    });
    expect(result.success).toBe(true);
  });

  it('should accept join_gateway node type', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'jg_1',
      type: 'join_gateway',
      label: 'Join — wait for all branches',
      position: { x: 200, y: 400 },
    });
    expect(result.success).toBe(true);
  });

  it('should validate a complete parallel approval flow', () => {
    const flow: Flow = {
      name: 'parallel_approval',
      label: 'Parallel Approval Flow',
      description: 'Demonstrates AND-split / AND-join for multi-department approval',
      type: 'record_change',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'fork', type: 'parallel_gateway', label: 'Fork — Parallel Approval' },
        { id: 'finance_review', type: 'connector_action', label: 'Finance Review' },
        { id: 'legal_review', type: 'connector_action', label: 'Legal Review' },
        { id: 'join', type: 'join_gateway', label: 'Join — All Approved' },
        { id: 'final_approve', type: 'update_record', label: 'Final Approve' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'fork' },
        { id: 'e2', source: 'fork', target: 'finance_review' },
        { id: 'e3', source: 'fork', target: 'legal_review' },
        { id: 'e4', source: 'finance_review', target: 'join' },
        { id: 'e5', source: 'legal_review', target: 'join' },
        { id: 'e6', source: 'join', target: 'final_approve' },
        { id: 'e7', source: 'final_approve', target: 'end' },
      ],
      runAs: 'system',
    };

    const result = FlowSchema.safeParse(flow);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes).toHaveLength(7);
      const gatewayTypes = result.data.nodes
        .filter(n => n.type === 'parallel_gateway' || n.type === 'join_gateway')
        .map(n => n.type);
      expect(gatewayTypes).toEqual(['parallel_gateway', 'join_gateway']);
    }
  });
});

describe('BPMN — Default Sequence Flow (isDefault)', () => {
  it('should default isDefault to false', () => {
    const result = FlowEdgeSchema.parse({
      id: 'e1',
      source: 'a',
      target: 'b',
    });
    expect(result.isDefault).toBe(false);
  });

  it('should accept isDefault: true on an edge', () => {
    const result = FlowEdgeSchema.parse({
      id: 'e_default',
      source: 'decision_1',
      target: 'fallback_node',
      isDefault: true,
      label: 'Default',
    });
    expect(result.isDefault).toBe(true);
  });

  it('should accept conditional edge type', () => {
    const result = FlowEdgeSchema.parse({
      id: 'e_cond',
      source: 'decision_1',
      target: 'branch_a',
      type: 'conditional',
      // #5500 — was `'{amount} > 1000'`. An edge condition is BARE CEL
      // (ADR-0032 §1a); `{…}` template braces parse as a CEL map literal, and
      // `AutomationEngine.registerFlow` parse-validates every predicate at
      // registration, so the braced form is a HARD registration failure:
      // "Flow '…' has 1 invalid expression (ADR-0032 §1a). Predicates … must
      // not wrap references in `{…}` template braces". This is the #1491 trap.
      condition: 'amount > 1000',
      label: 'High Value',
    });
    expect(result.type).toBe('conditional');
    expect(result.isDefault).toBe(false);
    // #5500 — only an explicit assertion keeps this fixture from teaching the
    // braced form back in. Braces are correct in TEMPLATE slots
    // (`loop.collection`) and wrong here — the distinction is the whole point.
    //
    // Read `.source`, NOT the condition itself: `ExpressionInputSchema`
    // normalizes a bare-string predicate into the canonical
    // `{ dialect: 'cel', source }` envelope, so `expect(result.condition)
    // .not.toContain('{')` asserts against an OBJECT and passes no matter what
    // the predicate says. That phantom was written here first and caught by
    // reverse-verification (the braced spelling stayed green) — hence this note.
    expect(result.condition?.dialect).toBe('cel');
    expect(result.condition?.source).not.toContain('{');
  });

  it('should validate a decision with default and conditional branches', () => {
    const flow: Flow = {
      name: 'default_branch_flow',
      label: 'Default Branch Flow',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'check_priority', type: 'decision', label: 'Check Priority' },
        { id: 'high_path', type: 'update_record', label: 'High Priority Handler' },
        { id: 'medium_path', type: 'update_record', label: 'Medium Priority Handler' },
        { id: 'default_path', type: 'update_record', label: 'Default Handler' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'check_priority' },
        // #5500 — bare CEL, not `{…}` template braces (ADR-0032 §1a; see
        // 'should accept conditional edge type'). Registering the braced form
        // threw at `registerFlow`, so this whole fixture was un-runnable.
        { id: 'e2', source: 'check_priority', target: 'high_path', type: 'conditional', condition: 'priority == "high"' },
        { id: 'e3', source: 'check_priority', target: 'medium_path', type: 'conditional', condition: 'priority == "medium"' },
        { id: 'e4', source: 'check_priority', target: 'default_path', isDefault: true, label: 'Default' },
        { id: 'e5', source: 'high_path', target: 'end' },
        { id: 'e6', source: 'medium_path', target: 'end' },
        { id: 'e7', source: 'default_path', target: 'end' },
      ],
    };

    const result = FlowSchema.safeParse(flow);
    expect(result.success).toBe(true);
    if (result.success) {
      const defaultEdge = result.data.edges.find(e => e.isDefault);
      expect(defaultEdge).toBeDefined();
      expect(defaultEdge!.target).toBe('default_path');
      // #5500 — every guarded branch is bare CEL. `FlowSchema.parse` accepts any
      // string here, so without this the fixture could teach the #1491 braced
      // form back in while staying green. Assert on the normalized
      // `condition.source` (see 'should accept conditional edge type') — the
      // parsed `condition` is an Expression ENVELOPE, and `toContain` against
      // the envelope object pins nothing.
      const guardedEdges = result.data.edges.filter(e => e.condition);
      expect(guardedEdges).toHaveLength(2);
      for (const guarded of guardedEdges) {
        expect(guarded.condition?.source).not.toContain('{');
      }
    }
  });
});

describe('BPMN — Wait Event Configuration', () => {
  it('should accept wait node with timer event config', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'wait_timer',
      type: 'wait',
      label: 'Wait 1 Hour',
      waitEventConfig: {
        eventType: 'timer',
        timerDuration: 'PT1H',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.waitEventConfig?.eventType).toBe('timer');
      expect(result.data.waitEventConfig?.timerDuration).toBe('PT1H');
    }
  });

  it('should accept wait node with webhook event config', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'wait_webhook',
      type: 'wait',
      label: 'Wait for External Webhook',
      waitEventConfig: {
        eventType: 'webhook',
        signalName: 'payment_received',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.waitEventConfig?.eventType).toBe('webhook');
      expect(result.data.waitEventConfig?.signalName).toBe('payment_received');
    }
  });

  it('should accept wait node with signal event config', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'wait_signal',
      type: 'wait',
      label: 'Wait for Approval Signal',
      waitEventConfig: {
        eventType: 'signal',
        signalName: 'manager_approved',
      },
    });
    expect(result.success).toBe(true);
  });

  /**
   * These three tests used to assert the OPPOSITE — that `timeoutMs` and
   * `onTimeout` were accepted, and that `onTimeout` defaulted to `'fail'`. They
   * were encoding a contract the runtime never honoured: nothing read `onTimeout`,
   * and `timeoutMs` was consumed as the timer duration rather than as a timeout
   * (#4158). Retiring the pair is what flipped them, which is the point — the
   * schema now says what `wait` actually does.
   */
  it('rejects the retired timeout keys instead of stripping them (#4158)', () => {
    for (const retired of [{ timeoutMs: 7_200_000 }, { onTimeout: 'fail' }]) {
      const result = FlowNodeSchema.safeParse({
        id: 'wait_timer',
        type: 'wait',
        label: 'Wait 1 Hour',
        waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H', ...retired },
      });
      const key = Object.keys(retired)[0];
      expect(result.success, `${key} must be rejected, not silently dropped`).toBe(false);
      // The prescription names the issue and the replacement (or its absence).
      expect(JSON.stringify(result.error?.issues), `${key} guidance`).toMatch(/4158/);
    }
  });

  /**
   * #6758 — a prescription that does not parse is WORSE than no prescription:
   * the author lands in the exact rejection the tombstone exists to spare them,
   * and the second one is a bare `invalid_type` with no guidance attached. Both
   * author-facing channels on this block print a `timerDuration` value to copy,
   * and `timerDuration` is `z.string()` — so every value they print must be
   * QUOTED. Until this test they printed the bare number `60000`, which is
   * TS2322 at the authoring site and `expected string, received number` at the
   * parse (the ADR-0087 conversion has always known better: it writes
   * `String(next.timeoutMs)`, `conversions/registry.ts` — "Moving the number
   * unstringified would produce a block that no longer parses").
   *
   * The value is EXTRACTED from the message rather than compared to a copy: a
   * hard-coded `'60000'` here would go green the moment someone reworded the
   * prose, which is precisely when this needs to be checked.
   */
  it('every `timerDuration` value the wait-timeout prescriptions print actually parses (#6758)', () => {
    const waitNode = (waitEventConfig: Record<string, unknown>) => ({
      id: 'wait_timer', type: 'wait', label: 'Wait', waitEventConfig,
    });
    const messageFor = (waitEventConfig: Record<string, unknown>, code: string) => {
      const result = FlowNodeSchema.safeParse(waitNode(waitEventConfig));
      expect(result.success).toBe(false);
      return result.error!.issues.find((i) => i.code === code)?.message;
    };

    const channels = {
      // Channel 1 — `retiredKey()`'s `z.never` message, raised when an upgrading
      // author still writes the removed key.
      'the `timeoutMs` tombstone': messageFor({ eventType: 'timer', timeoutMs: 60_000 }, 'invalid_type'),
      // Channel 2 — the `strictObject` `guidance` entry for the `timeout`
      // misspelling. Worse than channel 1: there is no first failure to learn
      // from, so a bad prescription here is the FIRST thing the schema ever says.
      'the `timeout` misspelling guidance': messageFor({ eventType: 'timer', timeout: 60_000 }, 'unrecognized_keys'),
    };

    for (const [channel, message] of Object.entries(channels)) {
      // Anti-vacuity. Delete the guidance entry (or gut the tombstone) and these
      // two fail loudly, rather than the loop below passing on an empty match set.
      expect(message, `${channel}: raised no message at all`).toBeDefined();
      expect(message, `${channel} must still point the author at \`timerDuration\``)
        .toContain('`timerDuration');

      const printed = [...message!.matchAll(/`timerDuration:\s*([^`]+)`/g)].map((m) => m[1]);
      expect(printed.length, `${channel} must PRINT a \`timerDuration\` value to copy`)
        .toBeGreaterThan(0);

      for (const literal of printed) {
        // Read the printed literal exactly as an author retypes it: `'60000'` is
        // a string, a bare `60000` is a number — and that gap IS the defect.
        let authored: unknown;
        try {
          authored = JSON.parse(literal.replace(/^'(.*)'$/, '"$1"'));
        } catch {
          expect.fail(`${channel} prints \`timerDuration: ${literal}\`, which is not a writable literal`);
        }
        const result = FlowNodeSchema.safeParse(waitNode({ eventType: 'timer', timerDuration: authored }));
        expect(
          result.success,
          `${channel} prints \`timerDuration: ${literal}\`, but the schema REJECTS it: `
          + JSON.stringify(result.error?.issues),
        ).toBe(true);
      }
    }
  });

  it('should accept wait node with manual resume', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'wait_manual',
      type: 'wait',
      label: 'Wait for Manual Resume',
      waitEventConfig: { eventType: 'manual' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept wait node without waitEventConfig (backward compatible)', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'wait_simple',
      type: 'wait',
      label: 'Simple Wait',
    });
    expect(result.success).toBe(true);
    expect(result.data?.waitEventConfig).toBeUndefined();
  });
});

describe('BPMN — Boundary Event', () => {
  it('should accept boundary_event node with error event config', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'be_error',
      type: 'boundary_event',
      label: 'Catch API Error',
      boundaryConfig: {
        attachedToNodeId: 'http_call_1',
        eventType: 'error',
        interrupting: true,
        errorCode: 'HTTP_TIMEOUT',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.boundaryConfig?.attachedToNodeId).toBe('http_call_1');
      expect(result.data.boundaryConfig?.eventType).toBe('error');
      expect(result.data.boundaryConfig?.interrupting).toBe(true);
    }
  });

  it('should accept boundary_event with timer (non-interrupting)', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'be_timer',
      type: 'boundary_event',
      label: 'Escalation Timer',
      boundaryConfig: {
        attachedToNodeId: 'approval_node',
        eventType: 'timer',
        interrupting: false,
        timerDuration: 'P3D',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.boundaryConfig?.interrupting).toBe(false);
      expect(result.data.boundaryConfig?.timerDuration).toBe('P3D');
    }
  });

  it('should accept boundary_event with signal', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'be_signal',
      type: 'boundary_event',
      label: 'Catch Cancel Signal',
      boundaryConfig: {
        attachedToNodeId: 'long_task',
        eventType: 'signal',
        signalName: 'user_cancelled',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should default interrupting to true', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'be_default',
      type: 'boundary_event',
      label: 'Default Boundary',
      boundaryConfig: {
        attachedToNodeId: 'some_node',
        eventType: 'cancel',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.boundaryConfig?.interrupting).toBe(true);
    }
  });

  it('should validate a flow with boundary error handling', () => {
    const flow: Flow = {
      name: 'boundary_error_flow',
      label: 'Flow with Boundary Error Handling',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'api_call', type: 'http', label: 'Call External API', timeoutMs: 5000 },
        {
          id: 'api_error_boundary',
          type: 'boundary_event',
          label: 'API Timeout Handler',
          boundaryConfig: {
            attachedToNodeId: 'api_call',
            eventType: 'error',
            interrupting: true,
            errorCode: 'TIMEOUT',
          },
        },
        { id: 'handle_error', type: 'update_record', label: 'Log Error' },
        { id: 'end_success', type: 'end', label: 'End Success' },
        { id: 'end_error', type: 'end', label: 'End Error' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'api_call' },
        { id: 'e2', source: 'api_call', target: 'end_success' },
        { id: 'e3', source: 'api_error_boundary', target: 'handle_error', type: 'fault' },
        { id: 'e4', source: 'handle_error', target: 'end_error' },
      ],
    };

    const result = FlowSchema.safeParse(flow);
    expect(result.success).toBe(true);
    if (result.success) {
      const boundaryNode = result.data.nodes.find(n => n.type === 'boundary_event');
      expect(boundaryNode).toBeDefined();
      expect(boundaryNode!.boundaryConfig?.attachedToNodeId).toBe('api_call');
      const faultEdge = result.data.edges.find(e => e.type === 'fault');
      expect(faultEdge).toBeDefined();
      expect(faultEdge!.source).toBe('api_error_boundary');
    }
  });
});

describe('BPMN — Fault Edge Enhancement', () => {
  it('should accept fault edge type', () => {
    const result = FlowEdgeSchema.parse({
      id: 'fault_1',
      source: 'node_a',
      target: 'error_handler',
      type: 'fault',
      label: 'On Error',
    });
    expect(result.type).toBe('fault');
  });

  it('should accept all edge types: default, fault, conditional', () => {
    const types = ['default', 'fault', 'conditional'] as const;
    types.forEach(type => {
      const result = FlowEdgeSchema.safeParse({
        id: `e_${type}`,
        source: 'a',
        target: 'b',
        type,
      });
      expect(result.success).toBe(true);
    });
  });
});

// #4001 — the authorable flow surface is `.strict()`: an undeclared key used to
// be dropped by zod's default `.strip`, so a trigger binding or config the
// author wrote was quietly ignored — worst on this, the most AI-authored
// surface (cloud#688 / #2419). A node's `config` record deliberately stays
// OPEN: it is per-node-type, owned by the executor's `configSchema`
// (#4027/#4040) and the ADR-0087 conversion layer.
describe('unknown keys are rejected, not stripped (#4001)', () => {
  const unknownKeyIssue = (schema: { safeParse: (v: unknown) => any }, value: unknown) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    return result.error!.issues.find((i: { code: string }) => i.code === 'unrecognized_keys');
  };

  const minimalFlow = {
    name: 'f', label: 'F', type: 'autolaunched' as const,
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  };

  describe('FlowSchema', () => {
    it('rejects an undeclared key instead of silently dropping it', () => {
      const issue = unknownKeyIssue(FlowSchema, { ...minimalFlow, notAKey: 1 });
      expect(issue!.message).toContain('`notAKey`');
    });

    it('points builder vocabulary (steps/connections/trigger) at the canonical keys', () => {
      expect(unknownKeyIssue(FlowSchema, { ...minimalFlow, steps: [] })!.message)
        .toContain('`steps` → `nodes`');
      expect(unknownKeyIssue(FlowSchema, { ...minimalFlow, connections: [] })!.message)
        .toContain('`connections` → `edges`');
      expect(unknownKeyIssue(FlowSchema, { ...minimalFlow, trigger: 'record_change' })!.message)
        .toContain('`trigger` → `type`');
    });

    it('points a top-level object binding at the START node config', () => {
      for (const key of ['object', 'objectName']) {
        const message = unknownKeyIssue(FlowSchema, { ...minimalFlow, [key]: 'task' })!.message;
        expect(message, `\`${key}\` should point at the start node`).toContain('START node');
      }
    });
  });

  describe('FlowNodeSchema', () => {
    it('keeps `config` open — per-node-type keys are the executor contract', () => {
      const parsed = FlowNodeSchema.parse({
        id: 'n1', type: 'create_record', label: 'Create',
        config: { objectName: 'task', fields: { subject: 'hi' }, anyExecutorKey: 1 },
      });
      expect((parsed.config as Record<string, unknown>).anyExecutorKey).toBe(1);
    });

    it('points config synonyms at `config`', () => {
      const node = { id: 'n1', type: 'script', label: 'S' };
      expect(unknownKeyIssue(FlowNodeSchema, { ...node, settings: {} })!.message)
        .toContain('`settings` → `config`');
      expect(unknownKeyIssue(FlowNodeSchema, { ...node, parameters: {} })!.message)
        .toContain('`parameters` → `config`');
    });

    it('explains where node inputs live for an `inputs` key', () => {
      expect(unknownKeyIssue(FlowNodeSchema, { id: 'n1', type: 'script', label: 'S', inputs: {} })!.message)
        .toContain('`config`');
    });
  });

  describe('FlowEdgeSchema', () => {
    it('points from/to at source/target (the n8n/mermaid slip)', () => {
      expect(unknownKeyIssue(FlowEdgeSchema, { id: 'e1', source: 'a', target: 'b', from: 'a' })!.message)
        .toContain('`from` → `source`');
      expect(unknownKeyIssue(FlowEdgeSchema, { id: 'e1', source: 'a', target: 'b', to: 'b' })!.message)
        .toContain('`to` → `target`');
    });

    it('points a guard/when/expression key at `condition`', () => {
      for (const key of ['guard', 'when', 'expression']) {
        expect(unknownKeyIssue(FlowEdgeSchema, { id: 'e1', source: 'a', target: 'b', [key]: 'x > 1' })!.message)
          .toContain(`\`${key}\` → \`condition\``);
      }
    });
  });

  describe('FlowVariableSchema', () => {
    it('rejects an undeclared key with a suggestion', () => {
      expect(unknownKeyIssue(FlowVariableSchema, { name: 'v', type: 'text', is_input: true })!.message)
        .toContain('`is_input` → `isInput`');
    });

    it('points `default` / `initialValue` at `defaultValue` (#4697)', () => {
      // The two words an author reaches for — `default` is what a page state
      // slot and an action param already alias, and `initialValue` is what the
      // designer calls it. Still REJECTED; the alias only makes the rejection
      // say where to go.
      for (const key of ['default', 'initialValue']) {
        expect(unknownKeyIssue(FlowVariableSchema, { name: 'v', type: 'boolean', [key]: false })!.message)
          .toContain(`\`${key}\` → \`defaultValue\``);
      }
    });
  });

  // ── batch 11: the INNER blocks ────────────────────────────────────────────
  //
  // Closing the four outer shells above left six nested authoring blocks on
  // zod's default `.strip`. Same defect, one layer in — a guard put where the
  // author who wrote it was standing.
  //
  // What those six were actually hiding is worth stating, because it is not the
  // obvious case: a slip on a REQUIRED key was always loud (the key then reads
  // as missing). `.strip` swallowed the OPTIONAL half — the mapped input map,
  // the retry budget, `interrupting: false`, `required: true` — i.e. precisely
  // the keys an author adds to CONSTRAIN behaviour, silently replaced by a
  // permissive default.
  describe('the nested authoring blocks (batch 11)', () => {
    const node = (extra: Record<string, unknown>) => ({ id: 'n1', type: 'script', label: 'N', ...extra });

    it('connectorConfig: rejects an undeclared key and points input synonyms at `input`', () => {
      const issue = unknownKeyIssue(FlowNodeSchema, node({
        connectorConfig: { connectorId: 'rest', actionId: 'get', params: {} },
      }));
      expect(issue!.message).toContain("connector_action node's `connectorConfig`");
      expect(issue!.message).toContain('`params` → `input`');
    });

    it('connectorConfig: the silent case was the OPTIONAL half, not the ids', () => {
      // Before this change, `{ connectorId, actionId, params }` parsed clean and
      // the executor dispatched `input ?? {}` — a successful call carrying
      // nothing. A slip on a REQUIRED id was never silent (it reads as missing),
      // which is why this block's history names the input map and not the ids.
      const result = FlowNodeSchema.safeParse(node({
        connectorConfig: { connectorID: 'rest', actionId: 'get' },
      }));
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error!.issues)).toContain('connectorId');
    });

    it('position: rejects a third coordinate rather than dropping it at (0, 0)', () => {
      const issue = unknownKeyIssue(FlowNodeSchema, node({ position: { x: 1, y: 2, z: 3 } }));
      expect(issue!.message).toContain("node's canvas `position`");
      expect(issue!.message).toContain('`z`');
    });

    it('inputSchema: an `optional` key gets the POLARITY, not a bare rename', () => {
      const issue = unknownKeyIssue(FlowNodeSchema, node({
        inputSchema: { url: { type: 'string', optional: true } },
      }));
      // A bare "did you mean `required`" would be a confidently wrong
      // prescription — `optional: true` is `required: FALSE`. The rejection
      // has to say which way to flip the value.
      expect(issue!.message).toContain('required: false');
      expect(issue!.message).not.toContain('`optional` → `required`');
    });

    it('waitEventConfig: renames `signal`, and sends `timeout` to `timerDuration` — never to the tombstone', () => {
      const issue = unknownKeyIssue(FlowNodeSchema, node({
        type: 'wait',
        waitEventConfig: { eventType: 'signal', signal: 'paid', timeout: 60_000 },
      }));
      expect(issue!.message).toContain('`signal` → `signalName`');
      expect(issue!.message).toContain('`timerDuration`');
      // `timeoutMs` is a #4158 tombstone. Pointing a typo at a REMOVED key is
      // the `triggerPhrase → triggerPhrases` chain (ledger finding 7): the
      // author follows the advice straight into a second rejection.
      expect(issue!.message).not.toContain('→ `timeoutMs`');
      expect(issue!.message).not.toContain('→ `onTimeout`');
    });

    it('boundaryConfig: translates BPMN\'s own attribute names', () => {
      const issue = unknownKeyIssue(FlowNodeSchema, node({
        type: 'boundary_event',
        boundaryConfig: { attachedToRef: 'n0', eventType: 'error', cancelActivity: true },
      }));
      expect(issue!.message).toContain('`attachedToRef` → `attachedToNodeId`');
      expect(issue!.message).toContain('`cancelActivity` → `interrupting`');
    });

    it('errorHandling: `backoffMs` is now ACCEPTED — it is the converged spelling (#4964)', () => {
      // This assertion used to be its exact inverse: the block demanded
      // `retryDelayMs` and rejected `backoffMs`, so an author who had read
      // `shared/retry-policy.zod.ts` (where `retryDelayMs` is tombstoned and
      // `backoffMs` prescribed) was rejected for learning the canonical word.
      // Both surfaces now build from `retryPolicyShape()`.
      const result = FlowSchema.safeParse({
        ...minimalFlow,
        errorHandling: { strategy: 'retry', maxRetries: 3, backoffMs: 5000 },
      });
      expect(result.success).toBe(true);
      expect(result.data!.errorHandling!.backoffMs).toBe(5000);
    });

    it('errorHandling: `retryDelayMs` is the tombstone and carries the rename (#4964)', () => {
      const result = FlowSchema.safeParse({
        ...minimalFlow,
        errorHandling: { strategy: 'retry', maxRetries: 3, retryDelayMs: 5000 },
      });
      expect(result.success).toBe(false);
      const message = JSON.stringify(result.error!.issues);
      expect(message).toContain('was removed in @objectstack/spec 17.0.0');
      expect(message).toContain('backoffMs');
      // The prescription must name THIS surface, not only the two #4661 knew
      // about — naming a scope narrower than the truth is what let this
      // divergence read as reviewed for a whole release.
      expect(message).toContain('flow.errorHandling');
    });

    it('errorHandling: `maxAttempts` gets the off-by-one, not a rename', () => {
      const issue = unknownKeyIssue(FlowSchema, {
        ...minimalFlow,
        errorHandling: { strategy: 'retry', maxAttempts: 3 },
      });
      // Renaming alone would silently run one attempt FEWER than asked for:
      // RetryConfig's `maxAttempts` counts the first try, `maxRetries` does not.
      expect(issue!.message).not.toContain('`maxAttempts` → `maxRetries`');
      expect(issue!.message).toContain('maxAttempts - 1');
    });

    it('errorHandling: the `strategy: retry` refinement still runs after the block is strict', () => {
      // The `.superRefine` chains off `strictObject(...)` now. Losing it would
      // re-open #4247's zero-attempt "retry", and nothing else here would tell.
      const result = FlowSchema.safeParse({ ...minimalFlow, errorHandling: { strategy: 'retry' } });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error!.issues)).toContain('requires `maxRetries` >= 1');
    });

    it('every key the six blocks declare still parses', () => {
      const parsed = FlowNodeSchema.parse(node({
        type: 'connector_action',
        connectorConfig: { connectorId: 'c', actionId: 'a', input: { k: 1 } },
        position: { x: 1, y: 2 },
        inputSchema: { p: { type: 'string', required: true, description: 'd' } },
        waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H', signalName: 's' },
        boundaryConfig: {
          attachedToNodeId: 'n0', eventType: 'timer', interrupting: false,
          errorCode: 'E', timerDuration: 'PT5M', signalName: 's',
        },
      }));
      expect(parsed.connectorConfig!.input).toEqual({ k: 1 });
      const flow = FlowSchema.parse({
        ...minimalFlow,
        errorHandling: {
          strategy: 'retry', maxRetries: 2, backoffMs: 10, backoffMultiplier: 2,
          maxRetryDelayMs: 100, jitter: true,
        },
      });
      expect(flow.errorHandling!.jitter).toBe(true);
    });
  });

  // The two shapes this file deliberately leaves open. Asserted, not assumed,
  // so the next sweep reads a test rather than reaching for `strictObject`.
  describe('deliberately still open', () => {
    it('the node `config` slot stays open (ADR-0018 plugin node-type namespace)', () => {
      const parsed = FlowNodeSchema.parse({
        id: 'n1', type: 'some_plugin_node', label: 'P',
        config: { aKeyOnlyThatPluginDeclares: true },
      });
      expect((parsed.config as Record<string, unknown>).aKeyOnlyThatPluginDeclares).toBe(true);
    });

    it('FlowVersionHistorySchema stays open — it is emitted, not authored', () => {
      // Every other object site in flow.zod.ts is closed, so this reads like
      // the last hold-out. It is the file's only WIRE shape (the ledger row has
      // exempted it since it was written): closing it would turn a future
      // emitter-side field into a parse failure for whoever reads history.
      const parsed = FlowVersionHistorySchema.parse({
        flowName: 'f', version: 1, definition: minimalFlow,
        createdAt: '2026-08-03T00:00:00.000Z',
        aFieldSomeFutureWriterStamps: true,
      });
      expect(parsed.flowName).toBe('f');
    });

    it('…but the flow INSIDE a history record is still gated by FlowSchema', () => {
      const result = FlowVersionHistorySchema.safeParse({
        flowName: 'f', version: 1,
        definition: { ...minimalFlow, notAKey: 1 },
        createdAt: '2026-08-03T00:00:00.000Z',
      });
      expect(result.success).toBe(false);
    });
  });
});
