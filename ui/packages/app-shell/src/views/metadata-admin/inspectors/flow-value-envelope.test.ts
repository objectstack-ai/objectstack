// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-value-envelope (objectui#7588): which config map is a `value`-role slot,
 * how an expression cell writes its envelope, and the spec's refusal of a
 * malformed one. Every expectation about the envelope is read from
 * `@objectstack/spec/automation`, the same module the helpers import.
 */

import { describe, it, expect } from 'vitest';
import {
  ASSIGNMENT_VALUE_ENVELOPE_REFUSAL,
  CreateRecordConfigSchema,
  FLOW_NODE_EXPRESSION_PATHS,
  ScreenConfigSchema,
  ScriptConfigSchema,
  SubflowConfigSchema,
  UpdateRecordConfigSchema,
  VALUE_SLOT_TEMPLATE_REFUSAL,
} from '@objectstack/spec/automation';
import {
  isEditableValueEnvelope,
  isValueEnvelopeSlot,
  valueEnvelopeRefusal,
  writeValueEnvelope,
} from './flow-value-envelope';
import { FLOW_NODE_CONFIG_TYPES, fieldsForNodeType } from './flow-node-config';

describe('isValueEnvelopeSlot — read off the spec expression ledger (objectui#7588)', () => {
  it('answers true for the assignment node’s `assignments` map', () => {
    expect(isValueEnvelopeSlot('assignment', ['config', 'assignments'])).toBe(true);
  });

  it('answers false for another key, another node type, a non-config block, or no type', () => {
    expect(isValueEnvelopeSlot('assignment', ['config', 'other'])).toBe(false);
    expect(isValueEnvelopeSlot('create_record', ['config', 'assignments'])).toBe(false);
    expect(isValueEnvelopeSlot('assignment', ['connectorConfig', 'assignments'])).toBe(false);
    expect(isValueEnvelopeSlot(undefined, ['config', 'assignments'])).toBe(false);
  });

  it('offers the envelope on exactly the six hand-table key/value maps the ledger names', () => {
    // The key/value editor serves many maps (params, headers, filters, inputs)
    // where an object naming a `dialect` is plain data. Every keyValue field in
    // the designer table is enumerated here. If the ledger declares another
    // `value`-role map, this goes red, and whoever widens it has to confirm
    // that `AssignmentValueSchema` is the right refusal for the new slot.
    //
    // It went red at `@objectstack/spec` 17.5.0, which declares
    // `create_record` / `update_record` `fields.*` as `value`-role slots, and the
    // confirmation it asks for is the next case (objectui#11073). It went red
    // again at 18.0.0-next.0 (ADR-0032 §3), which declares `screen`
    // `defaults.*`, `script` `inputs.*` and `subflow` `input.*` as well; the
    // next case measures the same confirmation for those three (objectui#12030).
    const keyValueFields = FLOW_NODE_CONFIG_TYPES.flatMap((type) =>
      fieldsForNodeType(type)
        .filter((f) => f.kind === 'keyValue')
        .map((f) => ({ type, path: f.path })),
    );
    expect(keyValueFields.length).toBeGreaterThan(3);
    const offered = keyValueFields
      .filter(({ type, path }) => isValueEnvelopeSlot(type, path))
      .map(({ type, path }) => `${type}:${path.join('.')}`);
    expect(offered.sort()).toEqual([
      'assignment:config.assignments',
      'create_record:config.fields',
      'screen:config.defaults',
      'script:config.inputs',
      'subflow:config.input',
      'update_record:config.fields',
    ]);
    // The ledger's whole `value`-role list at 18.0.0-next.0. The six `KEY.*`
    // maps above are the ones a key/value cell serves; the rest are single
    // values (a filter, a collection, a recipient list, a record id) or a
    // nested path, which this editor does not render per entry.
    expect(
      FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.role === 'value').map((e) => `${e.nodeType}:${e.path}`).sort(),
    ).toEqual([
      'assignment:assignments.*',
      'create_record:fields.*',
      'delete_record:filter',
      'get_record:filter',
      'http:body',
      'loop:collection',
      'map:collection',
      'map:input.*',
      'notify:recipients',
      'notify:sourceId',
      'notify:templateData.*',
      'screen:defaults.*',
      'screen:fields[].defaultValue',
      'screen:recordId',
      'script:inputs.*',
      'subflow:input.*',
      'update_record:fields.*',
      'update_record:filter',
    ]);
  });

  it('confirms `AssignmentValueSchema` is the right refusal for every other offered map', () => {
    // The confirmation the case above demands, measured: each node's own config
    // schema refuses a malformed envelope in its map with exactly the messages
    // the editor shows (`valueEnvelopeRefusal`), and accepts the well-formed
    // envelope and a plain literal string it accepts.
    const slots = {
      'create_record:fields': (v: unknown) => CreateRecordConfigSchema.safeParse({ objectName: 'account', fields: { name: v } }),
      'update_record:fields': (v: unknown) => UpdateRecordConfigSchema.safeParse({ objectName: 'account', fields: { name: v } }),
      'screen:defaults': (v: unknown) => ScreenConfigSchema.safeParse({ defaults: { name: v } }),
      'script:inputs': (v: unknown) => ScriptConfigSchema.safeParse({ function: 'my_fn', inputs: { name: v } }),
      'subflow:input': (v: unknown) => SubflowConfigSchema.safeParse({ flowName: 'child_flow', input: { name: v } }),
    } as const;
    const MALFORMED = [{ dialect: 'cel' }, { dialect: 'js', source: 'a' }];
    for (const [slot, parse] of Object.entries(slots)) {
      for (const bad of MALFORMED) {
        const parsed = parse(bad);
        expect(parsed.success, `${slot}: ${JSON.stringify(bad)} is refused`).toBe(false);
        const messages = parsed.success ? [] : parsed.error.issues.map((i) => i.message);
        expect(messages, `${slot}: with the same sentences the editor shows`).toEqual(valueEnvelopeRefusal(bad));
      }
      for (const good of [{ dialect: 'cel', source: 'a + 1' }, 'plain text', 30]) {
        expect(parse(good).success, `${slot}: ${JSON.stringify(good)} is accepted`).toBe(true);
        expect(valueEnvelopeRefusal(good)).toBeNull();
      }
    }
  });
});

