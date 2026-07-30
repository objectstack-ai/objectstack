// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/builtin-node-config
 *
 * Config contracts for the remaining flat builtins — the CRUD quartet
 * (`get_record` / `create_record` / `update_record` / `delete_record`),
 * `screen`, and `map` (#4045). Sibling of `io-node-config.zod.ts`
 * (notify / http) and `control-flow.zod.ts` (loop / parallel / try_catch).
 *
 * ## Provenance — written from the executors, not from the forms
 *
 * Each schema was derived by reading what the executor actually does with
 * `node.config` (`service-automation/builtin/crud-nodes.ts`,
 * `screen-nodes.ts`, `map-node.ts`), **not** by transcribing the hand-written
 * `configSchema` literal on the node's descriptor. The two artifacts are
 * reconciled bidirectionally by `builtin-node-form-zod-ledger.test.ts` in
 * `service-automation`; a Zod copied from the form would make that
 * reconciliation a tautology (#4045).
 *
 * Writing these against the executors is what surfaced the drift the
 * reconciliation exists to catch — keys the executors read that no form
 * offered anywhere (`get_record.fields`, `screen.recordId`, the screen
 * field-item keys `options`/`defaultValue`/`placeholder`, `map.indexVariable`,
 * `map.input`), and the undeclared `map.flow` alias, which graduated into the
 * ADR-0087 D2 conversion layer like `notify.source` before it.
 *
 * ## What these schemas are (and are not) wired to
 *
 * Contract exports only — no engine path `parse()`s a node config with them
 * today, so registering a flow behaves exactly as before. Wiring the executors
 * to parse is deliberately deferred until the #4059 undeclared-key warning has
 * measured a release's worth of real metadata (#4045 step 3b).
 *
 * Deliberately absent:
 *  - `assignment` — its config cannot be described by a fixed key set: with no
 *    `assignments` wrapper the TOP-LEVEL config keys ARE the author's variable
 *    names (logic-nodes.ts). The ledger test pins that exemption with its
 *    reason instead of pretending a shape.
 *  - `decision` / `script` / `subflow` / `wait` / `connector_action` — the
 *    deliberately-schemaless class (config-schemas.test.ts); their contracts
 *    live elsewhere (edges, sibling blocks, conditional forms).
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

// ─── CRUD quartet ────────────────────────────────────────────────────

/**
 * `get_record` node config — what the executor reads.
 *
 * `objectName` is execute-time required (the step is refused without it).
 * `filter` values may carry operator objects (`{"$ne": null}`) and `{token}`
 * templates; a template that resolves to nothing REFUSES the node rather than
 * widening the query (#3810). `limit > 1` selects `find` (a `records` list);
 * otherwise `findOne` (a single `record`).
 */
export const GetRecordConfigSchema = lazySchema(() => z.object({
  /** Object to query (execute-time required). */
  objectName: z.string().describe('Object to query'),
  /** Field/value pairs to match; operator objects and `{token}` templates are legal values. */
  filter: z.record(z.string(), z.unknown()).optional()
    .describe('Field/value pairs to match (operator values like {"$ne": null} are preserved)'),
  /** Field projection — only these fields are read (default: all). */
  fields: z.array(z.string()).optional()
    .describe('Field projection — only these fields are read (default: all)'),
  /** Max records; >1 returns a `records` list, otherwise a single `record`. */
  limit: z.number().optional()
    .describe('Max records to return; >1 switches to a multi-record query'),
  /** Flow variable the result is bound to. */
  outputVariable: z.string().optional().describe('Flow variable the result is bound to'),
}));

export type GetRecordConfig = z.input<typeof GetRecordConfigSchema>;
export type GetRecordConfigParsed = z.infer<typeof GetRecordConfigSchema>;

/** `create_record` node config — what the executor reads. `objectName` is execute-time required. */
export const CreateRecordConfigSchema = lazySchema(() => z.object({
  /** Object to insert into (execute-time required). */
  objectName: z.string().describe('Object to insert into'),
  /** Field values to write on the new record; values interpolate `{token}` templates. */
  fields: z.record(z.string(), z.unknown()).optional()
    .describe('Field values to write on the new record'),
  /** Flow variable bound to the created record (`{var.id}` works even when the driver returns a bare id). */
  outputVariable: z.string().optional()
    .describe('Flow variable bound to the created record'),
}));

export type CreateRecordConfig = z.input<typeof CreateRecordConfigSchema>;
export type CreateRecordConfigParsed = z.infer<typeof CreateRecordConfigSchema>;

/**
 * `update_record` node config — what the executor reads. No `outputVariable`:
 * the executor does not read one (recorded in #4045 so nobody re-chases it).
 */
export const UpdateRecordConfigSchema = lazySchema(() => z.object({
  /** Object to update (execute-time required). */
  objectName: z.string().describe('Object to update'),
  /** Field/value pairs identifying the record(s) to update; an erased template condition refuses the node (#3810). */
  filter: z.record(z.string(), z.unknown()).optional()
    .describe('Field/value pairs identifying the record(s) to update'),
  /** Field values to write; values interpolate `{token}` templates. */
  fields: z.record(z.string(), z.unknown()).optional().describe('Field values to write'),
}));

export type UpdateRecordConfig = z.input<typeof UpdateRecordConfigSchema>;
export type UpdateRecordConfigParsed = z.infer<typeof UpdateRecordConfigSchema>;

/** `delete_record` node config — what the executor reads. The erased-condition guard matters most here (#3810). */
export const DeleteRecordConfigSchema = lazySchema(() => z.object({
  /** Object to delete from (execute-time required). */
  objectName: z.string().describe('Object to delete from'),
  /** Field/value pairs identifying the record(s) to delete. */
  filter: z.record(z.string(), z.unknown()).optional()
    .describe('Field/value pairs identifying the record(s) to delete'),
}));

export type DeleteRecordConfig = z.input<typeof DeleteRecordConfigSchema>;
export type DeleteRecordConfigParsed = z.infer<typeof DeleteRecordConfigSchema>;

// ─── screen ──────────────────────────────────────────────────────────

/**
 * One input field on a flat-list `screen` (what the executor forwards into the
 * `ScreenSpec` the client renders). `visibleWhen` is forwarded RAW — the client
 * re-evaluates it against the values collected so far (#3528).
 */
export const ScreenFieldConfigSchema = lazySchema(() => z.object({
  /** Field name — an item with an empty name is dropped. */
  name: z.string().describe('Field name (the flow variable the value binds to)'),
  /** Display label. */
  label: z.string().optional().describe('Display label'),
  /** Input type (text, number, select, …). */
  type: z.string().optional().describe('Input type'),
  /** Whether the runner requires a value before resume. */
  required: z.boolean().optional().describe('Whether a value is required to submit'),
  /** Choices for a select-style field. */
  options: z.array(z.object({
    value: z.unknown().describe('Stored value'),
    label: z.string().describe('Display label'),
  })).optional().describe('Choices for a select-style field'),
  /** Prefilled value; interpolates `{token}` templates at suspend time. */
  defaultValue: z.unknown().optional().describe('Prefilled value (interpolates {token} templates)'),
  /** Input placeholder text. */
  placeholder: z.string().optional().describe('Input placeholder text'),
  /** Bare-CEL predicate the client re-evaluates as values change (#3528). */
  visibleWhen: z.string().optional().describe('CEL predicate controlling visibility, evaluated client-side'),
}));

export type ScreenFieldConfig = z.input<typeof ScreenFieldConfigSchema>;

/**
 * `screen` node config — what the executor reads.
 *
 * Two mutually exclusive shapes share the key set: a FLAT screen (`fields`,
 * suspends when non-empty unless `waitForInput === false`) and an OBJECT-FORM
 * screen (`objectName` set → the object's full create/edit form; `mode`,
 * `recordId`, `defaults`, `idVariable` apply only there). `recordId` is what
 * makes `mode: 'edit'` usable — it names the record the form edits.
 */
export const ScreenConfigSchema = lazySchema(() => z.object({
  /** Heading (falls back to the node label). Interpolates `{token}`. */
  title: z.string().optional().describe('Heading shown above the screen'),
  /** Body text. Interpolates `{token}`. */
  description: z.string().optional().describe('Body text shown under the heading'),
  /** Input fields for a flat screen; empty means message-only. */
  fields: z.array(ScreenFieldConfigSchema).optional()
    .describe('Input fields collected on this screen'),
  /** Force a pause with no fields (true) or a pass-through despite fields (false). */
  waitForInput: z.boolean().optional()
    .describe('Pause to show the screen even with no fields; false forces a server pass-through'),
  /** Object-form screen: render this object's full create/edit form instead. */
  objectName: z.string().optional()
    .describe("Render this object's full create/edit form instead of a flat field list"),
  /** Object form only: variable bound to the saved record's id. */
  idVariable: z.string().optional()
    .describe("Object form only: variable bound to the saved record's id"),
  /** Object form only: create (default) or edit. Any value other than 'edit' behaves as create. */
  mode: z.enum(['create', 'edit']).optional().describe('Object form only: create or edit'),
  /** Object form only: id of the record `mode: 'edit'` edits. Interpolates `{token}`. */
  recordId: z.string().optional()
    .describe("Object form only: id of the record to edit (required for mode: 'edit' to be useful)"),
  /** Object form only: prefilled values; interpolates `{token}` templates. */
  defaults: z.record(z.string(), z.unknown()).optional()
    .describe('Object form only: prefilled values'),
}));

export type ScreenConfig = z.input<typeof ScreenConfigSchema>;
export type ScreenConfigParsed = z.infer<typeof ScreenConfigSchema>;

// ─── map ─────────────────────────────────────────────────────────────

/**
 * `map` node config — what the executor reads (ADR-0037 sequential
 * multi-instance: a per-item subflow that may durably pause).
 *
 * `flowName` and `collection` are execute-time required. The historical
 * undeclared `flow` alias is NOT part of this contract: the ADR-0087 D2
 * conversion `flow-node-map-flow-alias` rewrites it at load, so the executor
 * only ever sees `flowName` (#4045 — the `notify.source` graduation path).
 */
export const MapConfigSchema = lazySchema(() => z.object({
  /** The collection — a `{token}` template / bare variable name, or an inline array. */
  collection: z.union([z.string(), z.array(z.unknown())])
    .describe('Template/variable resolving to the array to process (an inline array is accepted)'),
  /** The per-item subflow (execute-time required). */
  flowName: z.string().describe('Subflow run for each item — it may pause (e.g. an approval)'),
  /** Variable the current item is bound to inside each item's scope. */
  iteratorVariable: z.string().default('item').describe('Variable holding the current item'),
  /** Optional variable the zero-based index is bound to. */
  indexVariable: z.string().optional().describe('Optional variable holding the current index'),
  /** When items are records, the object they belong to (exposes each item as the child's record). */
  itemObject: z.string().optional()
    .describe("When items are records, the object they belong to (exposes each item as the child's record)"),
  /** Params passed to each item's subflow; interpolated with the item variable bound. */
  input: z.record(z.string(), z.unknown()).optional()
    .describe("Params passed to each item's subflow (interpolated per item)"),
  /** Variable the ordered list of per-item outputs is bound to. */
  outputVariable: z.string().optional()
    .describe("Each item's subflow output, collected in order"),
}));

export type MapConfig = z.input<typeof MapConfigSchema>;
export type MapConfigParsed = z.infer<typeof MapConfigSchema>;
