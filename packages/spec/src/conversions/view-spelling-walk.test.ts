// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every view-family conversion reaches all THREE persisted `view` spellings.
 *
 * `ViewMetadataSchema` (`ui/view.zod.ts`) accepts three body shapes, and all
 * three land in `sys_metadata` rows: the `defineView` **container**
 * (`{ list, listViews, form, formViews }`), the standalone **ViewItem record**
 * (`{ viewKind, config }`), and the **flattened runtime overlay** (a raw
 * ListView/FormView config at the top level plus its `object`/`viewKind`
 * binding). `applyConversionsToStoredItem('view', row)` replays the full chain
 * over every one of them — data at rest is the "perpetual consumer arriving
 * late" (`stored.ts` module doc).
 *
 * Before the shared walker, every view-family conversion read only the
 * container keys, so for the other two spellings the whole chain was a no-op: a
 * row persisted under an old protocol kept its historical shape while the
 * conversion layer claimed to have canonicalized it, and the rehydration parse
 * then refused exactly what was never rewritten. Same structural gap the LINT
 * walk closed one layer over (a standalone ViewItem's nested `config.*` judged
 * by no list-view field rule).
 *
 * So the assertion these cases make over and over is the **parity** one:
 * whatever the table does to a payload in a container slot, it must do to the
 * identical payload under `config`, and to the identical payload flattened at
 * the top level. Every conversion is exercised in all three, because the gap
 * was family-wide rather than specific to any entry.
 */

import { describe, expect, it } from 'vitest';

import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

type Dict = Record<string, unknown>;

/** Replay the full stored chain over one `view` row, collecting its notices. */
function convertViewRow(row: Dict): { out: Dict; notices: ConversionNotice[] } {
  const notices: ConversionNotice[] = [];
  const out = applyConversionsToStoredItem('view', row, { onNotice: (n) => notices.push(n) });
  return { out: out as Dict, notices };
}

/** Notice paths for one conversion id, in emission order. */
function pathsFor(notices: ConversionNotice[], conversionId: string): string[] {
  return notices.filter((n) => n.conversionId === conversionId).map((n) => n.path);
}

/**
 * The three persisted spellings of ONE list payload, as
 * {@link applyConversionsToStoredItem} receives them.
 *
 * The flattened overlay carries `object` + `viewKind` because #7741 made that
 * pair REQUIRED on both inline arms — the exact pair the object-bound read
 * paths (`GET /meta/view?object=`, the view switcher) filter on. A fixture
 * without them would pin a body no read path could ever serve.
 */
