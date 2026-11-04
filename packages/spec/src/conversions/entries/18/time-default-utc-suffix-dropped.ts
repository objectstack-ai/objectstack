// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `time-default-utc-suffix-dropped` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `timeDefaultUtcSuffixDropped` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, mapPageComponents } from '../../walk.js';
import { ClockTimeValueSchema } from '../../../data/field-value.zod.js';
import { type Dict, isDict } from '../shared.js';

/**
 * A `time` literal default drops a `Z` or zero-offset suffix (protocol 18).
 *
 * A `time` value is a zone-less wall clock (ADR-0053 D-C1), and the stored form
 * (`ClockTimeValueSchema`) no longer admits a zone. A `Z` or a zero offset
 * (`+00:00`, `+0000`, `-00:00`, `-0000`) names the same wall clock without it,
 * so the suffix is dropped. A non-zero offset is left as stored and reported as
 * a TODO: whether it meant its own digits or the UTC time is the author's call,
 * and the parse refuses it where it lands. Only the suffixes the old stored
 * form admitted are recognised, and `ClockTimeValueSchema` judges the rest.
 *
 * Reach: the literal defaults the narrowed gates judge — a `time` field's
 * (`objects[]`, `objectExtensions[]`) and an action param typed `time`
 * (`actions[]`, `objects[].actions[]`, an `element:button`'s inline action).
 * Retired from the load path: an author is refused at parse — except on an
 * `element:button`'s inline action, which sits in the open `properties` bag the
 * load path keeps as written, where the refusal is a
 * `component-props-invalid` error at `os validate` / `os build` / `os lint`
 * (the component-props gate, `@objectstack/lint`) — and data at rest and
 * `os migrate meta` replay it.
 */
const timeDefaultUtcSuffixDropped: MetadataConversion = {
  id: 'time-default-utc-suffix-dropped',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.5.0',
  surface:
    'object.fields.*.defaultValue / action.params[].defaultValue / '
    + 'page.component.element:button.action.params[].defaultValue (type time)',
  summary:
    "a `time` literal default's `Z` or zero-offset suffix is dropped, which names the same wall "
    + 'clock; a default with a non-zero offset is left as stored and reported as a TODO, because '
    + 'a `time` value carries no zone (ADR-0053 D-C1) and only its author knows which wall clock '
    + 'it meant',
  apply(stack, emit, context) {
    const convert = (holder: Dict, path: string, subject: string): Dict => {
      const value = holder.defaultValue;
      if (typeof value !== 'string') return holder;
      const suffix = /(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.exec(value);
      if (!suffix) return holder;
      const wallClock = value.slice(0, suffix.index);
      if (!ClockTimeValueSchema.safeParse(wallClock).success) return holder;
      const at = `${path}.defaultValue`;
      if (/[1-9]/.test(suffix[0])) {
        context?.reportTodo?.({
          path: at,
          from: JSON.stringify(value),
          reason: `${subject} is a time with no time zone, and this default carries a non-zero UTC `
            + 'offset. Left as stored, it is refused where it is parsed. Rewrite it by hand as the wall '
            + 'clock it meant, HH:MM or HH:MM:SS with no zone, or use a datetime field for an instant.',
        });
        return holder;
      }
      emit({ from: JSON.stringify(value), to: JSON.stringify(wallClock), path: at });
      return { ...holder, defaultValue: wallClock };
    };
    const params = (action: Dict, path: string): Dict => {
      const list = action.params;
      if (!Array.isArray(list)) return action;
      let changed = false;
      const next = list.map((p, i) => {
        if (!isDict(p) || p.type !== 'time') return p;
        const name = typeof p.name === 'string' ? p.name : String(p.field ?? '');
        const mapped = convert(p, `${path}.params[${i}]`, `Action param "${name}"`);
        if (mapped !== p) changed = true;
        return mapped;
      });
      return changed ? { ...action, params: next } : action;
    };
    const fields = (owner: Dict, path: string): Dict => {
      const map = owner.fields;
      if (!isDict(map)) return owner;
      let changed = false;
      const next: Dict = {};
      for (const [name, def] of Object.entries(map)) {
        next[name] = isDict(def) && def.type === 'time'
          ? convert(def, `${path}.fields.${name}`, `Field "${name}"`)
          : def;
        if (next[name] !== def) changed = true;
      }
      return changed ? { ...owner, fields: next } : owner;
    };
    let next = mapCollection(stack, 'objects', (obj, path) =>
      mapCollection(fields(obj, path), 'actions', (action, actionPath) => params(action, `${path}.${actionPath}`)));
    next = mapCollection(next, 'objectExtensions', fields);
    next = mapCollection(next, 'actions', params);
    return mapPageComponents(next, (component, path) => {
      if (component.type !== 'element:button') return component;
      const properties = component.properties;
      if (!isDict(properties) || !isDict(properties.action)) return component;
      const action = params(properties.action, `${path}.properties.action`);
      return action === properties.action ? component : { ...component, properties: { ...properties, action } };
    });
  },
  fixture: {
    before: {
      objects: [{
        name: 'shift',
        fields: {
          starts_at: { type: 'time', defaultValue: '09:00Z' },
          ends_at: { type: 'time', defaultValue: '17:30:00+00:00' },
          // A non-zero offset: left as stored (a TODO, not a notice).
          handover_at: { type: 'time', defaultValue: '08:00+08:00' },
          label: { type: 'text', defaultValue: '09:00Z' },
        },
        actions: [{ name: 'reschedule', params: [{ name: 'at', type: 'time', defaultValue: '10:00-0000' }] }],
      }],
      objectExtensions: [{ extend: 'shift', fields: { breaks_at: { type: 'time', defaultValue: '12:00Z' } } }],
      actions: [{ name: 'clock_in', params: [{ name: 'at', type: 'time', defaultValue: '07:45:00.500Z' }] }],
      pages: [{
        name: 'shift_board',
        regions: [{
          name: 'main',
          components: [{
            type: 'element:button',
            properties: { action: { type: 'script', target: 'clockOut', params: [{ name: 'at', type: 'time', defaultValue: '18:00Z' }] } },
          }],
        }],
      }],
    },
    after: {
      objects: [{
        name: 'shift',
        fields: {
          starts_at: { type: 'time', defaultValue: '09:00' },
          ends_at: { type: 'time', defaultValue: '17:30:00' },
          handover_at: { type: 'time', defaultValue: '08:00+08:00' },
          label: { type: 'text', defaultValue: '09:00Z' },
        },
        actions: [{ name: 'reschedule', params: [{ name: 'at', type: 'time', defaultValue: '10:00' }] }],
      }],
      objectExtensions: [{ extend: 'shift', fields: { breaks_at: { type: 'time', defaultValue: '12:00' } } }],
      actions: [{ name: 'clock_in', params: [{ name: 'at', type: 'time', defaultValue: '07:45:00.500' }] }],
      pages: [{
        name: 'shift_board',
        regions: [{
          name: 'main',
          components: [{
            type: 'element:button',
            properties: { action: { type: 'script', target: 'clockOut', params: [{ name: 'at', type: 'time', defaultValue: '18:00' }] } },
          }],
        }],
      }],
    },
    // One per dropped suffix: two object fields, the object-nested action, the
    // extension field, the stack action and the inline action.
    expectedNotices: 6,
  },
};

export { timeDefaultUtcSuffixDropped };
