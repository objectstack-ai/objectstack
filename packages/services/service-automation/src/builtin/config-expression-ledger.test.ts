// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **configSchema ↔ validation reconciliation** (#4027) — the ratchet that keeps
 * a designer-declared expression property from going unvalidated.
 *
 * Two hand-written lists describe a builtin node's config: the designer
 * `configSchema` its executor publishes, and whatever the validators happen to
 * traverse. Nothing reconciled them, so a property could live in the first and
 * be absent from the second indefinitely — which is exactly how #3528 shipped.
 * `screen.fields[].visibleWhen` was on the designer form from #3304, typed
 * `xExpression: 'expression'` (bare CEL) and offered to authors in Studio, while
 * both validators hardcoded `config.condition` and assumed every other node
 * string was a `{var}` template. The key had zero coverage on either side.
 *
 * This test derives the expression properties from the LIVE descriptors and
 * asserts the ledger in `@objectstack/spec` matches exactly, in both directions:
 *
 *  - a new `xExpression` property with no ledger entry FAILS — the #3528 shape,
 *    caught at CI instead of by an app whose screen cannot be submitted;
 *  - a stale ledger entry for a property no descriptor declares also FAILS, so
 *    the ledger cannot rot into a list of paths that no longer exist.
 *
 * It walks **every** registered builtin — not just `screen` — which is the audit
 * the original triage never did.
 */

import { describe, it, expect } from 'vitest';
import {
  FLOW_NODE_EXPRESSION_PATHS,
  getSchemalessNodeConfigJsonSchemas,
  resolveFlowNodeExpressions,
  type FlowNodeExpressionRole,
} from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
  return { logger: silentLogger(), getService() { throw new Error('none'); } } as any;
}

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  xExpression?: string;
}

/**
 * `xExpression` marker → the dialect the ledger records for that slot.
 *
 * `'template'` maps to `flow-template` (single-brace `{var}`, resolved by
 * `interpolate()`), NOT to `validateExpression`'s `'template'` role — that role
 * enforces the ADR-0032 §3 double-brace text template, a different dialect that
 * rejects a single `{x}`. Conflating the two would fail every valid
 * `loop.collection`.
 */
const ROLE_BY_MARKER: Record<string, FlowNodeExpressionRole> = {
  expression: 'predicate',
  template: 'flow-template',
};

/**
 * Collect every `xExpression`-marked property in a configSchema, as the same
 * `key[].nested` path syntax the ledger uses.
 */
function collectExpressionProps(
  schema: SchemaNode | undefined,
  prefix = '',
): { path: string; marker: string }[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: { path: string; marker: string }[] = [];

  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (!prop || typeof prop !== 'object') continue;
      // An array of objects contributes `key[]`, matching the ledger's syntax
      // for "every element of this array" (`fields[].visibleWhen`).
      const isObjectArray = prop.type === 'array' && !!prop.items;
      const here = prefix
        ? `${prefix}.${key}${isObjectArray ? '[]' : ''}`
        : `${key}${isObjectArray ? '[]' : ''}`;
      if (typeof prop.xExpression === 'string') out.push({ path: here, marker: prop.xExpression });
      if (isObjectArray) out.push(...collectExpressionProps(prop.items, here));
      else out.push(...collectExpressionProps(prop, here));
    }
  }
  return out;
}

const engine = new AutomationEngine(silentLogger());
installBuiltinNodes(engine, ctx());

type DeclaredSlot = { nodeType: string; path: string; role: FlowNodeExpressionRole };

/** Resolve an `xExpression` marker to its ledger role, failing loudly on an unknown one. */
function roleOf(nodeType: string, path: string, marker: string): FlowNodeExpressionRole {
  const role = ROLE_BY_MARKER[marker];
  expect(
    role,
    `${nodeType}.${path} declares an unknown xExpression marker '${marker}' — ` +
    `add it to ROLE_BY_MARKER and teach the validators which dialect it takes`,
  ).toBeDefined();
  return role!;
}

