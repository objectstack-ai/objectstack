/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * bulkParamToField — the pure BulkActionParam → field-widget-metadata adapter
 * behind the ADR-0059 bulk-dialog migration (#3064). Pins the type mapping
 * (aliases, lookup degradation, sys_user promotion), the #2204 multiple
 * threading, and the option-value stringification the confirm step relies on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EXPANDABLE_FIELD_TYPES } from '@object-ui/core';

import {
  bulkParamToField,
  fieldNeedsDataSource,
  isLookupishParam,
  lookupTargetObject,
  resolveBulkParamWidgetType,
} from '../components/bulkParamToField';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveBulkParamWidgetType', () => {
  it('passes canonical widget types through and folds param-only aliases', () => {
    expect(resolveBulkParamWidgetType('lookup')).toBe('lookup');
    expect(resolveBulkParamWidgetType('date')).toBe('date');
    expect(resolveBulkParamWidgetType('checkbox')).toBe('boolean');
    expect(resolveBulkParamWidgetType('reference')).toBe('lookup');
    expect(resolveBulkParamWidgetType('datetime-local')).toBe('datetime');
  });

  it('falls back to text for unknown types (same as the form renderer)', () => {
    expect(resolveBulkParamWidgetType('no-such-type')).toBe('text');
  });
});

