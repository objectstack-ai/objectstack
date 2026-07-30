// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Designer form ↔ Zod reconciliation for the CRUD quartet, `screen` and
 * `map`** (#4045) — the third and final panel of the ledger family:
 * `control-flow-form-zod-ledger.test.ts` (region nodes),
 * `io-node-form-zod-ledger.test.ts` (notify / http), and this file.
 *
 * The Zods in `builtin-node-config.zod.ts` were written by reading the
 * executors — not by transcribing the descriptor literals — so the two sides
 * are independent statements and the key-set comparison is a real
 * reconciliation. Writing them is what surfaced this round's drift: keys the
 * executors read that NO form offered (neither the schema-driven online form
 * nor objectui's hand-written offline group):
 *
 *  - `get_record.fields` — query projection, wired straight into
 *    `data.find/findOne`;
 *  - `screen.recordId` — the record `mode: 'edit'` edits, without which the
 *    declared edit mode has no authorable target;
 *  - `screen.fields[].options` / `defaultValue` / `placeholder` — all three
 *    forwarded into the ScreenSpec the client renders;
 *  - `map.indexVariable` / `map.input` — the index binding and the per-item
 *    subflow params.
 *
 * All were reachable only by hand-authored metadata; each is a live, working
 * capability, so the resolution is the one #4045 prescribes for current keys:
 * DECLARE them on the descriptor form. (The undeclared `map.flow` alias went
 * the other route — the ADR-0087 D2 conversion `flow-node-map-flow-alias` —
 * because the declared `flowName` already owns that meaning.)
 *
 * `screen` additionally reconciles one level down: its `fields` repeater item
 * keys are compared bidirectionally too, because #3528 — the incident this
 * whole line descends from — lived in exactly that nested position.
 *
 * Key sets are read off `.shape` (no `zod` import) for the same dependency
 * reason as the sibling ledgers.
 */

import { describe, it, expect } from 'vitest';
import {
  GetRecordConfigSchema,
  CreateRecordConfigSchema,
  UpdateRecordConfigSchema,
  DeleteRecordConfigSchema,
  ScreenConfigSchema,
  ScreenFieldConfigSchema,
  MapConfigSchema,
} from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { registerScreenNodes } from './screen-nodes.js';
import { registerMapNode } from './map-node.js';
import { registerLogicNodes } from './logic-nodes.js';

const NODES: ReadonlyArray<{ nodeType: string; zod: unknown }> = [
  { nodeType: 'get_record', zod: GetRecordConfigSchema },
  { nodeType: 'create_record', zod: CreateRecordConfigSchema },
  { nodeType: 'update_record', zod: UpdateRecordConfigSchema },
  { nodeType: 'delete_record', zod: DeleteRecordConfigSchema },
  { nodeType: 'screen', zod: ScreenConfigSchema },
  { nodeType: 'map', zod: MapConfigSchema },
];

function engineWithNodes() {
  const logger: any = {
    info() {}, warn() {}, error() {}, debug() {},
    child() { return logger; },
  };
  const ctx: any = { logger, getService() { throw new Error('none'); } };
  const engine = new AutomationEngine(logger);
  registerCrudNodes(engine, ctx);
  registerScreenNodes(engine, ctx);
  registerMapNode(engine, ctx);
  registerLogicNodes(engine, ctx);
  return engine;
}

const engine = engineWithNodes();

function formSchema(nodeType: string) {
  const schema = engine.getActionDescriptor(nodeType)?.configSchema as
    | { properties?: Record<string, { items?: { properties?: Record<string, unknown> } }> }
    | undefined;
  expect(schema, `${nodeType} should publish a configSchema`).toBeDefined();
  return schema!;
}

/** Top-level keys the designer form offers for a node type. */
function formKeys(nodeType: string): string[] {
  return Object.keys(formSchema(nodeType).properties ?? {}).sort();
}

/** Top-level keys the Zod object accepts, read straight off `.shape`. */
function zodKeys(schema: unknown): string[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  expect(shape, 'the Zod schema should expose a .shape').toBeDefined();
  return Object.keys(shape ?? {}).sort();
}

describe('CRUD / screen / map form ↔ Zod reconciliation (#4045)', () => {
  it.each(NODES)('$nodeType: the form offers exactly the keys the executor reads', ({ nodeType, zod }) => {
    const form = formKeys(nodeType);
    const zodded = zodKeys(zod);

    // Read by the executor (per the Zod), absent from the form ⇒ reachable only
    // by hand-authored metadata — the shape every finding above had before this
    // change.
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

  it('screen.fields items: the repeater columns match the executor one level down', () => {
    // #3528 lived in a nested repeater column (`visibleWhen`), so for `screen`
    // the top-level comparison is not enough — reconcile the item key sets too.
    const itemProps = formSchema('screen').properties?.fields?.items?.properties;
    expect(itemProps, 'screen.fields.items should declare properties').toBeDefined();
    const formItemKeys = Object.keys(itemProps ?? {}).sort();
    const zodItemKeys = zodKeys(ScreenFieldConfigSchema);

    expect(
      zodItemKeys.filter((k) => !formItemKeys.includes(k)),
      'screen.fields[]: read by the executor but absent from the repeater',
    ).toEqual([]);
    expect(
      formItemKeys.filter((k) => !zodItemKeys.includes(k)),
      'screen.fields[]: offered by the repeater but never read by the executor',
    ).toEqual([]);
  });

  describe('assignment: pinned as un-reconcilable, with the reason on record', () => {
    // `assignment` deliberately has NO entry in builtin-node-config.zod.ts: with
    // no `assignments` wrapper, the TOP-LEVEL config keys ARE the author's
    // variable names (logic-nodes.ts normalizes three shapes). A fixed key set
    // cannot describe that surface, and a Zod with a catchall would reconcile
    // vacuously — every key matches everything. What CAN be pinned is the
    // canonical authoring surface the form offers, so it is:
    it('the form offers exactly the canonical `assignments` map', () => {
      expect(formKeys('assignment')).toEqual(['assignments']);
    });

    it('the assignments slot stays a free-form map (the openness IS the contract)', () => {
      const prop = formSchema('assignment').properties?.assignments as
        | { additionalProperties?: unknown; properties?: unknown }
        | undefined;
      expect(prop).toBeDefined();
      expect(prop!.additionalProperties).toBe(true);
      expect(prop!.properties).toBeUndefined();
    });
  });
});
