// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21654] `FlowSchema` refuses a `create_record`, `update_record` or
 * `delete_record` node whose STATIC `config.objectName` names a table of stored
 * metadata — the save-time half of #21624, whose run-time half refuses the same
 * node in `service-automation` before any write.
 *
 * The refusal is an arm of `flowNodeConfigRefusals`, the one judge
 * `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses first) and
 * `objectstack validate` share, so every door that parses a flow meets it:
 * `defineStack`, the registered `flow` type schema the metadata save door
 * validates against, and an artifact's parse — pinned here — and
 * `registerFlow` / `validateStackExpressions`, which call the same judge.
 *
 * The refused set is the run's, by exact name: a write node whose `objectName`
 * is a string the family predicate (`isStoredMetadataBodyObject`) answers for.
 * Not wider — a read node, an ordinary object, a near-miss name and a dynamic
 * target (a `{token}` template, an expression envelope) all parse — and not
 * narrower — every family table, every write node, at any depth.
 */

import { describe, expect, it } from 'vitest';

import {
  STORED_METADATA_BODY_OBJECTS,
  STORED_METADATA_BODY_PRESCRIPTION as KERNEL_PRESCRIPTION,
  isStoredMetadataBodyObject,
} from '../kernel/metadata-type-redaction';
import * as leaf from '../kernel/stored-metadata-body-objects';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ArtifactStagePackageBodySchema, ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { HookSchema } from '../data/hook.zod';
import { flowNodeConfigRefusals } from './flow-node-config-refusals';
import { FlowSchema } from './flow.zod';

const ENTRY_ID = 'flow-write-node-stored-metadata-target-refused';
const FAMILY = [...STORED_METADATA_BODY_OBJECTS];
const WRITE_NODES = ['create_record', 'update_record', 'delete_record'] as const;

type Config = Record<string, unknown>;
type WriteNode = (typeof WRITE_NODES)[number];

/** A whole, valid config for `nodeType` aimed at `objectName` — the accept control's shape. */
function configFor(nodeType: WriteNode | 'get_record', objectName: unknown): Config {
  if (nodeType === 'create_record') return { objectName, fields: { name: 'pin' } };
  if (nodeType === 'update_record') return { objectName, filter: { id: '{record.id}' }, fields: { state: 'archived' } };
  if (nodeType === 'delete_record') return { objectName, filter: { id: '{record.id}' } };
  return { objectName, filter: { id: '{record.id}' }, outputVariable: 'row' };
}

/** start → the probe node → end. */
function flowWith(node: Record<string, unknown>) {
  return {
    name: 'family_write_probe',
    label: 'Family write probe',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'probe', label: 'Probe', ...node },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'probe' },
      { id: 'e2', source: 'probe', target: 'end' },
    ],
  };
}

interface IssueSig { code: string; path: string; message: string }

function issuesOf(flow: unknown): IssueSig[] {
  const r = FlowSchema.safeParse(flow);
  return r.success ? [] : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
}

describe('FlowSchema refuses a write node whose static objectName is a stored-metadata table', () => {
  for (const nodeType of WRITE_NODES) {
    it.each(FAMILY)(`${nodeType} on '%s' is refused at nodes.1.config.objectName, ending on the prescription`, (table) => {
      const issues = issuesOf(flowWith({ type: nodeType, config: configFor(nodeType, table) }));
      expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'custom', path: 'nodes.1.config.objectName' }]);
      const [{ message }] = issues;
      // The judge's own words, never re-spelled — and they name the node, the table and the metadata protocol.
      expect(message).toBe(flowNodeConfigRefusals(nodeType, configFor(nodeType, table))[0]!.message);
      expect(message).toContain(`\`${nodeType}\``);
      expect(message).toContain(`'${table}'`);
      expect(message.endsWith(leaf.STORED_METADATA_BODY_PRESCRIPTION)).toBe(true);
    });
  }

  it('the judge answers with its code, params and path for each write node', () => {
    for (const nodeType of WRITE_NODES) {
      for (const objectName of FAMILY) {
        const refusals = flowNodeConfigRefusals(nodeType, configFor(nodeType, objectName));
        expect(refusals.map(({ code, params, path, source }) => ({ code, params, path, source }))).toEqual([
          { code: 'write-node-stored-metadata-target', params: { nodeType, objectName }, path: 'objectName', source: '' },
        ]);
      }
    }
  });

  it('a write node inside an ADR-0031 region body is refused at the path the author wrote', () => {
    const issues = issuesOf(flowWith({
      type: 'try_catch',
      config: {
        try: { nodes: [{ id: 'inner_write', type: 'delete_record', label: 'Inner', config: configFor('delete_record', 'sys_metadata') }], edges: [] },
        catch: { nodes: [{ id: 'inner_catch', type: 'assignment', label: 'Catch' }], edges: [] },
      },
    }));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'custom', path: 'nodes.1.config.try.nodes.0.config.objectName' },
    ]);
  });

  it('the target is judged whatever else the config carries — a bulk update with no filter is refused too', () => {
    expect(issuesOf(flowWith({ type: 'update_record', config: { objectName: 'sys_metadata', multi: true } })).map((i) => i.path))
      .toEqual(['nodes.1.config.objectName']);
  });
});

