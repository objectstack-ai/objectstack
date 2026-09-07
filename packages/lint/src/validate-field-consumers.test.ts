// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  CARRIER_ROOTS,
  CONSUMER_ROOTS,
  FIELD_NO_CONSUMERS,
  validateFieldConsumers,
} from './validate-field-consumers.js';
import { AUTHORING_COMMANDS, AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';

type AnyRec = Record<string, unknown>;

/**
 * The HotCRM shape, reduced: two objects sharing a field NAME (`tax_rate`),
 * consumed on one and merely carried on the other, plus one field of every
 * verdict the rule distinguishes and one of every exemption it derives.
 */
function corpus(): AnyRec {
  return {
    objects: [
      {
        name: 'inv_product',
        label: 'Product',
        fields: {
          name: { type: 'text', label: 'Name' }, // title field → exempt
          sku: { type: 'text', label: 'SKU' }, // display-only: a view column
          list_price: { type: 'currency', label: 'List Price' }, // live: a formula reads it
          discount: { type: 'formula', expression: 'record.list_price * 0.1' }, // display-only: drawn
          tax_rate: { type: 'percent', label: 'Tax Rate' }, // carrier-only: translation + seed
          is_taxable: { type: 'boolean', label: 'Taxable' }, // inert: nothing at all
          weight: { type: 'number', label: 'Weight' }, // carrier-only: a flow WRITES it
          color: { type: 'text', label: 'Color' }, // carrier-only: a permission grants it
          owner_id: { type: 'lookup', reference: 'sys_user' }, // injected column re-declared → exempt
        },
      },
      {
        name: 'inv_line',
        label: 'Line',
        fields: {
          name: { type: 'text', label: 'Name' },
          product: { type: 'lookup', reference: 'inv_product', displayField: 'sku' },
          qty: { type: 'number', label: 'Qty' },
          tax_rate: { type: 'percent', label: 'Tax Rate' }, // live: its own formula reads it
          total: { type: 'formula', expression: 'record.qty * record.tax_rate' }, // display-only: a page draws it
          status: { type: 'select', label: 'Status' }, // live: a flow filter key
          memo: { type: 'text', label: 'Memo' }, // live: a hook handler reads it
          stage: { type: 'select', label: 'Stage' }, // live: a widget filter through its dataset
          amount: { type: 'currency', label: 'Amount' }, // live: a dataset measure
          order: { type: 'master_detail', reference: 'inv_order' }, // relationship → exempt
        },
      },
    ],
    views: [
      {
        list: {
          type: 'grid',
          data: { provider: 'object', object: 'inv_product' },
          columns: [{ field: 'sku' }, { field: 'discount' }],
        },
      },
    ],
    pages: [
      {
        name: 'line_detail',
        object: 'inv_line',
        regions: [
          {
            name: 'main',
            components: [
              { type: 'record:details', properties: { sections: [{ title: 'Main', fields: ['total', 'product'] }] } },
            ],
          },
        ],
      },
    ],
    flows: [
      {
        name: 'line_flow',
        type: 'record_change',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'inv_line', triggerType: 'record-created' } },
          { id: 'get', type: 'get_record', config: { objectName: 'inv_line', filter: { status: 'open' } } },
          {
            id: 'upd',
            type: 'update_record',
            config: { objectName: 'inv_product', fields: { weight: '{record.qty}' } },
          },
        ],
      },
    ],
    hooks: [
      {
        name: 'line_memo',
        object: 'inv_line',
        events: ['beforeInsert'],
        // Object-aware text scan: `tax_rate` here belongs to inv_line, and must
        // NOT rescue inv_product.tax_rate.
        handler: (ctx: { input: AnyRec }) => {
          ctx.input.memo = `rate ${ctx.input.tax_rate}`;
        },
      },
    ],
    datasets: [
      {
        name: 'line_metrics',
        object: 'inv_line',
        dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
        measures: [{ name: 'sum_amount', aggregate: 'sum', field: 'amount' }],
      },
    ],
    dashboards: [
      {
        name: 'board',
        widgets: [{ id: 'w', type: 'metric', dataset: 'line_metrics', filter: { stage: 'won' }, values: ['sum_amount'] }],
      },
    ],
    translations: [
      { en: { objects: { inv_product: { fields: { tax_rate: { label: 'Tax Rate' }, is_active: { label: 'x' } } } } } },
    ],
    data: [{ object: 'inv_product', records: [{ name: 'Widget', tax_rate: 0.2 }] }],
    permissions: [{ name: 'ps', objects: { inv_product: { allowRead: true, fields: { color: 'read' } } } }],
  };
}