describe('writeValueEnvelope — the objectui#3218 write table, applied to a value envelope', () => {
  it('writes a fresh envelope in the slot’s dialect when there is no prior one', () => {
    const out = writeValueEnvelope(undefined, 'amount * 2');
    expect(out).toEqual({ dialect: 'cel', source: 'amount * 2' });
    expect(isEditableValueEnvelope(out)).toBe(true);
    // A plain string prior is text, not an envelope to preserve.
    expect(writeValueEnvelope('{amount}', 'amount')).toEqual({ dialect: 'cel', source: 'amount' });
  });

  it('keeps `meta`, drops the stale `ast`, and replaces `source` on an edit', () => {
    const prior = { dialect: 'cel', source: 'a', ast: { k: 1 }, meta: { rationale: 'why' } };
    expect(writeValueEnvelope(prior, 'b')).toEqual({ dialect: 'cel', source: 'b', meta: { rationale: 'why' } });
    expect(prior.ast).toEqual({ k: 1 });
  });

  it('hands the prior envelope back unchanged when `source` is not edited', () => {
    const prior = { dialect: 'cel', source: 'a', ast: { k: 1 } };
    expect(writeValueEnvelope(prior, 'a')).toBe(prior);
  });
});

describe('valueEnvelopeRefusal — the spec’s AssignmentValueSchema verdict', () => {
  it('accepts a plain string, a literal, and a CEL envelope reaching the stdlib', () => {
    expect(valueEnvelopeRefusal('plain text')).toBeNull();
    expect(valueEnvelopeRefusal(30)).toBeNull();
    expect(valueEnvelopeRefusal({ $ne: null })).toBeNull();
    expect(valueEnvelopeRefusal({ dialect: 'cel', source: 'joinNonEmpty(names, ", ")' })).toBeNull();
  });

  it('refuses a `{token}` string with messages that lead with VALUE_SLOT_TEMPLATE_REFUSAL', () => {
    // Through `@objectstack/spec` 17 a string was `{token}` interpolation and
    // this answered `null`. From 18 (ADR-0032 §3) a value slot reads a string
    // as the literal it spells and refuses a `{…}` token in it (objectui#12030).
    for (const templated of ['{record.name}', 'Hello {name}', '{record.first} {record.last}']) {
      const refusal = valueEnvelopeRefusal(templated);
      expect(refusal, templated).not.toBeNull();
      for (const message of refusal ?? []) expect(message.startsWith(VALUE_SLOT_TEMPLATE_REFUSAL)).toBe(true);
    }
  });

  it('refuses a malformed envelope with messages that lead with ASSIGNMENT_VALUE_ENVELOPE_REFUSAL', () => {
    for (const malformed of [
      { dialect: 'cel' },
      { dialect: 'cel', source: '   ' },
      { dialect: 'template', source: 'Hello {name}' },
      { dialect: 'cel', ast: {} },
    ]) {
      const refusal = valueEnvelopeRefusal(malformed);
      expect(refusal, JSON.stringify(malformed)).not.toBeNull();
      for (const message of refusal ?? []) expect(message.startsWith(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL)).toBe(true);
    }
  });

  it('reads only a string `source` in the slot’s dialect as editable source text', () => {
    expect(isEditableValueEnvelope({ dialect: 'cel', source: '' })).toBe(true);
    expect(isEditableValueEnvelope({ dialect: 'template', source: 'x' })).toBe(false);
    expect(isEditableValueEnvelope({ dialect: 'cel' })).toBe(false);
    expect(isEditableValueEnvelope('{x}')).toBe(false);
  });
});