/** Declared expression slots on builtins that publish a descriptor `configSchema`. */
function declaredFromDescriptors(): DeclaredSlot[] {
  const found: DeclaredSlot[] = [];
  for (const descriptor of engine.getActionDescriptors()) {
    const schema = descriptor.configSchema as SchemaNode | undefined;
    for (const { path, marker } of collectExpressionProps(schema)) {
      found.push({ nodeType: descriptor.type, path, role: roleOf(descriptor.type, path, marker) });
    }
  }
  return found;
}

/**
 * Declared expression slots on the builtins that publish NO descriptor
 * `configSchema` (#4439).
 *
 * `script` / `subflow` / `decision` keep their contract in
 * `schemaless-node-config.zod.ts` on purpose, so deriving only from descriptors
 * made their expression slots structurally unreachable by this ratchet — and
 * because the reverse direction fails on a ledger entry nothing declares, they
 * could not be entered by hand either. `decision.conditions[].expression` sat
 * in that hole.
 *
 * Spec hands these over as JSON Schema — the same shape a descriptor's
 * `configSchema` is — so the marker walk below is literally the same function.
 * No second notion of "a declared expression property", which is the
 * duplication a ledger exists to remove.
 */
function declaredFromSchemalessConfigs(): DeclaredSlot[] {
  const found: DeclaredSlot[] = [];
  for (const [nodeType, json] of Object.entries(getSchemalessNodeConfigJsonSchemas())) {
    for (const { path, marker } of collectExpressionProps(json as SchemaNode)) {
      found.push({ nodeType, path, role: roleOf(nodeType, path, marker) });
    }
  }
  return found;
}

/** Every declared expression slot, from BOTH declaration channels. */
function declaredEverywhere(): DeclaredSlot[] {
  return [...declaredFromDescriptors(), ...declaredFromSchemalessConfigs()];
}

const key = (e: { nodeType: string; path: string; role: string }) => `${e.nodeType}.${e.path} (${e.role})`;

describe('configSchema ↔ expression-ledger reconciliation (#4027)', () => {
  it('every xExpression property a builtin declares is in the ledger', () => {
    const declared = declaredEverywhere();
    // Sanity: if this ever empties, the derivation broke and the whole ratchet
    // would pass vacuously — the failure mode a ledger test must not have.
    expect(declared.length, 'no xExpression properties found — derivation is broken').toBeGreaterThan(0);

    const ledger = new Set(FLOW_NODE_EXPRESSION_PATHS.map(key));
    const missing = declared.filter((d) => !ledger.has(key(d))).map(key);
    expect(
      missing,
      `these declared expression properties are validated by NOBODY — add them to ` +
      `FLOW_NODE_EXPRESSION_PATHS so registerFlow and objectstack validate check them (#3528 shape)`,
    ).toEqual([]);
  });

  // Each channel must be non-empty on its own. Merging them into one list would
  // let a broken derivation on either side hide behind the other's results —
  // which is exactly how the schemaless channel went unnoticed until #4439.
  it.each([
    ['descriptor configSchema', declaredFromDescriptors],
    ['schemaless-node-config.zod.ts', declaredFromSchemalessConfigs],
  ] as const)('derives at least one slot from the %s channel', (_channel, derive) => {
    expect(derive().length).toBeGreaterThan(0);
  });

  it('the ledger carries no path a builtin no longer declares', () => {
    const declared = new Set(declaredEverywhere().map(key));
    // Structural predicate surfaces (`config.condition`, `edge.condition`) are
    // not declared config properties on either channel and are deliberately
    // absent from the ledger, so every ledger entry must correspond to a real
    // declared property.
    const stale = FLOW_NODE_EXPRESSION_PATHS.map(key).filter((k) => !declared.has(k));
    expect(stale, 'stale ledger entries — no descriptor or schemaless schema declares these').toEqual([]);
  });

  it('decision.conditions[].expression is covered — the #4439 hole', () => {
    const decision = FLOW_NODE_EXPRESSION_PATHS.find(
      (e) => e.nodeType === 'decision' && e.path === 'conditions[].expression',
    );
    expect(
      decision,
      'the slot a schemaless node could not own: declared bare CEL, walked by neither validator',
    ).toBeDefined();
    expect(decision!.role).toBe('predicate');
    // And it must reach the ledger through the schemaless channel specifically —
    // `decision` publishes no descriptor configSchema, by design.
    expect(declaredFromSchemalessConfigs().map(key)).toContain(key(decision!));
    expect(declaredFromDescriptors().map(key)).not.toContain(key(decision!));
  });

  it('screen.fields[].visibleWhen is covered — the #3528 regression', () => {
    const screen = FLOW_NODE_EXPRESSION_PATHS.find(
      (e) => e.nodeType === 'screen' && e.path === 'fields[].visibleWhen',
    );
    expect(screen, 'the key whose absence made every HotCRM lead conversion un-submittable').toBeDefined();
    // Bare CEL, not a template: `{createOpportunity} == true` must be an error
    // and `createOpportunity == true` must not.
    expect(screen!.role).toBe('predicate');
  });
});

