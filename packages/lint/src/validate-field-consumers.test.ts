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

  describe('the synthesized layout is a display consumer (#17135)', () => {
    /** An object whose only consumer root is an empty view — nothing NAMES a field. */
    const grouped = (fields: AnyRec, fieldGroups: unknown): AnyRec => ({
      objects: [{ name: 'o', fieldGroups, fields }],
      views: [{ list: { data: { object: 'o' }, columns: [] } }],
    });
    const reported = (stack: AnyRec): string[] => validateFieldConsumers(stack).map((f) => f.field);

    it('a field a declared group places on the layout is drawn, so it is not reported', () => {
      expect(
        validateFieldConsumers(
          grouped(
            { name: { type: 'text' }, street: { type: 'text', group: 'address' } },
            [{ key: 'address', label: 'Address' }],
          ),
        ),
      ).toEqual([]);
    });

    it('only a DECLARED group places anything — an undeclared key is not a placement', () => {
      expect(
        reported(
          grouped(
            { name: { type: 'text' }, street: { type: 'text', group: 'no_such_group' } },
            [{ key: 'address', label: 'Address' }],
          ),
        ),
      ).toEqual(['street']);
    });

    it('never the trailing flat bucket: an ungrouped field beside a grouped one is still judged', () => {
      expect(
        reported(
          grouped(
            { name: { type: 'text' }, street: { type: 'text', group: 'address' }, loose: { type: 'text' } },
            [{ key: 'address', label: 'Address' }],
          ),
        ),
      ).toEqual(['loose']);
    });

    it('an object declaring no field groups keeps every verdict it had', () => {
      expect(reported(grouped({ name: { type: 'text' }, loose: { type: 'text' } }, undefined))).toEqual(['loose']);
      expect(reported(grouped({ name: { type: 'text' }, loose: { type: 'text' } }, []))).toEqual(['loose']);
    });

    it('a hidden field earns nothing here — the derivation never draws one', () => {
      expect(
        reported(
          grouped(
            {
              name: { type: 'text' },
              street: { type: 'text', group: 'address' },
              secret: { type: 'text', group: 'address', hidden: true },
            },
            [{ key: 'address', label: 'Address' }],
          ),
        ),
      ).toEqual(['secret']);
    });

    it('reaches the array-shaped field map too', () => {
      expect(
        validateFieldConsumers({
          objects: [
            {
              name: 'o',
              fieldGroups: [{ key: 'address', label: 'Address' }],
              fields: [{ name: 'name', type: 'text' }, { name: 'street', type: 'text', group: 'address' }],
            },
          ],
          views: [{ list: { data: { object: 'o' }, columns: [] } }],
        }),
      ).toEqual([]);
    });
  });

  describe('an upsert identity inside a carrier root is a read (#17135)', () => {
    /** `x` is declared, `hidden` and `readonly` — the seeder-only identity shape. */
    const seeded = (extra: AnyRec): AnyRec => ({
      objects: [{ name: 'o', fields: { name: { type: 'text' }, x: { type: 'text', hidden: true, readonly: true } } }],
      views: [{ list: { data: { object: 'o' }, columns: [] } }],
      ...extra,
    });
    const reported = (stack: AnyRec): string[] => validateFieldConsumers(stack).map((f) => f.field);

    it("a seed's externalId names the column the loader matches on", () => {
      expect(reported(seeded({ data: [{ object: 'o', mode: 'upsert', externalId: 'x', records: [{ x: 'k1' }] }] }))).toEqual([]);
    });

    it('a composite externalId credits every member', () => {
      expect(
        validateFieldConsumers({
          objects: [{ name: 'o', fields: { name: { type: 'text' }, a: { type: 'text' }, b: { type: 'text' } } }],
          views: [{ list: { data: { object: 'o' }, columns: [] } }],
          data: [{ object: 'o', mode: 'upsert', externalId: ['a', 'b'], records: [{ a: '1', b: '2' }] }],
        }),
      ).toEqual([]);
    });

    it("an import mapping's upsertKey is the same read", () => {
      expect(
        reported(seeded({ mappings: [{ name: 'm', targetObject: 'o', mode: 'upsert', upsertKey: ['x'] }] })),
      ).toEqual([]);
    });

    it('⛔ hidden is not exempt — the matched pair differs only in the identity role', () => {
      // Same declaration, same object, no upsert matching on it.
      expect(reported(seeded({ data: [{ object: 'o', records: [{ x: 'k1' }] }] }))).toEqual(['x']);
      // A seeded VALUE stays a carrier even when an upsert matches on ANOTHER column.
      expect(
        reported(seeded({ data: [{ object: 'o', mode: 'upsert', externalId: 'name', records: [{ x: 'k1' }] }] })),
      ).toEqual(['x']);
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

/**
 * [#18550] The `displayField` consumer edge must refuse a `reference` carrier
 * it cannot read, rather than recording no edge at all.
 *
 * One of the measured residue sites of ruling letter E item 2 on #18095. The
 * read was `strName(field.reference)`, which answers `undefined` for an
 * unreadable carrier exactly as it does for an absent one — so a field a
 * lookup DOES display was recorded as consumed by nobody, and this rule then
 * reported it as carrier-only. The ledger under-reported, and the finding
 * pointed at the displayed field instead of the unreadable carrier.
 *
 * Absence keeps its answer: with no target there is no object to look a
 * `displayField` up on, so no edge is recorded and nothing throws.
 */
describe('validateFieldConsumers — an unreadable `reference` carrier is refused (#18550)', () => {
  const stackWith = (carrier: AnyRec): AnyRec => ({
    objects: [
      { name: 'crm_account', fields: { name: { type: 'text' }, legal_name: { type: 'text' } } },
      {
        name: 'crm_contact',
        fields: {
          name: { type: 'text' },
          account: { type: 'lookup', displayField: 'legal_name', ...carrier },
        },
      },
    ],
    // A consumer root OTHER than `objects` is this rule's entry condition
    // (`hasConsumerRoot`): with only `objects` present it returns early and
    // never walks a field, so a fixture without one would make every case
    // below vacuous.
    views: [{ name: 'contact_list', object: 'crm_contact', viewKind: 'list', columns: ['name'] }],
  });

  it('control: a READABLE carrier records the `displayField` edge, so the target is not carrier-only', () => {
    const findings = validateFieldConsumers(stackWith({ reference: 'crm_account' }));
    expect(findings.map((f) => f.path)).not.toContain('objects[0].fields.legal_name');
  });

  it('an OBJECT-valued carrier REFUSES — ⛔ not a silent missing edge', () => {
    const run = () => validateFieldConsumers(stackWith({ reference: { object: 'crm_account' } }));
    expect(run).toThrow(TypeError);
    // [#19289] `walkObject` asks `referenceTargetOf`, which reads the carrier
    // through `referenceCarrierOf` and so names itself in the refusal.
    expect(run).toThrow(/referenceTargetOf/);
    expect(run).toThrow(/`reference` is an object/);
    expect(run).toThrow(/FieldSchema declares it as an optional STRING/);
  });

  it.each([
    ['undefined (the key omitted)', {}],
    ['null (`StrictField` declares it nullable)', { reference: null }],
    ["'' (names no object)", { reference: '' }],
  ])('absence records no edge and does NOT throw: %s', (_label, carrier) => {
    // With no target there is no object to resolve `displayField` against, so
    // the displayed field is genuinely unconsumed here — the rule's ordinary
    // answer, reached without a throw.
    const findings = validateFieldConsumers(stackWith(carrier as AnyRec));
    expect(findings.map((f) => f.path)).toContain('objects[0].fields.legal_name');
  });
});

/**
 * [#19289] The `displayField` consumer edge of a `{ type: 'user' }` field lands
 * on `sys_user` even when no `reference` is written — the fourth defect of the
 * implicit-target census.
 *
 * This walk has NO type gate, so a `user` field reaches it, and the read went
 * through `referenceCarrierOf` — what the CARRIER says.
 * `IMPLICIT_REFERENCE_TARGETS` (`packages/spec/src/data/field-value.zod.ts`)
 * declares a `user` field's target "a CONSTANT OF THE TYPE", with metadata
 * authored without `reference` "fully specified, not under-specified", so the
 * carrier answered `undefined` and the edge onto `sys_user.<displayField>` was
 * never recorded. The field that column DOES display was then reported
 * consumed by nobody — the same silent under-record #19198 and #19264 repaired
 * at their own consumers.
 *
 * ⛔ Materiality, stated so the pin is not read wider than it is: the edge is
 * only recordable where `sys_user` is compiled INTO the linted stack, which is
 * what this fixture arranges. Where it is not, the ledger never declared the
 * target and the outcome is unchanged.
 *
 * The repair is not an arbiter swap at the call — the synthesized
 * `{ reference: field.reference }` literal threw `type` away before the arbiter
 * could see it. The field is now passed through whole.
 */
describe('[#19289] validateFieldConsumers — a `user` field displays a field on `sys_user`', () => {
  const stackWithUser = (assignee: AnyRec): AnyRec => ({
    objects: [
      { name: 'sys_user', fields: { name: { type: 'text' }, full_name: { type: 'text' } } },
      {
        name: 'crm_task',
        fields: {
          name: { type: 'text' },
          assignee: { type: 'user', displayField: 'full_name', ...assignee },
        },
      },
    ],
    views: [{ name: 'task_list', object: 'crm_task', viewKind: 'list', columns: ['name'] }],
  });

  /** Paths this rule reports — the displayed field appearing here IS the defect. */
  const pathsFor = (assignee: AnyRec) => validateFieldConsumers(stackWithUser(assignee)).map((f) => f.path);

  it('THE DEFECT: with no `reference`, `sys_user.full_name` is no longer reported as consumed by nobody', () => {
    expect(pathsFor({})).not.toContain('objects[0].fields.full_name');
  });

  it('the two legal spellings of one fully-specified field record the same edge', () => {
    expect(pathsFor({})).toEqual(pathsFor({ reference: 'sys_user' }));
  });

  it('control: an UNREADABLE carrier still REFUSES — the implicit target does not swallow it', () => {
    const run = () => validateFieldConsumers(stackWithUser({ reference: { object: 'sys_user' } }));
    expect(run).toThrow(TypeError);
    expect(run).toThrow(/`reference` is an object/);
  });
});

/**
 * [#20929] An inline grid column's `name` names a field of the CHILD object.
 *
 * `name` is a `LITERAL_KEYS` literal, so the general walk never read a column's
 * `name`, and the recommended identity-only column (`{ name: 'qty' }`) says
 * nothing else. `os validate` then warned that a field the grid draws was
 * inert. The fix reads `name` at that one position, against the child object
 * each carrier resolves. It does not drop `name` from the literals.
 *
 * One fixture carries every assertion. `inv` is the parent and `line` the
 * child, related by `line.invoice`. On `line`, `qty` is named only by the grid
 * column under test, and `memo` is named nowhere: `memo` is the control, still
 * reported. The parent declares a `qty` of its own that nothing reads, so it is
 * reported too. A column credited to the wrong object shows up as `inv.qty`
 * going quiet while `line.qty` stays reported.
 */
describe('[#20929] validateFieldConsumers — an inline grid column names a field of the CHILD object', () => {
  const data = { provider: 'object', object: 'inv' };
  const columns = [{ name: 'qty' }];

  const stack = (relationship: AnyRec, view: AnyRec = {}, extra: AnyRec = {}): AnyRec => ({
    objects: [
      { name: 'inv', fields: { name: { type: 'text' }, qty: { type: 'number' } } },
      {
        name: 'line',
        fields: {
          name: { type: 'text' },
          invoice: { type: 'master_detail', reference: 'inv', ...relationship },
          qty: { type: 'number' },
          memo: { type: 'text' },
        },
      },
    ],
    views: [{ list: { type: 'grid', data, columns: [{ field: 'name' }] }, ...view }],
    ...extra,
  });

  /** `object.field` → verdict, for every field the rule reports. */
  const verdicts = (s: AnyRec): Record<string, string> =>
    Object.fromEntries(validateFieldConsumers(s).map((f) => [`${f.object}.${f.field}`, f.verdict]));

  /** The child's `qty` credited; the parent's `qty` and the control still reported. */
  const CREDITED = { 'inv.qty': 'inert', 'line.memo': 'inert' };

  it('baseline: with no grid anywhere, all three fields are reported inert', () => {
    expect(verdicts(stack({}))).toEqual({ 'inv.qty': 'inert', 'line.qty': 'inert', 'line.memo': 'inert' });
  });

  it("a relationship field's `inlineColumns`: the child is the object that DECLARES the field, not the related one", () => {
    expect(verdicts(stack({ inlineEdit: 'grid', inlineColumns: columns }))).toEqual(CREDITED);
  });

  it("a form view's `subforms[].columns`: the child is the entry's `childObject`, not the view's object", () => {
    const form = { type: 'simple', data, subforms: [{ childObject: 'line', columns }] };
    expect(verdicts(stack({}, { form }))).toEqual(CREDITED);
  });

  it("each `formViews` entry's `subforms[].columns`, the same way", () => {
    const edit = { type: 'simple', data, subforms: [{ childObject: 'line', columns }] };
    expect(verdicts(stack({}, { formViews: { edit } }))).toEqual(CREDITED);
  });

  it('`inlineColumns` on a field that does not set `inlineEdit` draws no grid: a carrier, listed for removal', () => {
    const findings = validateFieldConsumers(stack({ inlineColumns: columns }));
    expect(Object.fromEntries(findings.map((f) => [`${f.object}.${f.field}`, f.verdict]))).toEqual({
      'inv.qty': 'inert',
      'line.qty': 'carrier-only',
      'line.memo': 'inert',
    });
    expect(findings.find((f) => f.object === 'line' && f.field === 'qty')?.carriers).toEqual([
      'objects[1].fields.invoice.inlineColumns[0].name',
    ]);
  });

  it('`name` anywhere else stays a literal: a dataset measure named like the field credits nothing', () => {
    const datasets = [{ name: 'line_stats', object: 'line', measures: [{ name: 'qty', aggregate: 'count' }] }];
    expect(verdicts(stack({}, {}, { datasets }))).toEqual({ 'inv.qty': 'inert', 'line.qty': 'inert', 'line.memo': 'inert' });
  });
});

/**
 * [#20951] Two more positions where an inline child collection names a CHILD
 * field without the walk crediting it there.
 *
 * Site 1 — a `subforms` entry's child-field keys, read per key. `amountField`
 * ("Numeric child column summed for the running total") and
 * `relationshipField` ("FK on the child pointing back to the parent") name
 * fields of the entry's `childObject`; `totalField` ("Parent field to receive
 * the rolled-up sum") names a field of the PARENT. The walk carried the
 * parent's context into the entry, so the child's amount column read as inert
 * while a same-named parent field was credited in its place.
 *
 * Site 2 — a DERIVED inline grid. A relationship field with `inlineEdit` and
 * no `inlineColumns`, or a `subforms` entry with no `columns`, draws the
 * columns `deriveInlineGridColumns` (`@objectstack/spec/data`) derives from
 * the child object. The rule credits exactly those, and nothing the derivation
 * leaves out.
 *
 * `inv` is the parent, `line` the child. Each declares a field the other's
 * key names, so a key read against the wrong object shows up as the wrong
 * one of the pair going quiet.
 */
describe('[#20951] validateFieldConsumers — a child collection credits its child fields per key, and a derived grid its derived columns', () => {
  const data = { provider: 'object', object: 'inv' };
  const MASTER_DETAIL = { type: 'master_detail', reference: 'inv' };

  const stack = (lineFields: AnyRec, view: AnyRec = {}, invoice: AnyRec = MASTER_DETAIL): AnyRec => ({
    objects: [
      { name: 'inv', fields: { name: { type: 'text' }, total: { type: 'number' }, line_total: { type: 'number' } } },
      { name: 'line', fields: { name: { type: 'text' }, invoice, ...lineFields } },
    ],
    views: [{ list: { type: 'grid', data, columns: [{ field: 'name' }] }, ...view }],
  });

  /** `object.field` → verdict, for every field the rule reports. */
  const verdicts = (s: AnyRec): Record<string, string> =>
    Object.fromEntries(validateFieldConsumers(s).map((f) => [`${f.object}.${f.field}`, f.verdict]));

  describe('site 1: `amountField` and `relationshipField` on the child, `totalField` on the parent', () => {
    const lineFields = { qty: { type: 'number' }, line_total: { type: 'number' }, total: { type: 'number' }, memo: { type: 'text' } };
    const entry = (extra: AnyRec): AnyRec => ({ childObject: 'line', columns: [{ name: 'qty' }], ...extra });

    it('baseline: with neither key, every field but the grid column is reported', () => {
      const form = { type: 'simple', data, subforms: [entry({})] };
      expect(verdicts(stack(lineFields, { form }))).toEqual({
        'inv.total': 'inert',
        'inv.line_total': 'inert',
        'line.line_total': 'inert',
        'line.total': 'inert',
        'line.memo': 'inert',
      });
    });

    it("`amountField` credits the CHILD's field, `totalField` the PARENT's — each same-named counterpart stays reported", () => {
      const form = { type: 'simple', data, subforms: [entry({ amountField: 'line_total', totalField: 'total' })] };
      expect(verdicts(stack(lineFields, { form }))).toEqual({
        'inv.line_total': 'inert',
        'line.total': 'inert',
        'line.memo': 'inert',
      });
    });

    it('each `formViews` entry, the same way', () => {
      const edit = { type: 'simple', data, subforms: [entry({ amountField: 'line_total', totalField: 'total' })] };
      expect(verdicts(stack(lineFields, { formViews: { edit } }))).toEqual({
        'inv.line_total': 'inert',
        'line.total': 'inert',
        'line.memo': 'inert',
      });
    });

    it('`relationshipField` credits the child FK the rows are loaded and saved by', () => {
      const link = { type: 'lookup', reference: 'inv' };
      const without = { type: 'simple', data, subforms: [entry({ amountField: 'line_total', totalField: 'total' })] };
      const withKey = { type: 'simple', data, subforms: [entry({ amountField: 'line_total', totalField: 'total', relationshipField: 'link' })] };
      expect(verdicts(stack({ ...lineFields, link }, { form: without }))['line.link']).toBe('inert');
      expect(verdicts(stack({ ...lineFields, link }, { form: withKey }))['line.link']).toBeUndefined();
    });

    it('control: each key is read against its own object, so swapped keys credit the swapped pair', () => {
      const form = { type: 'simple', data, subforms: [entry({ amountField: 'total', totalField: 'line_total' })] };
      // `amountField: 'total'` names the CHILD's `total`, `totalField:
      // 'line_total'` the PARENT's `line_total` — what the keys literally say.
      expect(verdicts(stack(lineFields, { form }))).toEqual({
        'inv.total': 'inert',
        'line.line_total': 'inert',
        'line.memo': 'inert',
      });
    });
  });

  describe('site 2: a grid with no authored columns draws the derived ones', () => {
    /** Three the derivation draws, and three it leaves out: JSON, `hidden`, `readonly`. */
    const lineFields = {
      qty: { type: 'number' },
      line_total: { type: 'currency' },
      memo: { type: 'text' },
      blob: { type: 'json' },
      secret: { type: 'text', hidden: true },
      frozen: { type: 'number', readonly: true },
    };
    /** The parent's two fields (nothing reads them) and the three the derivation leaves out. */
    const DERIVED = {
      'inv.total': 'inert',
      'inv.line_total': 'inert',
      'line.blob': 'inert',
      'line.secret': 'inert',
      'line.frozen': 'inert',
    };

    it('baseline: without `inlineEdit` no grid is drawn, and every child field is reported', () => {
      expect(verdicts(stack(lineFields))).toEqual({
        ...DERIVED,
        'line.qty': 'inert',
        'line.line_total': 'inert',
        'line.memo': 'inert',
      });
    });

    it.each([['grid'], ['form'], [true]])('`inlineEdit: %s` with no `inlineColumns` credits the derived columns, and only them', (inlineEdit) => {
      expect(verdicts(stack(lineFields, {}, { ...MASTER_DETAIL, inlineEdit }))).toEqual(DERIVED);
    });

    it('an empty `inlineColumns` is no authored list: the grid is derived', () => {
      expect(verdicts(stack(lineFields, {}, { ...MASTER_DETAIL, inlineEdit: 'grid', inlineColumns: [] }))).toEqual(DERIVED);
    });

    it('an authored `inlineColumns` replaces the derivation: only the named column is credited', () => {
      expect(verdicts(stack(lineFields, {}, { ...MASTER_DETAIL, inlineEdit: 'grid', inlineColumns: [{ name: 'qty' }] }))).toEqual({
        ...DERIVED,
        'line.line_total': 'inert',
        'line.memo': 'inert',
      });
    });

    it('`inlineEdit` on a field that is not a relationship draws no grid', () => {
      expect(verdicts(stack({ ...lineFields, tag: { type: 'text', inlineEdit: 'grid' } }))).toEqual({
        ...DERIVED,
        'line.qty': 'inert',
        'line.line_total': 'inert',
        'line.memo': 'inert',
        'line.tag': 'inert',
      });
    });

    it('a column the budget collapses into the chooser is credited too: it is drawn on demand, never dropped', () => {
      const wide = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, { type: 'text' }]));
      const findings = verdicts(stack(wide, {}, { ...MASTER_DETAIL, inlineEdit: 'grid' }));
      expect(findings).toEqual({ 'inv.total': 'inert', 'inv.line_total': 'inert' });
    });

    it('a `subforms` entry with no `columns` credits the derived columns of its `childObject`', () => {
      const form = { type: 'simple', data, subforms: [{ childObject: 'line' }] };
      expect(verdicts(stack(lineFields, { form }))).toEqual(DERIVED);
    });

    it("a `subforms` entry's derivation excludes the `relationshipField` it names, which that key credits instead", () => {
      const link = { type: 'lookup', reference: 'inv' };
      const form = { type: 'simple', data, subforms: [{ childObject: 'line', relationshipField: 'link' }] };
      const findings = validateFieldConsumers(stack({ ...lineFields, link }, { form }));
      expect(findings.find((f) => f.object === 'line' && f.field === 'link')).toBeUndefined();
      expect(Object.fromEntries(findings.map((f) => [`${f.object}.${f.field}`, f.verdict]))).toEqual(DERIVED);
    });
  });
});

/**
 * [#20928] The third carrier of an inline grid: an `object-master-detail-form`
 * page block's `details` entries. Each entry names its child in `childObject`
 * and its grid in `columns`, exactly as a `subforms` entry does, so it is read
 * as a child collection: a column `name` and `amountField` /
 * `relationshipField` against the child, `totalField` against the parent the
 * block's `objectName` binds, and an entry with no `columns` credits the grid
 * the child derives.
 *
 * `inv` is the parent and `line` the child; each declares a field the other's
 * key names, so a key read against the wrong object shows up as the wrong one
 * of the pair going quiet. `memo` is named nowhere: the control.
 */
describe('[#20928] validateFieldConsumers — an `object-master-detail-form` detail entry is a child collection', () => {
  const data = { provider: 'object', object: 'inv' };

  const stack = (details: unknown[], slots?: AnyRec): AnyRec => ({
    objects: [
      { name: 'inv', fields: { name: { type: 'text' }, qty: { type: 'number' }, total: { type: 'number' } } },
      {
        name: 'line',
        fields: {
          name: { type: 'text' },
          invoice: { type: 'master_detail', reference: 'inv' },
          qty: { type: 'number' },
          total: { type: 'number' },
          line_total: { type: 'number' },
          memo: { type: 'text' },
        },
      },
    ],
    views: [{ list: { type: 'grid', data, columns: [{ field: 'name' }] } }],
    pages: [{
      name: 'inv_entry',
      regions: [{
        name: 'main',
        components: [{ type: 'object-master-detail-form', properties: { objectName: 'inv', details } }],
      }],
      ...(slots ? { kind: 'slotted', slots } : {}),
    }],
  });

  /** `object.field` → verdict, for every field the rule reports. */
  const verdicts = (s: AnyRec): Record<string, string> =>
    Object.fromEntries(validateFieldConsumers(s).map((f) => [`${f.object}.${f.field}`, f.verdict]));

  /** Every non-name field of both objects, reported: what a block with no detail entry leaves. */
  const NOTHING_READ = {
    'inv.qty': 'inert',
    'inv.total': 'inert',
    'line.qty': 'inert',
    'line.total': 'inert',
    'line.line_total': 'inert',
    'line.memo': 'inert',
  };

  it('baseline: a block with no detail entry reads no field of either object', () => {
    expect(verdicts(stack([]))).toEqual(NOTHING_READ);
  });

  it("an authored column credits the CHILD's field, not the parent's same-named one", () => {
    const { 'line.qty': _credited, ...rest } = NOTHING_READ;
    expect(verdicts(stack([{ childObject: 'line', columns: [{ name: 'qty' }] }]))).toEqual(rest);
  });

  it("`amountField` credits the CHILD's field and `totalField` the PARENT's — each same-named counterpart stays reported", () => {
    const entry = { childObject: 'line', columns: [{ name: 'qty' }], amountField: 'line_total', totalField: 'total' };
    expect(verdicts(stack([entry]))).toEqual({
      'inv.qty': 'inert',
      'line.total': 'inert',
      'line.memo': 'inert',
    });
  });

  it('an entry with no `columns` credits the columns its child derives', () => {
    // `deriveInlineGridColumns` draws every editable child field but the
    // relationship back to the parent, so only the parent's two stay reported.
    expect(verdicts(stack([{ childObject: 'line' }]))).toEqual({ 'inv.qty': 'inert', 'inv.total': 'inert' });
  });

  it("control: the page slot map's own `details` key holds components, and one read as an entry is read exactly as anywhere else", () => {
    const component = { type: 'record:details', properties: { objectName: 'line', fields: ['memo'] } };
    const elsewhere = verdicts(stack([], { header: [component] }));
    // Non-vacuity: the component does read a field, so a slot that skipped it would show.
    expect(elsewhere['line.memo']).toBeUndefined();
    expect(verdicts(stack([], { details: [component] }))).toEqual(elsewhere);
  });
});