describe('bulkParamToField', () => {
  it('maps a lookup param to the record-picker field shape', () => {
    const field = bulkParamToField(
      { name: 'queue', label: 'Queue', type: 'lookup', object: 'queues', labelField: 'title', required: true },
      false,
    );
    expect(field).toMatchObject({
      name: 'queue',
      label: 'Queue',
      type: 'lookup',
      required: true,
      reference: 'queues',
      displayField: 'title',
      multiple: false,
    });
  });

  it('promotes a sys_user-targeting lookup to the user widget (form PeoplePicker parity)', () => {
    const field = bulkParamToField(
      { name: 'manager', type: 'lookup', object: 'sys_user' },
      false,
    );
    expect(field.type).toBe('user');
    expect(field.reference).toBe('sys_user');
  });

  it('degrades a targetless lookup to a text input with a dev warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const field = bulkParamToField({ name: 'ref', type: 'lookup' }, false);
    expect(field.type).toBe('text');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('threads the EFFECTIVE multiple flag (#2204), ignoring the raw param flag', () => {
    // Schema-derived multi wins over the omitted param flag…
    expect(bulkParamToField({ name: 'tags', type: 'select', options: [] }, true).multiple).toBe(true);
    // …and the argument is authoritative in the other direction too.
    expect(bulkParamToField({ name: 'tags', type: 'select', multiple: true, options: [] }, false).multiple).toBe(false);
  });

  it('stringifies option values so widget output matches confirm-step lookups', () => {
    const field = bulkParamToField(
      { name: 'level', type: 'select', options: [{ label: 'One', value: 1 }, { label: 'Yes', value: true }] },
      false,
    );
    expect(field.options).toEqual([
      { label: 'One', value: '1' },
      { label: 'Yes', value: 'true' },
    ]);
  });

  it('forwards catch-all widget config and strips dialog-owned keys', () => {
    const field = bulkParamToField(
      { name: 'amount', type: 'number', min: 0, step: 5, help: 'shown by the dialog', default: 10 },
      false,
    );
    expect(field.min).toBe(0);
    expect(field.step).toBe(5);
    expect(field).not.toHaveProperty('help');
    expect(field).not.toHaveProperty('default');
  });
});

describe('lookup helpers', () => {
  it('identifies picker params and their target object', () => {
    expect(isLookupishParam({ name: 'q', type: 'lookup', object: 'queues' })).toBe(true);
    expect(isLookupishParam({ name: 'u', type: 'user' })).toBe(true);
    expect(isLookupishParam({ name: 't', type: 'text' })).toBe(false);

    expect(lookupTargetObject({ name: 'q', type: 'lookup', object: 'queues' })).toBe('queues');
    // Person params default to sys_user like the form's UserField.
    expect(lookupTargetObject({ name: 'u', type: 'user' })).toBe('sys_user');
    expect(lookupTargetObject({ name: 'x', type: 'lookup' })).toBeUndefined();
  });

  it('only picker field shapes get the DataSource threaded', () => {
    expect(fieldNeedsDataSource({ type: 'user' })).toBe(true);
    expect(fieldNeedsDataSource({ type: 'lookup' })).toBe(true);
    expect(fieldNeedsDataSource({ type: 'date' })).toBe(false);
  });
});

describe('the data-source rule is core\'s object, not a copy (objectui#4815)', () => {
  it('asks `@object-ui/core` EXPANDABLE_FIELD_TYPES which params need a DataSource', () => {
    // IDENTITY, not membership — the pin shape objectui#4770 / #4790 established
    // (`cascadeOptionWidgetTypes.reexport.test.tsx`,
    // `form-data-source-wiring.test.tsx`). Every membership assertion in this
    // file is satisfied by a private `new Set(['lookup', 'master_detail',
    // 'user'])` holding the same strings, which is exactly the state
    // objectui#4815 closed — a value-equality check would pass ON the defect and
    // report a convergence that isn't there. The spy is installed on the Set
    // object exported by core; it records a call only if this module consulted
    // THAT object, so a member-identical copy leaves it empty and this fails.
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    try {
      expect(isLookupishParam({ name: 'q', type: 'lookup', object: 'queues' })).toBe(true);
      expect(spy.mock.calls.map(([k]) => k)).toContain('lookup');
    } finally {
      spy.mockRestore();
    }
  });

  it('routes all THREE consumers of the rule through that same object', () => {
    // The private copy had three readers, and a convergence that reconnected
    // only the one under test would leave the others forked. `isLookupishParam`
    // (label prefetch + option source in BulkActionDialog), `fieldNeedsDataSource`
    // (the `dataSource` prop the dialog threads into the widget) and
    // `bulkParamToField`'s `reference` / `displayField` branch must each
    // reach core.
    const consumers: [string, string, () => unknown][] = [
      ['isLookupishParam', 'user', () => isLookupishParam({ name: 'u', type: 'user' })],
      ['fieldNeedsDataSource', 'user', () => fieldNeedsDataSource({ type: 'user' })],
      // The `reference` / `displayField` branch, reached with the widget key
      // this param resolves to.
      ['bulkParamToField', 'lookup', () => bulkParamToField({ name: 'q', type: 'lookup', object: 'queues' }, false)],
    ];
    for (const [label, key, exercise] of consumers) {
      const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
      try {
        exercise();
        expect(spy.mock.calls.map(([k]) => k), `${label} never consulted the shared set`).toContain(key);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it('holds every core member under this surface\'s normalization', () => {
    // The shared set is defined over SCHEMA types; this surface tests WIDGET
    // keys (`resolveBulkParamWidgetType` output). Reading one with the other is
    // only safe while the family is closed under that resolution — every member
    // resolves to a member. A future core member that resolved to `text` here
    // would be a schema-declared reference field silently rendered as a plain
    // input with no DataSource, so it fails loudly instead.
    for (const type of EXPANDABLE_FIELD_TYPES) {
      const widgetKey = resolveBulkParamWidgetType(type);
      expect(
        EXPANDABLE_FIELD_TYPES.has(widgetKey),
        `core member '${type}' resolves to '${widgetKey}', which is outside the family`,
      ).toBe(true);
    }
  });

  it('keeps `tree` unreachable here — the one cell where the two tables differed', () => {
    // Why converging cost no behaviour change: `tree` is a core member that can
    // never BE a widget key on this path (absent from the fields widget map,
    // and `mapFieldTypeToFormType` sends it to `field:lookup`). If someone
    // registers a real `tree` widget, this flips and `tree` starts matching the
    // rule here — a behaviour change that would otherwise arrive silently.
    expect(EXPANDABLE_FIELD_TYPES.has('tree')).toBe(true);
    expect(resolveBulkParamWidgetType('tree')).toBe('lookup');
    expect(fieldNeedsDataSource({ type: 'lookup' })).toBe(true);
  });

  it('does NOT absorb the form-only widget-hint pickers', () => {
    // The other measured divergence, left exactly as objectui#4815 measured it.
    // The object form ALSO wires `object-ref` / `filter-condition` /
    // `recipient-picker` — widget hints no object schema can declare, and which
    // a bulk param does not produce. Pulling them in would change which widgets
    // get a DataSource on this surface: a behaviour change, not a convergence.
    // (Green before and after the convergence by design — it pins the boundary,
    // not the convergence.)
    for (const hint of ['object-ref', 'filter-condition', 'recipient-picker']) {
      expect(fieldNeedsDataSource({ type: hint }), `${hint} must stay out`).toBe(false);
      expect(isLookupishParam({ name: 'p', type: hint }), `${hint} must stay out`).toBe(false);
    }
  });
});