describe('what stays accepted at save (lit controls)', () => {
  it.each(WRITE_NODES)('CONTROL: %s on an ordinary object parses', (nodeType) => {
    expect(issuesOf(flowWith({ type: nodeType, config: configFor(nodeType, 'crm_account') }))).toEqual([]);
  });

  it.each(WRITE_NODES)('CONTROL: %s with a dynamic objectName — a {token} template or an expression envelope — is not judged at save', (nodeType) => {
    for (const objectName of ['{record.target}', '{target}']) {
      expect(issuesOf(flowWith({ type: nodeType, config: configFor(nodeType, objectName) })), JSON.stringify(objectName)).toEqual([]);
      expect(flowNodeConfigRefusals(nodeType, configFor(nodeType, objectName))).toEqual([]);
    }
    // #21898: an envelope is no name this arm can read, and no value the node's
    // contract accepts (`objectName` is a string): the value arm refuses it,
    // and this arm still says nothing.
    const envelope = { dialect: 'cel', source: "'sys_metadata'" };
    expect(flowNodeConfigRefusals(nodeType, configFor(nodeType, envelope)).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'node-config-refused-by-contract', path: 'objectName' },
    ]);
  });

  it.each(FAMILY)('CONTROL: a get_record node on \'%s\' is not judged by this arm — a read is not a write', (table) => {
    expect(issuesOf(flowWith({ type: 'get_record', config: configFor('get_record', table) }))).toEqual([]);
  });

  it('the refused set is the family predicate\'s, by exact name — never a second list', () => {
    for (const objectName of [...FAMILY, 'SYS_METADATA', 'sys_metadata_draft', ' sys_metadata', 'sys_meta', 'metadata', 'crm_account']) {
      for (const nodeType of WRITE_NODES) {
        const refused = issuesOf(flowWith({ type: nodeType, config: configFor(nodeType, objectName) })).length > 0;
        expect(refused, `${nodeType} on '${objectName}'`).toBe(isStoredMetadataBodyObject(objectName));
      }
    }
  });
});