describe('resolveFlowNodeExpressions — path resolution (#4027)', () => {
  it('resolves each element of a field repeater, with its index', () => {
    const found = resolveFlowNodeExpressions('screen', {
      fields: [
        { name: 'createOpportunity', type: 'boolean' },
        { name: 'opportunityName', visibleWhen: 'createOpportunity == true' },
        { name: 'opportunityAmount', visibleWhen: 'createOpportunity == true' },
      ],
    });
    expect(found.map((f) => f.path)).toEqual([
      'fields[1].visibleWhen',
      'fields[2].visibleWhen',
    ]);
    expect(found.every((f) => f.entry.role === 'predicate')).toBe(true);
  });

  it('resolves a top-level flow-template slot, marked as not-validated', () => {
    const found = resolveFlowNodeExpressions('loop', { collection: '{tasks}' });
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe('collection');
    // `flow-template`, not `predicate` — the consumers skip it, which is what
    // keeps a correct single-brace `{tasks}` from being rejected as a CEL brace.
    expect(found[0].entry.role).toBe('flow-template');
  });

  it('skips absent, empty and non-string values rather than inventing findings', () => {
    expect(resolveFlowNodeExpressions('screen', {})).toEqual([]);
    expect(resolveFlowNodeExpressions('screen', { fields: [] })).toEqual([]);
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: '   ' }] })).toEqual([]);
    // A non-string in an expression slot is a type violation for the schema pass
    // to report — not something to hand to a parser.
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: true }] })).toEqual([]);
    // A repeater authored as a non-array must not throw.
    expect(resolveFlowNodeExpressions('screen', { fields: 'nope' })).toEqual([]);
  });

  it('resolves each decision branch predicate, with its index (#4439)', () => {
    const found = resolveFlowNodeExpressions('decision', {
      conditions: [
        { label: 'Yes', expression: "lead.status == 'converted'" },
        { label: 'No', expression: 'true' },
      ],
    });
    expect(found.map((f) => f.path)).toEqual([
      'conditions[0].expression',
      'conditions[1].expression',
    ]);
    expect(found.every((f) => f.entry.role === 'predicate')).toBe(true);
  });

  it('returns nothing for a node type with no declared slots', () => {
    // `config.condition` is a STRUCTURAL surface both validators already walk,
    // deliberately not a ledger entry — and `assignment` declares no slots.
    expect(resolveFlowNodeExpressions('assignment', { condition: 'a == b' })).toEqual([]);
    // A decision branching purely on its edges declares no predicate here.
    expect(resolveFlowNodeExpressions('decision', { condition: 'a == b' })).toEqual([]);
  });
});
