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
 * ## What these schemas are wired to (#4277)
 *
 * Live execute-time contracts: each executor `parse()`s its config against
 * its schema before running (`service-automation`'s `parse-config.ts`), so
 * type and `required` violations refuse the node as a guard. All of these
 * parse the RAW stored config — their typed slots are strings (or `unknown`
 * where values interpolate), so `{token}` templates pass and resolve at the
 * executor's existing interpolation points.
 *
 * ## Unknown keys — closed here too, as of #4001 批 9
 *
 * These contracts used to say "unknown keys are rejected earlier, at
 * `registerFlow()` (the tightened #4059 check); the parse here strips them."
 * The registration walk is still the first and more informative door — it
 * descends NESTED config against the descriptor's JSON Schema, which is how it
 * catches `fields[0].visibleIf` (#3528) and not just top-level typos — but
 * "some other door is closed" is the exact reasoning #4001 exists to retire:
 * the sibling of every guard in this campaign turned out to leave the other
 * doors open, because its author was fixing one bug rather than auditing a
 * surface. A config reaching `parse()` without passing registration (tooling
 * that parses a contract directly, a host composing the engine itself) is no
 * longer silently trimmed.
 *
 * The two doors are kept in agreement by `builtin-node-form-zod-ledger.test.ts`,
 * which reconciles these key sets against the descriptors' in both directions.
 * The per-key prescriptions below are the same curation the registration
 * rejection carries in `FLOW_NODE_UNKNOWN_KEY_GUIDANCE` — the campaign's
 * finding is that a bespoke guard's detection generalizes for free the moment
 * a default flips, while its PROSE does not, so the prose is copied to the new
 * door rather than left behind at the old one.
 *
 * Deliberately absent:
 *  - `assignment` — its config cannot be described by a fixed key set: with no
 *    `assignments` wrapper the TOP-LEVEL config keys ARE the author's variable
 *    names (logic-nodes.ts). The ledger test pins that exemption with its
 *    reason instead of pretending a shape.
 *  - `decision` / `script` / `subflow` / `wait` / `connector_action` — the
 *    descriptor-schemaless class (config-schemas.test.ts). `wait` and
 *    `connector_action` keep their contracts in FlowNodeSchema's sibling
 *    blocks (`waitEventConfig` / `connectorConfig`); the other three publish
 *    executor-derived config contracts in `schemaless-node-config.zod.ts`
 *    (#4278) — separate from this module because they must NOT grow into
 *    descriptor `configSchema`s (the forms they describe stay hand-written in
 *    objectui, reconciled by a test there).
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/** What a rejected key on these contracts silently did before #4001 批 9. */
const BUILTIN_NODE_CONFIG_HISTORY =
  'Until #4001 an undeclared key here was dropped at the execute-time parse — the step still ran and the run '
  + 'still reported success, minus whatever the key was meant to configure.';

/**
 * The two ADR-0087 D2 aliases every CRUD node shares.
 *
 * Both are retired SPELLINGS rather than typos, and both are rewritten at load
 * (`flow-node-crud-object-alias`, `flow-node-crud-filter-alias`). So each
 * prescription has to answer two different readers, and since #4923 the split
 * between them is exact:
 *
 *  - whoever **parses this contract directly** (never went through the load
 *    path) wrote the retired spelling on its own → the fix is the rename;
 *  - whoever **came through the load path** still has the alias only because
 *    the conversion refused to resolve it, and it refuses in exactly one
 *    situation: the canonical key is ALSO present and carries a DIFFERENT
 *    value. An identical twin is deleted by the conversion now, so it can no
 *    longer reach this parse.
 *
 * That second reader is why the prescription names BOTH keys and asks for a
 * decision rather than a deletion. Telling them "the canonical one already won,
 * delete yours" — true while a shadowed alias was left in place — would now be
 * advice to discard the one value the platform deliberately declined to discard
 * on their behalf.
 *
 * `object` also earns its entry on distance alone: `object` → `objectName` is
 * four edits against a threshold of two, so the suggester would say nothing at
 * all for the single most common wrong spelling on this surface.
 */
const CRUD_ALIAS_GUIDANCE = {
  object:
    'The object slot is `objectName`. `object` was the last tenant of the `readAliasedConfig` executor shim; it '
    + 'graduated into the ADR-0087 D2 conversion `flow-node-crud-object-alias` (#3796), which rewrites it at load. '
    + 'If `objectName` is also present, this node names two different objects and the conversion left both keys '
    + 'alone rather than picking for you (#4923) — decide which object this node acts on, put it on `objectName`, '
    + 'and delete `object`.',
  filters:
    'The match map is `filter` (singular). `filters` was a consumer-side executor fallback that graduated into the '
    + 'ADR-0087 D2 conversion `flow-node-crud-filter-alias`, which rewrites it at load; delete it once `filter` '
    + 'carries the pairs. If `filter` is also present, the two carry DIFFERENT match maps and the conversion kept '
    + 'both rather than choosing (#4923) — reconcile them onto `filter`. Beware the half-migrated shape: an empty '
    + '`filter` next to a populated `filters` is what made this alias dangerous enough to declare (#3810 — a '
    + 'match-everything write).',
} as const;

/**
 * `recordId` — the shape the repo's own flow fixtures teach and no CRUD
 * executor has ever read.
 *
 * Measured, not guessed: the #4001 payload scan found it on `get_record`,
 * `update_record` and `delete_record` nodes across `packages/spec`'s flow
 * fixtures and the conversion registry's own illustrations, while every CRUD
 * executor targets rows through `filter` only. Under `.strip` it parsed
 * clean and then addressed nothing — on a `delete_record` that is precisely
 * the #3810 hazard (a node that names no constraint) wearing a key that reads
 * like one.
 *
 * Edit distance reaches none of the declared keys, so without this entry the
 * rejection would name the key and offer nothing.
 */
const CRUD_RECORD_ID_GUIDANCE =
  'CRUD nodes address rows through `filter`, never through a `recordId` key — no executor has ever read one. '
  + "Write the id as a filter VALUE: `filter: { id: '{record.id}' }`, which is the shape the node's own descriptor "
  + 'documents. This matters most on `delete_record`: a config whose only "constraint" is an unread key is a '
  + 'match-everything delete, the #3810 hazard.';

/**
 * `fieldValues` — the AI-authoring dialect that never had a runtime reader.
 *
 * Kept verbatim in intent with `FLOW_NODE_UNKNOWN_KEY_GUIDANCE` in
 * `service-automation`'s engine, which carries it at the registration door.
 * Prime Directive #12's worked example is this exact key: framework#2419
 * proposed a `cfg.fields ?? cfg.fieldValues` runtime alias and it was rejected
 * by design — the fix is the authoring source plus a loud rejection.
 */
const FIELD_VALUES_GUIDANCE =
  'The write map is `fields`. `fieldValues` was an AI-authoring dialect that never had a runtime reader, and a '
  + 'consumer-side `cfg.fields ?? cfg.fieldValues` alias was rejected by design (#2419) — the fix is the authoring '
  + 'source and this rejection, not a runtime fallback.';

/**
 * `update_record` / `delete_record` bind no output — a documented absence, not
 * an oversight (#4045 recorded it "so nobody re-chases it").
 *
 * It is the single likeliest undeclared key on these two shapes, because the
 * four sibling contracts (`get_record`, `create_record`, `map`, `script`,
 * `subflow`) all declare it, and edit distance against the remaining keys
 * reaches nothing.
 */
const NO_OUTPUT_VARIABLE_GUIDANCE =
  'This node binds no output — the executor reads no `outputVariable`, and #4045 recorded that absence '
  + 'deliberately after re-verifying the executor. Its siblings (`get_record`, `create_record`, `map`) do declare '
  + 'one, which is why the key looks universal and is not. To use what was written, follow this node with a '
  + '`get_record` that reads the row back.';

/**
 * Bulk intent has exactly one spelling — `multi` — and the ENGINE named it
 * first (#5393).
 *
 * `EngineUpdateOptions.multi` / `EngineDeleteOptions.multi` have carried this
 * concept since the data layer was written, and `resolveEngineDeleteDispatch`
 * makes it the only thing standing between a predicate write and
 * `driver.deleteMany`. So the flow-authoring surface reuses the word rather
 * than inventing a second one for the same concept (PD #12): one concept, one
 * name, greppable end to end from the node config to the driver call.
 *
 * These four spellings were measured, not guessed: they are what a real
 * `safeParse` was fed while #5225 was being diagnosed, back when NONE of them
 * (including `multi` itself) was declared. Edit distance reaches `multi` from
 * none of them, so without these entries the rejection would name the key and
 * offer nothing — on the single most destructive surface the flow language has.
 *
 * `options` is the wrong-LAYER member of the set: `options: { multi: true }`
 * is the shape of the data-engine call, not of node config. The executor is
 * what performs that translation, and an author who writes the engine's bag
 * into the node has the right concept at the wrong altitude.
 */
const BULK_INTENT_PRESCRIPTION =
  'Bulk intent is declared with `multi: true` — the same word the data engine has always used for it '
  + '(`options.multi`), so the concept keeps one name from node config to driver call. Until #5393 NO spelling of '
  + 'it existed on this node, which is why a predicate write was refused by the engine '
  + '(`… requires an ID or options.multi=true`) and no flow could reach `updateMany`/`deleteMany` at all. Leaving '
  + 'it off is still a valid, deliberate choice: without it the write must name one row by scalar `id`.';

const BULK_INTENT_OPTIONS_PRESCRIPTION =
  'This is the NODE config, not the data engine\'s options bag — declare `multi: true` at the top level of '
  + '`config`, never `options: { multi: true }`. Translating the declared intent into `options.multi` on the '
  + 'engine call is the executor\'s job, and it is the only thing that should be doing it (#5393).';

const CRUD_BULK_INTENT_GUIDANCE = {
  bulk: BULK_INTENT_PRESCRIPTION,
  all: BULK_INTENT_PRESCRIPTION,
  multiple: BULK_INTENT_PRESCRIPTION,
  options: BULK_INTENT_OPTIONS_PRESCRIPTION,
} as const;

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
export const GetRecordConfigSchema = lazySchema(() => strictObject({
  surface: 'this get_record node config',
  history: BUILTIN_NODE_CONFIG_HISTORY,
  guidance: { ...CRUD_ALIAS_GUIDANCE, recordId: CRUD_RECORD_ID_GUIDANCE },
}, {
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
export const CreateRecordConfigSchema = lazySchema(() => strictObject({
  surface: 'this create_record node config',
  history: BUILTIN_NODE_CONFIG_HISTORY,
  // `filters` is deliberately absent: `create_record` has no match map, so
  // `flow-node-crud-filter-alias` never covered it and prescribing `filter`
  // here would point an author at a key this shape does not declare.
  guidance: { object: CRUD_ALIAS_GUIDANCE.object, fieldValues: FIELD_VALUES_GUIDANCE },
}, {
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
export const UpdateRecordConfigSchema = lazySchema(() => strictObject({
  surface: 'this update_record node config',
  history: BUILTIN_NODE_CONFIG_HISTORY,
  guidance: {
    ...CRUD_ALIAS_GUIDANCE,
    ...CRUD_BULK_INTENT_GUIDANCE,
    recordId: CRUD_RECORD_ID_GUIDANCE,
    fieldValues: FIELD_VALUES_GUIDANCE,
    outputVariable: NO_OUTPUT_VARIABLE_GUIDANCE,
  },
}, {
  /** Object to update (execute-time required). */
  objectName: z.string().describe('Object to update'),
  /** Field/value pairs identifying the record(s) to update; an erased template condition refuses the node (#3810). */
  filter: z.record(z.string(), z.unknown()).optional()
    .describe('Field/value pairs identifying the record(s) to update'),
  /** Field values to write; values interpolate `{token}` templates. */
  fields: z.record(z.string(), z.unknown()).optional().describe('Field values to write'),
  /**
   * Declare BULK intent — this node may update EVERY row `filter` matches.
   *
   * Absent or `false` (the default): the executor passes no bulk intent, and
   * the data engine accepts the write only when `filter` names one row by a
   * **scalar** `id`. Anything else — a predicate, or `id: { $in: [...] }` —
   * is refused with `Update requires an ID or options.multi=true`. That
   * refusal is the contract, not a defect to route around: an unbounded write
   * nobody declared is the #3810 hazard with the safety off.
   *
   * `true`: the executor passes `options.multi: true`, so the write lands on
   * `driver.updateMany` and the step's `acted` metric reports the matched row
   * count. Same word the engine has always used for the concept
   * (`EngineUpdateOptions.multi`) — one concept, one name (PD #12).
   *
   * It does not weaken the #3810 erased-condition guard: a node whose authored
   * filter condition interpolated to nothing is still refused before any write,
   * `multi` or not. What it DOES make reachable is the deliberate whole-object
   * write — `multi: true` with no `filter` at all is every row, by declaration.
   */
  multi: z.boolean().optional()
    .describe('Declare bulk intent: update every row the filter matches (default false — a predicate update without it is refused by the engine)'),
}));

export type UpdateRecordConfig = z.input<typeof UpdateRecordConfigSchema>;
export type UpdateRecordConfigParsed = z.infer<typeof UpdateRecordConfigSchema>;

/** `delete_record` node config — what the executor reads. The erased-condition guard matters most here (#3810). */
export const DeleteRecordConfigSchema = lazySchema(() => strictObject({
  surface: 'this delete_record node config',
  history: BUILTIN_NODE_CONFIG_HISTORY,
  guidance: {
    ...CRUD_ALIAS_GUIDANCE,
    ...CRUD_BULK_INTENT_GUIDANCE,
    recordId: CRUD_RECORD_ID_GUIDANCE,
    outputVariable: NO_OUTPUT_VARIABLE_GUIDANCE,
  },
}, {
  /** Object to delete from (execute-time required). */
  objectName: z.string().describe('Object to delete from'),
  /** Field/value pairs identifying the record(s) to delete. */
  filter: z.record(z.string(), z.unknown()).optional()
    .describe('Field/value pairs identifying the record(s) to delete'),
  /**
   * Declare BULK intent — this node may delete EVERY row `filter` matches.
   *
   * Absent or `false` (the default): the executor passes no bulk intent, and
   * the data engine accepts the delete only when `filter` names one row by a
   * **scalar** `id`. Anything else — a predicate, or `id: { $in: [...] }` —
   * is refused with `Delete requires an ID or options.multi=true`. That
   * refusal is the contract, not a defect to route around.
   *
   * `true`: the executor passes `options.multi: true`, so the delete lands on
   * `driver.deleteMany` and the step's `acted` metric reports the deleted row
   * count. Same word the engine has always used for the concept
   * (`EngineDeleteOptions.multi`) — one concept, one name (PD #12).
   *
   * The highest-stakes key on this shape, which is why it is a DECLARATION and
   * not an inference from the filter's shape: the #3810 erased-condition guard
   * still refuses a node whose authored condition interpolated to nothing, but
   * `multi: true` with no `filter` at all is the whole object, by declaration.
   * Write the constraint you mean.
   */
  multi: z.boolean().optional()
    .describe('Declare bulk intent: delete every row the filter matches (default false — a predicate delete without it is refused by the engine)'),
}));

export type DeleteRecordConfig = z.input<typeof DeleteRecordConfigSchema>;
export type DeleteRecordConfigParsed = z.infer<typeof DeleteRecordConfigSchema>;

// ─── screen ──────────────────────────────────────────────────────────

/**
 * One input field on a flat-list `screen` (what the executor forwards into the
 * `ScreenSpec` the client renders). `visibleWhen` is forwarded RAW — the client
 * re-evaluates it against the values collected so far (#3528).
 */
export const ScreenFieldConfigSchema = lazySchema(() => strictObject({
  surface: 'this screen field',
  history: BUILTIN_NODE_CONFIG_HISTORY,
  guidance: {
    visibleIf:
      'The visibility predicate is `visibleWhen` — bare CEL (ADR-0032), forwarded raw and re-evaluated '
      + 'client-side as the user types (#3528). `visibleIf` is four edits away from the right key, which is why '
      + 'the registration-time rejection prints the declared set rather than trusting a suggester; it is also the '
      + 'typo the whole undeclared-key ladder descends from — three diagnostic passes for a field that silently '
      + 'never hid.',
  },
  aliases: {
    /**
     * Action-side spellings (#8382) — the same `visible` / `showWhen` gap
     * #7832 closed on six other `visibleWhen` shapes. One landing key here,
     * no boolean sibling, so this is the simple rename case per this
     * package's alias/guidance rule (`visible-when-alias-guidance.test.ts`
     * header). `visibleIf` stays on `guidance` above (an exact match wins
     * over `aliases` and keeps its bespoke prose); these two are plain
     * renames onto the same target.
     */
    visible: 'visibleWhen',
    showWhen: 'visibleWhen',
  },
}, {
  /** Field name — an item with an empty name is dropped. */
  name: z.string().describe('Field name (the flow variable the value binds to)'),
  /** Display label. */
  label: z.string().optional().describe('Display label'),
  /** Input type (text, number, select, …). */
  type: z.string().optional().describe('Input type'),
  /** Whether the runner requires a value before resume. */
  required: z.boolean().optional().describe('Whether a value is required to submit'),
  /** Choices for a select-style field. */
  options: z.array(strictObject({
    surface: 'this screen field option',
    history: BUILTIN_NODE_CONFIG_HISTORY,
  }, {
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
export const ScreenConfigSchema = lazySchema(() => strictObject({
  surface: 'this screen node config',
  history: BUILTIN_NODE_CONFIG_HISTORY,
  // `object` → `objectName` is four edits against a threshold of two, so the
  // suggester reaches it on no surface at all. It has a whole ADR-0087
  // conversion of its own on the CRUD nodes, which is exactly why an author
  // arrives here already spelling it that way — but `screen` is NOT in that
  // conversion's node-type set, so nothing rewrites it and the rename has to
  // be said out loud.
  aliases: { object: 'objectName' },
}, {
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
export const MapConfigSchema = lazySchema(() => strictObject({
  surface: 'this map node config',
  history: BUILTIN_NODE_CONFIG_HISTORY,
  guidance: {
    flow:
      'The per-item subflow is named by `flowName`. `flow` was an undeclared executor fallback no schema or form '
      + 'described; it graduated into the ADR-0087 D2 conversion `flow-node-map-flow-alias` (#4045), which rewrites '
      + 'it at load. If `flowName` is also present, the two name DIFFERENT subflows and the conversion kept both '
      + 'rather than picking one to run per item (#4923) — decide which flow this is, put it on `flowName`, and '
      + 'delete `flow`.',
  },
}, {
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