const listSpellings = (payload: Dict) => ({
  container: { object: 'crm_lead', list: { ...payload } },
  containerNamed: { object: 'crm_lead', listViews: { all: { ...payload } } },
  record: { name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list', config: { ...payload } },
  flattened: { name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list', ...payload },
});

/** The three persisted spellings of ONE form payload. */
const formSpellings = (payload: Dict) => ({
  container: { object: 'crm_lead', form: { ...payload } },
  containerNamed: { object: 'crm_lead', formViews: { quick: { ...payload } } },
  record: { name: 'crm_lead.edit', object: 'crm_lead', viewKind: 'form', config: { ...payload } },
  flattened: { name: 'crm_lead.edit', object: 'crm_lead', viewKind: 'form', ...payload },
});

describe('view conversions reach the ViewItem-record spelling ({ viewKind, config })', () => {
  it('renames `visibleOn` inside a record `config` exactly as inside a container `form`', () => {
    const payload = {
      type: 'simple',
      sections: [{
        label: 'Details',
        visibleOn: "record.status == 'open'",
        fields: ['name', { field: 'priority', visibleOn: "record.priority != ''" }],
      }],
    };
    const spellings = formSpellings(payload);

    const container = convertViewRow(spellings.container);
    const record = convertViewRow(spellings.record);

    // The container leg is the reference behaviour — unchanged by this fix.
    const containerSection = (container.out.form as Dict).sections as Dict[];
    expect(containerSection[0]!.visibleWhen).toBe("record.status == 'open'");
    expect('visibleOn' in containerSection[0]!).toBe(false);

    // Parity: the identical payload under `config` converts identically.
    const recordSection = (record.out.config as Dict).sections as Dict[];
    expect(recordSection[0]!.visibleWhen).toBe("record.status == 'open'");
    expect('visibleOn' in recordSection[0]!).toBe(false);
    expect((recordSection[0]!.fields as Dict[])[1]!.visibleWhen).toBe("record.priority != ''");

    // The notice names the site the author has to edit — `config`, not `form`.
    expect(pathsFor(record.notices, 'view-visibleOn-to-visibleWhen')).toEqual([
      'views[0].config.sections[0].visibleWhen',
      'views[0].config.sections[0].fields[1].visibleWhen',
    ]);
  });

  it('strips the retired `pdf` export format from a record `config`', () => {
    const { out, notices } = convertViewRow(
      listSpellings({ type: 'grid', columns: ['name'], exportOptions: ['xlsx', 'pdf'] }).record,
    );
    expect((out.config as Dict).exportOptions).toEqual(['xlsx']);
    expect(pathsFor(notices, 'view-export-options-pdf-removed')).toEqual([
      'views[0].config.exportOptions',
    ]);
  });

  it('strips `pdf` from the OBJECT export spelling under a record `config`', () => {
    const { out } = convertViewRow(
      listSpellings({
        type: 'grid',
        columns: ['name'],
        exportOptions: { formats: ['csv', 'pdf'], maxRecords: 100 },
      }).record,
    );
    // The surviving sibling keys stay — the strip is the value, not the block.
    expect((out.config as Dict).exportOptions).toEqual({ formats: ['csv'], maxRecords: 100 });
  });

  it('strips the inert LIST keys from a `viewKind: list` record, and only those', () => {
    const { out, notices } = convertViewRow(
      listSpellings({
        type: 'grid',
        columns: ['name'],
        responsive: { sm: {} },
        performance: { lazyLoad: true },
        aria: { label: 'Leads' }, // list `aria` is LIVE — must survive
      }).record,
    );
    const config = out.config as Dict;
    expect('responsive' in config).toBe(false);
    expect('performance' in config).toBe(false);
    expect(config.aria).toEqual({ label: 'Leads' });
    expect(pathsFor(notices, 'view-inert-keys-removed').sort()).toEqual([
      'views[0].config.performance',
      'views[0].config.responsive',
    ]);
  });

  it('strips the inert FORM keys from a `viewKind: form` record, and only those', () => {
    const { out } = convertViewRow(
      formSpellings({
        type: 'simple',
        data: { provider: 'object', object: 'crm_lead' }, // form `data` is LIVE
        defaultSort: [{ field: 'created_at', order: 'desc' }],
        aria: { label: 'Lead form' },
      }).record,
    );
    const config = out.config as Dict;
    expect('defaultSort' in config).toBe(false);
    expect('aria' in config).toBe(false);
    expect(config.data).toEqual({ provider: 'object', object: 'crm_lead' });
  });

  it('is SHAPE-scoped across the record arms: a form key is not stripped from a list record', () => {
    // `aria` is inert on a FORM and live on a LIST. Reading `viewKind` wrong
    // (or ignoring it and stripping both key sets) would delete a live key.
    const { out } = convertViewRow(
      listSpellings({ type: 'grid', columns: ['name'], aria: { label: 'Leads' } }).record,
    );
    expect((out.config as Dict).aria).toEqual({ label: 'Leads' });
  });

  it('strips the pass-through list keys from a record `config`', () => {
    const { out, notices } = convertViewRow(
      listSpellings({
        type: 'grid',
        columns: ['name'],
        resizable: true, // live — survives
        striped: true,
        bordered: true,
        virtualScroll: true,
      }).record,
    );
    const config = out.config as Dict;
    expect(config.resizable).toBe(true);
    expect(Object.keys(config).sort()).toEqual(['columns', 'resizable', 'type']);
    expect(pathsFor(notices, 'view-list-passthrough-keys-removed')).toHaveLength(3);
  });

  it('strips the per-option `default` inside a record `config`, nested rows included', () => {
    const { out, notices } = convertViewRow(
      formSpellings({
        type: 'simple',
        sections: [{
          label: 'Details',
          fields: [
            { field: 'status', type: 'select', options: [{ label: 'Open', value: 'open', default: true }] },
            {
              field: 'meta',
              type: 'composite',
              fields: [{
                field: 'priority',
                type: 'radio',
                options: [{ label: 'High', value: 'high', default: true }],
              }],
            },
          ],
        }],
      }).record,
    );
    const sections = (out.config as Dict).sections as Dict[];
    const fields = sections[0]!.fields as Dict[];
    expect((fields[0]!.options as Dict[])[0]).toEqual({ label: 'Open', value: 'open' });
    expect(((fields[1]!.fields as Dict[])[0]!.options as Dict[])[0])
      .toEqual({ label: 'High', value: 'high' });
    expect(pathsFor(notices, 'form-view-option-default-removed')).toEqual([
      'views[0].config.sections[0].fields[0].options[0].default',
      'views[0].config.sections[0].fields[1].fields[0].options[0].default',
    ]);
  });

  it('leaves the record identity fields alone while converting its `config`', () => {
    const { out } = convertViewRow(
      listSpellings({ type: 'grid', columns: ['name'], striped: true }).record,
    );
    expect(out.name).toBe('crm_lead.all');
    expect(out.object).toBe('crm_lead');
    expect(out.viewKind).toBe('list');
  });
});

describe('view conversions reach the flattened-overlay spelling (payload at top level)', () => {
  it('renames `visibleOn` at the top level of a flattened FORM overlay', () => {
    const { out, notices } = convertViewRow(
      formSpellings({
        type: 'simple',
        sections: [{ label: 'Details', visibleOn: "record.status == 'open'" }],
      }).flattened,
    );
    const sections = out.sections as Dict[];
    expect(sections[0]!.visibleWhen).toBe("record.status == 'open'");
    expect('visibleOn' in sections[0]!).toBe(false);
    expect(pathsFor(notices, 'view-visibleOn-to-visibleWhen')).toEqual([
      'views[0].sections[0].visibleWhen',
    ]);
  });

  it('strips the retired `pdf` export format from a flattened LIST overlay', () => {
    const { out, notices } = convertViewRow(
      listSpellings({ type: 'grid', columns: ['name'], exportOptions: ['xlsx', 'pdf'] }).flattened,
    );
    expect(out.exportOptions).toEqual(['xlsx']);
    expect(pathsFor(notices, 'view-export-options-pdf-removed')).toEqual([
      'views[0].exportOptions',
    ]);
  });

  it('strips the inert LIST keys from a flattened LIST overlay', () => {
    const { out, notices } = convertViewRow(
      listSpellings({
        type: 'grid',
        columns: ['name'],
        responsive: { sm: {} },
        performance: { lazyLoad: true },
        aria: { label: 'Leads' },
      }).flattened,
    );
    expect('responsive' in out).toBe(false);
    expect('performance' in out).toBe(false);
    expect(out.aria).toEqual({ label: 'Leads' });
    expect(pathsFor(notices, 'view-inert-keys-removed').sort()).toEqual([
      'views[0].performance',
      'views[0].responsive',
    ]);
  });

  it('strips the inert FORM keys from a flattened FORM overlay', () => {
    const { out } = convertViewRow(
      formSpellings({
        type: 'simple',
        data: { provider: 'object', object: 'crm_lead' },
        defaultSort: [{ field: 'created_at', order: 'desc' }],
        aria: { label: 'Lead form' },
      }).flattened,
    );
    expect('defaultSort' in out).toBe(false);
    expect('aria' in out).toBe(false);
    expect(out.data).toEqual({ provider: 'object', object: 'crm_lead' });
  });

  it('strips the pass-through list keys from a flattened LIST overlay', () => {
    const { out, notices } = convertViewRow(
      listSpellings({
        type: 'grid',
        columns: ['name'],
        striped: true,
        bordered: true,
        virtualScroll: true,
      }).flattened,
    );
    expect('striped' in out).toBe(false);
    expect('bordered' in out).toBe(false);
    expect('virtualScroll' in out).toBe(false);
    expect(pathsFor(notices, 'view-list-passthrough-keys-removed').sort()).toEqual([
      'views[0].bordered',
      'views[0].striped',
      'views[0].virtualScroll',
    ]);
  });

  it('strips the per-option `default` inside a flattened FORM overlay', () => {
    const { out, notices } = convertViewRow(
      formSpellings({
        type: 'simple',
        fields: [{
          field: 'channel',
          type: 'select',
          options: [{ label: 'Email', value: 'email', default: true }, { label: 'Phone', value: 'phone' }],
        }],
      }).flattened,
    );
    const options = (out.fields as Dict[])[0]!.options as Dict[];
    expect(options).toEqual([{ label: 'Email', value: 'email' }, { label: 'Phone', value: 'phone' }]);
    expect(pathsFor(notices, 'form-view-option-default-removed')).toEqual([
      'views[0].fields[0].options[0].default',
    ]);
  });

  /**
   * The flattened overlay is the one spelling where the payload and the row's
   * identity share a dict, so the walker hands a conversion a dict that also
   * holds `name`/`object`/`viewKind`/`columnState`/… . None of the keys any
   * view-family conversion strips collides with that identity set — this pins
   * that, so a later conversion whose key DOES collide fails here rather than
   * silently deleting a row's binding.
   */
  it('never touches the overlay identity/round-trip fields', () => {
    const { out } = convertViewRow({
      name: 'crm_lead.all',
      object: 'crm_lead',
      viewKind: 'list',
      label: 'All leads',
      isDefault: true,
      order: 3,
      scope: 'user',
      owner: 'usr_1',
      columnState: { order: ['name'], widths: { name: 120 } },
      type: 'grid',
      columns: ['name'],
      striped: true,
    });
    expect(out.name).toBe('crm_lead.all');
    expect(out.object).toBe('crm_lead');
    expect(out.viewKind).toBe('list');
    expect(out.label).toBe('All leads');
    expect(out.isDefault).toBe(true);
    expect(out.order).toBe(3);
    expect(out.scope).toBe('user');
    expect(out.owner).toBe('usr_1');
    expect(out.columnState).toEqual({ order: ['name'], widths: { name: 120 } });
    expect('striped' in out).toBe(false); // the one key that IS retired
  });
});

describe('the container spelling is unchanged, and the three agree', () => {
  it('converts a container `list`, a named `listViews` entry, a record and an overlay alike', () => {
    const payload = { type: 'grid', columns: ['name'], striped: true, exportOptions: ['xlsx', 'pdf'] };
    const s = listSpellings(payload);

    const fromContainer = convertViewRow(s.container).out.list as Dict;
    const fromNamed = (convertViewRow(s.containerNamed).out.listViews as Dict).all as Dict;
    const fromRecord = convertViewRow(s.record).out.config as Dict;
    const flattened = convertViewRow(s.flattened).out;

    const expected = { type: 'grid', columns: ['name'], exportOptions: ['xlsx'] };
    expect(fromContainer).toEqual(expected);
    expect(fromNamed).toEqual(expected);
    expect(fromRecord).toEqual(expected);
    // The overlay's payload is its top level, so compare after dropping identity.
    const { name: _n, object: _o, viewKind: _k, ...overlayPayload } = flattened;
    expect(overlayPayload).toEqual(expected);
  });

  it('converts a container `form` and a `viewKind: form` record alike', () => {
    const payload = {
      type: 'simple',
      sections: [{ label: 'Details', visibleOn: 'record.open', fields: [] }],
      aria: { label: 'Lead form' },
    };
    const s = formSpellings(payload);
    const expected = { type: 'simple', sections: [{ label: 'Details', visibleWhen: 'record.open', fields: [] }] };

    expect(convertViewRow(s.container).out.form).toEqual(expected);
    expect((convertViewRow(s.containerNamed).out.formViews as Dict).quick).toEqual(expected);
    expect(convertViewRow(s.record).out.config).toEqual(expected);
  });
});

describe('the walker recognizes shapes rather than guessing at them', () => {
  it('leaves a body that is none of the three spellings untouched', () => {
    // No `viewKind`, no container slot — nothing positively identifies a view
    // payload here, so the chain must not invent one and start stripping.
    const row = { name: 'mystery', object: 'crm_lead', striped: true, aria: { label: 'x' } };
    const { out, notices } = convertViewRow(row);
    expect(out).toEqual(row);
    expect(notices).toHaveLength(0);
  });

  it('treats a record whose `config` is not a dict as no payload at all', () => {
    // `config: null` matches no `ViewMetadataSchema` member (the record arm
    // requires a config object; both overlay arms guard `config: undefined`).
    // A malformed body gets no rewrite — it is not silently re-read as a
    // flattened overlay whose top level would then be stripped.
    const row = { name: 'broken', object: 'crm_lead', viewKind: 'list', config: null, striped: true };
    const { out, notices } = convertViewRow(row);
    expect(out).toEqual(row);
    expect(notices).toHaveLength(0);
  });

  it('is idempotent: replaying the chain over an already-converted row is a no-op', () => {
    const once = convertViewRow(
      listSpellings({ type: 'grid', columns: ['name'], striped: true, exportOptions: ['xlsx', 'pdf'] }).record,
    );
    const twice = convertViewRow(once.out);
    expect(twice.out).toEqual(once.out);
    expect(twice.notices).toHaveLength(0);
  });

  it('returns the SAME row reference when nothing converts (copy-on-write)', () => {
    const row = { name: 'clean', object: 'crm_lead', viewKind: 'list', config: { type: 'grid', columns: ['name'] } };
    expect(applyConversionsToStoredItem('view', row)).toBe(row);
  });
});
