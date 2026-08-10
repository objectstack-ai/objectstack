// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Designer form ↔ Zod reconciliation for the IO nodes** (#4045) — the flat
 * sibling of `control-flow-form-zod-ledger.test.ts`.
 *
 * `notify` and `http` each carry TWO descriptions of the same config: the
 * hand-written `configSchema` on the descriptor (drives the Studio form) and an
 * executor-derived Zod in `io-node-config.zod.ts` (the validation contract).
 * The Zod was written by reading the executor — NOT by transcribing the form —
 * so comparing the two key sets is a real reconciliation, not a tautology:
 * a key can only be on both sides if the form offers it AND the executor reads
 * it. `notify.source` (read, never declared — #4050) and a `visibleIf` typo
 * (declared-looking, never read — #3528) are the two failure shapes this pins
 * shut for these nodes.
 *
 * Unlike the control-flow trio there is NO deliberately-shallow ledger here:
 * these configs are flat and fully closed, so the form and the Zod must agree
 * exactly. If an asymmetry ever needs to become deliberate, add a ledger with
 * a reason (the #4078 pattern) rather than widening an expectation.
 *
 * `connector_action` is the third IO node and reconciles differently: its
 * config contract is EMPTY. The executor reads only the declared
 * `FlowNodeSchema.connectorConfig` sibling block, so the descriptor must
 * publish no `configSchema` at all — the one it used to publish declared the
 * block's keys as `config` keys, and the schema-driven Studio form then wrote
 * them where nothing reads (#4045). Pinned below from both directions:
 * schemaless descriptor, and the sibling block's key set.
 *
 * Key sets are read off `.shape` (no `zod` import) for the same dependency
 * reason as the control-flow ledger.
 */

import { describe, it, expect } from 'vitest';
import { NotifyConfigSchema, HttpConfigSchema, FlowNodeSchema } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerNotifyNode } from './notify-node.js';
import { registerHttpNodes } from './http-nodes.js';
import { registerConnectorNodes } from './connector-nodes.js';

const NODES: ReadonlyArray<{ nodeType: string; zod: unknown }> = [
  { nodeType: 'notify', zod: NotifyConfigSchema },
  { nodeType: 'http', zod: HttpConfigSchema },
];

function engineWithIoNodes() {
  const logger: any = {
    info() {}, warn() {}, error() {}, debug() {},
    child() { return logger; },
  };
  const ctx: any = { logger, getService() { throw new Error('none'); } };
  const engine = new AutomationEngine(logger);
  registerNotifyNode(engine, ctx);
  registerHttpNodes(engine, ctx);
  registerConnectorNodes(engine, ctx);
  return engine;
}

const engine = engineWithIoNodes();

/** Top-level keys the designer form offers for a node type. */
function formKeys(nodeType: string): string[] {
  const schema = engine.getActionDescriptor(nodeType)?.configSchema as
    | { properties?: Record<string, unknown> }
    | undefined;
  expect(schema, `${nodeType} should publish a configSchema`).toBeDefined();
  return Object.keys(schema!.properties ?? {}).sort();
}

/** Top-level keys the Zod object accepts, read straight off `.shape`. */
function zodKeys(schema: unknown): string[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  expect(shape, 'the Zod schema should expose a .shape').toBeDefined();
  return Object.keys(shape ?? {}).sort();
}

describe('IO-node form ↔ Zod reconciliation (#4045)', () => {
  it.each(NODES)('$nodeType: the form offers exactly the keys the executor reads', ({ nodeType, zod }) => {
    const form = formKeys(nodeType);
    const zodded = zodKeys(zod);

    // Read by the executor (per the Zod), absent from the form ⇒ reachable only
    // by hand-authored metadata — the `notify.source` shape (#4050).
    expect(
      zodded.filter((k) => !form.includes(k)),
      `${nodeType}: read by the executor but absent from the designer form`,
    ).toEqual([]);

    // Offered by the form, not read by the executor ⇒ an author fills in a
    // Studio field that does nothing — the #3528 shape.
    expect(
      form.filter((k) => !zodded.includes(k)),
      `${nodeType}: offered by the designer form but never read by the executor`,
    ).toEqual([]);
  });

  // #7086 — the reconciliation above compares KEY SETS, which is why a key
  // could agree on both sides while the two descriptions disagreed about the
  // VALUES it accepts. `notify.severity` sat in exactly that gap: the form
  // offered a free-text box and the Zod was a bare `z.string()`, while the
  // describe on both sides spelled out a closed `info | warning | critical`
  // that nothing enforced. Closing only the Zod would have produced the
  // mirror-image drift — a Studio field inviting a value the gate refuses at
  // execute time — so the closed set is pinned as ONE contract here.
  it.each(NODES)('$nodeType: a closed vocabulary is closed on BOTH sides, with the same values', ({ nodeType, zod }) => {
    const props = (engine.getActionDescriptor(nodeType)?.configSchema as
      | { properties?: Record<string, { enum?: unknown }> }
      | undefined)?.properties ?? {};
    const shape = (zod as { shape?: Record<string, unknown> }).shape ?? {};

    /** The declared value set, or `undefined` for an open field. */
    const closedSet = (v: unknown): readonly string[] | undefined => {
      // `.options` also exists on a ZodUnion, where it holds member SCHEMAS
      // (`recipients`, `channels`) — a string-only array is what distinguishes
      // a real value vocabulary from that.
      const opts = (v as { options?: unknown })?.options;
      return Array.isArray(opts) && opts.every((o) => typeof o === 'string')
        ? (opts as readonly string[])
        : undefined;
    };

    for (const key of Object.keys(shape)) {
      const node = shape[key] as { unwrap?: () => unknown };
      // Unwrap the `.optional()` wrapper before asking for the vocabulary.
      const zodSet = closedSet(node) ?? closedSet(node?.unwrap?.());
      const formSet = closedSet(props[key]) ?? (Array.isArray(props[key]?.enum) ? props[key]!.enum as string[] : undefined);

      expect(
        formSet,
        `${nodeType}.${key}: the two descriptions disagree on whether the value set is closed`,
      ).toEqual(zodSet);
    }
  });

  describe('connector_action: the contract is the connectorConfig sibling, not config', () => {
    it('publishes no configSchema (deliberately schemaless)', () => {
      // A published configSchema roots the schema-driven Studio form at
      // `config.<key>`, replacing the hand-written connectorConfig form — the
      // exact drift that made online-authored connector nodes refuse to
      // dispatch (#4045). Also asserted in config-schemas.test.ts alongside
      // the other schemaless types; repeated here so THIS file tells the whole
      // connector reconciliation story.
      expect(engine.getActionDescriptor('connector_action')?.configSchema).toBeUndefined();
    });

    it('the declared sibling block carries exactly the keys the executor reads', () => {
      // The executor reads node.connectorConfig.{connectorId,actionId,input}
      // and nothing else (connector-nodes.ts). The spec side of that contract
      // is FlowNodeSchema.connectorConfig — unwrap the optional wrapper
      // structurally to stay off a direct `zod` dependency.
      //
      // `FlowNodeSchema` is a ZodPipe since #4415 (it parses its own ADR-0031
      // regions), so the declared keys live on the pipe's INPUT side — the
      // authorable half, which is what this reconciliation is about, and the
      // same side the spec's own generators read (`pipeAuthorableSide`).
      const node = FlowNodeSchema as unknown as { def: { in: { shape: Record<string, unknown> } } };
      const prop = node.def.in.shape.connectorConfig as { unwrap?: () => { shape?: Record<string, unknown> } };
      expect(prop, 'FlowNodeSchema should declare connectorConfig').toBeDefined();
      expect(prop.unwrap, 'connectorConfig should be an optional-wrapped object').toBeTypeOf('function');
      const shape = prop.unwrap!().shape;
      expect(shape, 'the unwrapped connectorConfig should expose a .shape').toBeDefined();
      expect(Object.keys(shape ?? {}).sort()).toEqual(['actionId', 'connectorId', 'input']);
    });
  });
});