const byPath = (findings: ReturnType<typeof validateFieldConsumers>) =>
  Object.fromEntries(findings.map((f) => [f.path, f]));

describe('validateFieldConsumers (#15922)', () => {
  it('reports exactly the carrier-only and inert fields, by rule id and declaration path', () => {
    const findings = validateFieldConsumers(corpus());
    expect(findings.map((f) => f.rule)).toEqual(Array(findings.length).fill(FIELD_NO_CONSUMERS));
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    expect(findings.map((f) => f.path)).toEqual([
      'objects[0].fields.tax_rate',
      'objects[0].fields.is_taxable',
      'objects[0].fields.weight',
      'objects[0].fields.color',
    ]);
  });

  it('is object-aware: the same name is live on one object and carrier-only on the other', () => {
    const f = byPath(validateFieldConsumers(corpus()));
    const product = f['objects[0].fields.tax_rate'];
    expect(product).toBeDefined();
    expect(product.object).toBe('inv_product');
    expect(product.field).toBe('tax_rate');
    expect(product.verdict).toBe('carrier-only');
    expect(product.message).toContain('"inv_line"');
    expect(product.message).toContain('verdicts are per object');
    expect(f['objects[1].fields.tax_rate']).toBeUndefined();
  });

  it('lists the carrier sites a removal must clean, with their config paths', () => {
    const f = byPath(validateFieldConsumers(corpus()));
    expect(f['objects[0].fields.tax_rate'].carriers).toEqual([
      'translations[0].en.objects.inv_product.fields.tax_rate',
      'data[0].records[0].tax_rate',
    ]);
    // A flow that only WRITES the field carries it.
    expect(f['objects[0].fields.weight'].verdict).toBe('carrier-only');
    expect(f['objects[0].fields.weight'].carriers).toEqual(['flows[0].nodes[2].config.fields.weight']);
    // A field-level permission grant carries it.
    expect(f['objects[0].fields.color'].verdict).toBe('carrier-only');
    expect(f['objects[0].fields.color'].carriers).toEqual(['permissions[0].objects.inv_product.fields.color']);
    // Nothing at all.
    const inert = f['objects[0].fields.is_taxable'];
    expect(inert.verdict).toBe('inert');
    expect(inert.carriers).toEqual([]);
    expect(inert.message).toContain('Verdict: inert');
    expect(inert.message).not.toContain('The same name');
  });

  it('names the roots it scanned on every finding and in the hint', () => {
    const [first] = validateFieldConsumers(corpus());
    expect(first.rootsScanned).toEqual([...CONSUMER_ROOTS, ...CARRIER_ROOTS]);
    expect(first.hint).toContain('test fixtures are never scanned');
    for (const root of ['views', 'pages', 'flows', 'translations', 'data', 'mappings']) {
      expect(first.hint).toContain(root);
    }
  });

  it('carries the positional path on the array-shaped field map', () => {
    const findings = validateFieldConsumers({
      objects: [{ name: 'o', fields: [{ name: 'name', type: 'text' }, { name: 'orphan', type: 'text' }] }],
      views: [{ list: { data: { object: 'o' }, columns: [{ field: 'name' }] } }],
    });
    expect(findings.map((f) => f.path)).toEqual(['objects[0].fields[1]']);
  });

  it('negative control: a stack whose every field is consumed yields no finding', () => {
    const findings = validateFieldConsumers({
      objects: [{ name: 'o', fields: { name: { type: 'text' }, a: { type: 'text' }, b: { type: 'number' } } }],
      views: [{ list: { data: { object: 'o' }, columns: [{ field: 'a' }], filter: { b: 1 } } }],
    });
    expect(findings).toEqual([]);
  });

  describe('skip gate — consumers declared elsewhere', () => {
    it('does not judge a stack with no consumer root', () => {
      expect(validateFieldConsumers({ objects: [{ name: 'o', fields: { x: { type: 'text' } } }] })).toEqual([]);
      expect(
        validateFieldConsumers({
          objects: [{ name: 'o', fields: { x: { type: 'text' } } }],
          translations: [{ en: { objects: { o: { fields: { x: { label: 'X' } } } } } }],
          data: [{ object: 'o', records: [{ x: 1 }] }],
        }),
      ).toEqual([]);
    });

    it('does judge once any consumer root is present, even an unrelated one', () => {
      const findings = validateFieldConsumers({
        objects: [{ name: 'o', fields: { name: { type: 'text' }, x: { type: 'text' } } }],
        apps: [{ name: 'app', navigation: [] }],
      });
      expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.x']);
    });

    it('is silent on an empty or non-record input', () => {
      expect(validateFieldConsumers({})).toEqual([]);
      expect(validateFieldConsumers(null as unknown as AnyRec)).toEqual([]);
      expect(validateFieldConsumers({ objects: [null, { name: 'o' }], views: [{}] })).toEqual([]);
    });
  });

  describe('exemptions, each derived from the spec', () => {
    const withView = (fields: AnyRec, extra: AnyRec = {}): AnyRec => ({
      objects: [{ name: 'o', fields, ...extra }],
      views: [{ list: { data: { object: 'o' }, columns: [] } }],
    });

    it('the derived title field (ADR-0079 ladder) and an explicit nameField', () => {
      expect(validateFieldConsumers(withView({ title: { type: 'text' } }))).toEqual([]);
      expect(validateFieldConsumers(withView({ code: { type: 'text' } }, { nameField: 'code' }))).toEqual([]);
      // A non-title field on the same object is still judged.
      expect(validateFieldConsumers(withView({ title: { type: 'text' }, x: { type: 'text' } })).map((f) => f.field)).toEqual(['x']);
    });

    it('a re-declared registry-injected system column, per object', () => {
      expect(validateFieldConsumers(withView({ name: { type: 'text' }, created_at: { type: 'datetime' } }))).toEqual([]);
      // `ownership: 'none'` injects no owner_id, so a declared one is an ordinary field.
      expect(
        validateFieldConsumers(withView({ name: { type: 'text' }, owner_id: { type: 'lookup' } }, { ownership: 'none' })).map((f) => f.field),
      ).toEqual(['owner_id']);
    });

    it('a master_detail relationship (ADR-0035 readers), never a plain lookup', () => {
      expect(validateFieldConsumers(withView({ name: { type: 'text' }, parent: { type: 'master_detail', reference: 'p' } }))).toEqual([]);
      expect(
        validateFieldConsumers(withView({ name: { type: 'text' }, parent: { type: 'lookup', reference: 'p' } })).map((f) => f.field),
      ).toEqual(['parent']);
    });
  });

  describe('what credits a consumer, per root', () => {
    const one = (extra: AnyRec, field = 'x', type = 'text'): string[] =>
      validateFieldConsumers({
        objects: [{ name: 'o', fields: { name: { type: 'text' }, [field]: { type } } }, { name: 'other', fields: { name: { type: 'text' }, [field]: { type } } }],
        views: [{ list: { data: { object: 'other' }, columns: [{ field }] } }],
        ...extra,
      }).map((f) => `${f.object}.${f.field}`);

    it('a form section field on the view bound to the object', () => {
      expect(one({ views: [{ object: 'o', form: { data: { object: 'o' }, sections: [{ fields: ['x'] }] } }, { list: { data: { object: 'other' }, columns: [{ field: 'x' }] } }] })).toEqual([]);
    });

    it('a page component binding through the page object', () => {
      expect(one({ pages: [{ name: 'p', object: 'o', regions: [{ components: [{ type: 'record:highlights', properties: { fields: ['x'] } }] }] }] })).toEqual([]);
    });

    it('a flow template token resolved through the trigger object', () => {
      expect(one({ flows: [{ name: 'f', nodes: [{ id: 's', type: 'start', config: { objectName: 'o' } }, { id: 'n', type: 'notify', config: { message: 'value {record.x}' } }] }] })).toEqual([]);
      // The same token under a flow bound to the OTHER object credits nothing here.
      expect(one({ flows: [{ name: 'f', nodes: [{ id: 's', type: 'start', config: { objectName: 'other' } }, { id: 'n', type: 'notify', config: { message: '{record.x}' } }] }] })).toEqual(['o.x']);
    });

    it('a validation predicate and a formula inside the object itself', () => {
      expect(
        one({
          objects: [{ name: 'o', fields: { name: { type: 'text' }, x: { type: 'number' }, y: { type: 'formula', expression: 'record.x * 2' } } }, { name: 'other', fields: { name: { type: 'text' } } }],
          views: [{ list: { data: { object: 'o' }, columns: [{ field: 'y' }] } }],
        }),
      ).toEqual([]);
      expect(one({ objects: [{ name: 'o', fields: { name: { type: 'text' }, x: { type: 'number' } }, validations: [{ name: 'v', condition: 'record.x > 0' }] }, { name: 'other', fields: { name: { type: 'text' } } }] })).toEqual([]);
    });

    it('a bare identifier inside an expression is a read; inside prose it is not', () => {
      // The showcase shape: a flow trigger condition naming the field with no `record.` prefix.
      expect(one({ flows: [{ name: 'f', nodes: [{ id: 's', type: 'start', config: { objectName: 'o', condition: 'x >= 5000' } }] }] })).toEqual([]);
      expect(one({ flows: [{ name: 'f', nodes: [{ id: 's', type: 'start', config: { objectName: 'o' }, description: 'fires when x is large' }] }] })).toEqual(['o.x']);
    });

    it('a roll-up reads the CHILD object field it aggregates', () => {
      const findings = validateFieldConsumers({
        objects: [
          { name: 'parent', fields: { name: { type: 'text' }, total: { type: 'summary', summaryOperations: { object: 'child', field: 'amount', function: 'sum' } } } },
          { name: 'child', fields: { name: { type: 'text' }, amount: { type: 'currency' } } },
        ],
        views: [{ list: { data: { object: 'parent' }, columns: [{ field: 'total' }] } }],
      });
      expect(findings).toEqual([]);
    });

    it('a hook body scanned as text, credited to the object the hook declares', () => {
      expect(one({ hooks: [{ name: 'h', object: 'o', events: ['beforeInsert'], body: "if (ctx.input.x) { ctx.input.x = 'v'; }", language: 'js' }] })).toEqual([]);
      expect(one({ hooks: [{ name: 'h', object: 'other', events: ['beforeInsert'], body: 'ctx.input.x' }] })).toEqual(['o.x']);
    });

    it('a text blob that names the object before the token credits that object', () => {
      expect(one({ actions: [{ name: 'a', object: 'other', body: "ctx.api.object('o').update({ x: 1 })" }] })).toEqual([]);
    });

    it('a dataset dimension, and a widget filter resolved through the dataset', () => {
      expect(one({ datasets: [{ name: 'd', object: 'o', dimensions: [{ name: 'dim', field: 'x' }] }] })).toEqual([]);
      expect(one({ datasets: [{ name: 'd', object: 'o' }], dashboards: [{ name: 'b', widgets: [{ id: 'w', dataset: 'd', filter: { x: 'v' } }] }] })).toEqual([]);
    });

    it('a carrier never rescues: translation, seed, mapping, permission grant, flow write', () => {
      expect(one({ translations: [{ en: { objects: { o: { fields: { x: { label: 'X' } } } } } }] })).toEqual(['o.x']);
      expect(one({ data: [{ object: 'o', records: [{ x: 1 }] }] })).toEqual(['o.x']);
      expect(one({ mappings: [{ name: 'm', targetObject: 'o', fieldMapping: [{ source: 'X', target: 'x' }] }] })).toEqual(['o.x']);
      expect(one({ permissions: [{ name: 'p', objects: { o: { fields: { x: 'read' } } } }] })).toEqual(['o.x']);
      expect(one({ flows: [{ name: 'f', nodes: [{ id: 'u', type: 'update_record', config: { objectName: 'o', fields: { x: '1' } } }] }] })).toEqual(['o.x']);
    });

    it('prose naming the field is a carrier, and a vocabulary literal is nothing', () => {
      // `x` inside a description is not a read …
      expect(one({ apps: [{ name: 'app', description: 'shows x to everyone', navigation: [{ type: 'object', objectName: 'o' }] }] })).toEqual(['o.x']);
      // … and `type: 'summary'` never references a field named `summary`.
      expect(one({ apps: [{ name: 'app', navigation: [{ type: 'object', objectName: 'o' }] }] }, 'summary')).toEqual(['o.summary']);
    });
  });

  describe('registry wiring', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateFieldConsumers');

    it('is registered advisory, on all three commands, CLI-only with the full-snapshot reason', () => {
      expect(entry).toBeDefined();
      expect(entry!.tier).toBe('advisory');
      expect(entry!.commands).toEqual(AUTHORING_COMMANDS);
      expect(entry!.surfaces).toEqual(['cli']);
      expect(entry!.surfaceReason).toContain('per-write snapshot');
    });

    it('reaches every command through runAuthoringRules', () => {
      for (const command of AUTHORING_COMMANDS) {
        const found = runAuthoringRules(command, { normalized: corpus() }).filter((f) => f.rule === FIELD_NO_CONSUMERS);
        expect(found.map((f) => f.path), command).toEqual([
          'objects[0].fields.tax_rate',
          'objects[0].fields.is_taxable',
          'objects[0].fields.weight',
          'objects[0].fields.color',
        ]);
      }
    });
  });
});