describe('every door that parses a flow refuses it', () => {
  const stackWith = (flows: unknown[]) => ({
    manifest: { id: 'com.example.flows', name: 'flows', version: '1.0.0', type: 'app', namespace: 'fws' },
    objects: [{ name: 'fws_note', label: 'Note', fields: { title: { type: 'text', label: 'Title' } } }],
    flows,
  });
  const named = (name: string, objectName: string) => ({ ...flowWith({ type: 'create_record', config: configFor('create_record', objectName) }), name });

  it('defineStack wraps the refusal in its ADR-0112 envelope, at flows.N.nodes.1.config.objectName', () => {
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
    try {
      defineStack(stackWith([named('fws_ok', 'fws_note'), named('fws_family', 'sys_metadata_history')]) as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the family-target write flow').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'flows.1.nodes.1.config.objectName', code: 'custom' },
    ]);
  });

  it('CONTROL: defineStack accepts the ordinary write flow alone', () => {
    expect(() => defineStack(stackWith([named('fws_ok', 'fws_note')]) as never)).not.toThrow();
  });

  it('ObjectStackDefinitionSchema — the stack parse `objectstack validate` runs — refuses it at the same path', () => {
    const refused = ObjectStackDefinitionSchema.safeParse(stackWith([named('fws_family', 'sys_metadata')]));
    expect(refused.success).toBe(false);
    expect(refused.success ? [] : refused.error.issues.map((i) => i.path.join('.'))).toEqual(['flows.0.nodes.1.config.objectName']);
    // CONTROL: the same parse accepts the ordinary target.
    expect(ObjectStackDefinitionSchema.safeParse(stackWith([named('fws_ok', 'fws_note')])).success).toBe(true);
  });

  it('the registered `flow` type schema — what the metadata save door validates against — refuses it too', () => {
    const schema = getMetadataTypeSchema('flow') as unknown as typeof FlowSchema;
    expect(schema).toBeDefined();
    const r = schema.safeParse(named('fws_family', 'sys_metadata'));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.config.objectName']);
    // CONTROL: the same schema accepts the ordinary target.
    expect(schema.safeParse(named('fws_ok', 'fws_note')).success).toBe(true);
  });

  it('an artifact\'s parse refuses it', () => {
    const body = { id: 'com.example.flows', name: 'flows', version: '1.0.0', type: 'app' };
    const refused = ArtifactStagePackageBodySchema.safeParse({ ...body, flows: [named('fws_family', 'sys_metadata')] });
    expect(refused.success).toBe(false);
    expect(refused.success ? [] : refused.error.issues.map((i) => i.path.join('.'))).toEqual(['flows.0.nodes.1.config.objectName']);
    // CONTROL: the ordinary target parses at the same door.
    const accepted = ArtifactStagePackageBodySchema.safeParse({ ...body, flows: [named('fws_ok', 'crm_account')] });
    expect(accepted.success, JSON.stringify(accepted.error?.issues ?? [])).toBe(true);
  });
});

describe('one prescription sentence', () => {
  it('the kernel entry re-exports the leaf\'s prescription, and it names the metadata protocol', () => {
    expect(KERNEL_PRESCRIPTION).toBe(leaf.STORED_METADATA_BODY_PRESCRIPTION);
    expect(KERNEL_PRESCRIPTION).toContain('the metadata protocol');
  });

  it('the hook refusal and the flow refusal end on the same sentence', () => {
    const hook = HookSchema.safeParse({ name: 'stamp', object: 'sys_metadata', events: ['beforeInsert'], body: { language: 'js', source: '1' } });
    expect(hook.success).toBe(false);
    const hookMessage = hook.success ? '' : hook.error.issues[0]!.message;
    const flowMessage = flowNodeConfigRefusals('create_record', configFor('create_record', 'sys_metadata'))[0]!.message;
    expect(hookMessage.endsWith(leaf.STORED_METADATA_BODY_PRESCRIPTION)).toBe(true);
    expect(flowMessage.endsWith(leaf.STORED_METADATA_BODY_PRESCRIPTION)).toBe(true);
  });
});

describe('the ADR-0087 ledger', () => {
  it('registers one D3 entry at protocol 18, with no D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((e) => e.id === ENTRY_ID);
    expect(entries, 'the narrowing needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.conversionIds ?? []).toEqual([]);
    expect(entry!.replacement).toContain('the metadata protocol');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('registers no tombstone: objectName stays in every write node contract', () => {
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => /(Create|Update|Delete)RecordConfig:objectName$/.test(k))).toEqual([]);
    // CONTROL: the flattened table is the real one — it carries a known step-18 tombstone.
    expect(all).toContain('api/RestApiEndpoint:timeout');
  });
});
