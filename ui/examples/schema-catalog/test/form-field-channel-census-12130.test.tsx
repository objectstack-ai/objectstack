/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The form-field channel census (objectui#12130): every key of a `form`
 * `fields[]` entry that the runtime reads BY NAME, measured through the real
 * `SchemaRenderer`, compared with what the authoring face declares.
 *
 * ## The channel
 *
 * The `form` renderer hands each `fields[]` entry to its field widget twice:
 * as the widget's metadata carrier (`field: field.field || field`, the one
 * `renderFieldComponent` call in `renderers/form/form.tsx`), and as props,
 * because the entry's remaining keys are spread into the widget's props bag.
 * A key a widget reads there works, whether or not `FormFieldSchema` declares
 * it, and the strict authoring face (`objectui validate`, `objectui check`)
 * tells the author to remove every key it does not declare. objectui#11070
 * graded this channel from a source read and missed keys on it; this file
 * replaces that grade with a measurement.
 *
 * ## The instrument
 *
 * Two recording proxies, both answering every property read with the real
 * value and recording the reads of keys that are ABSENT (a key the author did
 * not write, asked for by name):
 *
 *   1. over the entry itself. It reaches the form renderer, and every
 *      registered field widget as its carrier. Each read is attributed to the
 *      source module on top of the stack (`PKG/src/…`, under `packages/`).
 *   2. over the props bag each registered field widget receives. Every
 *      `field:` registration is replaced, at module scope, by the same widget
 *      function called with recorded props (`withFieldCarrier` is kept, the
 *      registration meta is kept). A key read off props is counted only when
 *      the entry can DELIVER it: the census re-renders that widget with the key
 *      written on the entry and keeps it only if the widget then receives the
 *      written value. Plumbing the form sets or strips (`value`, `dataSource`,
 *      `emptyHint`, …) fails that check and is not a field key.
 *
 * Every type is rendered in three states (empty and editable; read-only with a
 * value; disabled with a value), because several widgets read some keys only
 * when a value is drawn.
 *
 * ## The assertion
 *
 * The keys read and not declared on `FormFieldSchema` must be exactly the keys
 * of {@link LEDGER}, each with the readers recorded there. A widget that starts
 * reading a new undeclared key turns this file red, naming the key and its
 * readers; so does a ledger row whose read is gone. Each row says why the
 * strict face's refusal of its key stands, or that the question is still open.
 * {@link DECLARED_BY_12130} names, for each key this card declared, the field
 * types whose widget reads it by name; on every other type the key is
 * accepted and read by nothing, except where that map's note says otherwise.
 *
 * ## What it does not see (bounds, said per AGENTS.md #9)
 *
 *   - Reads made only inside an interaction handler (a click, a search, an
 *     upload) are not enumerated: the census renders, it does not interact.
 *   - The built-in branches (`input`, `textarea`, `checkbox`, `switch`,
 *     `select`) and the unregistered-widget default branch spread the entry's
 *     leftover keys onto a native control or a Radix primitive. That tail is an
 *     open set read by no name, and no recorder sees it: a key that works only
 *     there is measured by `form-field-channel-effects-12130.test.tsx`, never
 *     by this census.
 *   - The development-mode schema validator `SchemaRenderer` runs on every node
 *     reads the entry too. It is not the channel, so its reads are dropped.
 *
 * Module-scope imports and resolution, not `beforeAll` (AGENTS.md §测试纪律):
 * the widgets sit behind `React.lazy`, and resolving them is an unbounded
 * module load.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import '@object-ui/components';
import { FORM_FIELD_TYPES, getLazyFieldWidget, withFieldCarrier } from '@object-ui/fields';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { FormFieldSchema } from '@object-ui/types/zod';

// Deep enough to reach the reading module from inside React's render frames.
Error.stackTraceLimit = 100;

/* ── the recorders ───────────────────────────────────────────────────────── */

interface Read {
  key: string;
  reader: string;
  type: string;
}

let currentType = '';
let reads: Read[] = [];
/** What each recorded widget received, per type, for the deliverability check. */
const lastProps = new Map<string, Record<string, unknown>>();

/** The repository source module that made the read, or `?` when none is on the stack. */
function readerOf(stack: string): string {
  for (const line of stack.split('\n').slice(1)) {
    if (line.includes('/examples/schema-catalog/test/')) continue;
    const m = line.match(/\/packages\/([a-z0-9-]+\/src\/[^:)?]+)/);
    if (m) return m[1];
  }
  return '?';
}

function recorded<T extends object>(target: T, via: 'entry' | 'props'): T {
  return new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key === 'string' && !Reflect.has(t, key)) {
        reads.push({ key, reader: `${via}@${readerOf(new Error().stack ?? '')}`, type: currentType });
      }
      return Reflect.get(t, key, receiver);
    },
  });
}

/* ── every field widget, re-registered with recorded props ───────────────── */

interface LazyInternals {
  _init: (payload: unknown) => unknown;
  _payload: unknown;
}
type WidgetFn = (props: Record<string, unknown>) => React.ReactNode;

/** The component a `React.lazy` resolves to. Module loading, not rendering. */
async function resolveLazy(lazy: unknown): Promise<unknown> {
  const internals = lazy as LazyInternals;
  for (;;) {
    try {
      return internals._init(internals._payload);
    } catch (pending) {
      if (pending && typeof (pending as PromiseLike<unknown>).then === 'function') await pending;
      else throw pending;
    }
  }
}

const MEMO = Symbol.for('react.memo');
const FORWARD_REF = Symbol.for('react.forward_ref');

/** The plain render function behind a widget, or `undefined` for a shape this file does not unwrap. */
function renderFunctionOf(component: unknown): WidgetFn | undefined {
  if (typeof component === 'function') {
    return (component as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent
      ? undefined
      : (component as WidgetFn);
  }
  const shaped = component as { $$typeof?: symbol; type?: unknown; render?: (p: unknown, r: unknown) => React.ReactNode };
  if (shaped?.$$typeof === MEMO) return renderFunctionOf(shaped.type);
  if (shaped?.$$typeof === FORWARD_REF && shaped.render) {
    const renderFn = shaped.render;
    return (props) => renderFn(props, null);
  }
  return undefined;
}

const unwrapped = new Map<string, boolean>();
for (const type of FORM_FIELD_TYPES) {
  const widget = renderFunctionOf(await resolveLazy(getLazyFieldWidget(type)));
  unwrapped.set(type, !!widget);
  if (!widget) continue;
  const config = ComponentRegistry.getConfig(type, 'field');
  if (!config) continue;
  const { type: _fullType, component: _component, ...meta } = config;
  const Recorded: React.FC<Record<string, unknown>> = (props) => {
    lastProps.set(type, props);
    return <>{widget(recorded({ ...props }, 'props'))}</>;
  };
  Recorded.displayName = `CensusRecorded(${type})`;
  ComponentRegistry.register(type, withFieldCarrier(Recorded), { ...meta, namespace: 'field', skipFallback: true });
}

/* ── the population ──────────────────────────────────────────────────────── */

/**
 * The built-in branches (`BUILTIN_FIELD_TYPES` in `renderers/form/form.tsx`),
 * every registered field widget, and one type nothing registers, which takes
 * the default branch.
 */
const TYPES = ['input', 'textarea', 'checkbox', 'switch', 'select', 'census-unregistered', ...FORM_FIELD_TYPES];

const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
];

/** A value each type can draw, for the two valued states. `undefined` leaves the field empty. */
const SAMPLE_VALUE: Readonly<Record<string, unknown>> = {
  input: 'Value', textarea: 'Value', checkbox: true, switch: true, select: 'a', 'census-unregistered': 'Value',
  text: 'Value', number: 3, boolean: true, date: '2026-01-02', datetime: '2026-01-02T03:04:05Z', time: '03:04',
  email: 'a@b.co', phone: '123', url: 'https://x.dev', multiselect: ['a'], radio: 'a', checkboxes: ['a'],
  tags: ['a'], currency: 3, percent: 0.3, password: 'pw', markdown: 'm', html: '<b>h</b>', richtext: 'r',
  lookup: 'id1', master_detail: 'id1', user: 'u1', location: { lat: 1, lng: 2 }, formula: 3, summary: 3,
  auto_number: 'AN-1', object: { a: 1 }, vector: [0.1, 0.2], grid: [{ product: 'x' }], color: '#ff0000',
  slider: 3, rating: 3, code: 'x=1', address: { street: 's' }, geolocation: { lat: 1, lng: 2 }, qrcode: 'q',
  'object-ref': 'account',
};

/** Keys a type needs on its entry to render at all. */
function baseEntry(type: string): Record<string, unknown> {
  const entry: Record<string, unknown> = { name: 'f', label: 'F', type };
  if (['select', 'radio', 'multiselect', 'checkboxes'].includes(type)) entry.options = OPTIONS;
  if (type === 'grid') entry.columns = [{ name: 'product', type: 'text' }];
  return entry;
}

const STATES = ['empty', 'readonly', 'disabled'] as const;

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
};

async function renderEntry(type: string, entry: Record<string, unknown>, value?: unknown) {
  currentType = type;
  const node: Record<string, unknown> = { type: 'form', fields: [entry] };
  if (value !== undefined) node.defaultValues = { f: value };
  const { unmount } = render(<SchemaRenderer schema={node as never} />);
  await settle();
  unmount();
}

/** Readers whose reads are not the channel. */
const NOT_THE_CHANNEL = /^entry@core\/src\/validation\/schema-validator\.ts$/;

/** key → readers (`entry@MODULE` / `props@MODULE`) and the field types whose render read it. */
type Census = Map<string, { readers: Set<string>; types: Set<string> }>;

async function takeCensus(): Promise<{ census: Census; unattributed: Read[] }> {
  reads = [];
  for (const type of TYPES) {
    for (const state of STATES) {
      const entry = baseEntry(type);
      if (state !== 'empty') entry[state] = true;
      await renderEntry(type, recorded(entry, 'entry'), state === 'empty' ? undefined : SAMPLE_VALUE[type]);
    }
  }
  const all = reads;

  // Deliverability of each props read: write the key on the entry, and keep it
  // only if the widget then receives exactly the written value. A string, not
  // an object: `<FormControl>`'s Slot joins `className` into a string, which
  // would turn any non-string canary into `[object Object]`. A handler-shaped
  // key (`onX`) gets a function, which is what its reader calls.
  const propsReads = all.filter((r) => r.reader.startsWith('props@'));
  const deliverable = new Set<string>();
  for (const pair of new Set(propsReads.map((r) => `${r.type}\u0000${r.key}`))) {
    const [type, key] = pair.split('\u0000');
    const canary: unknown = /^on[A-Z]/.test(key) ? () => undefined : `census-canary-${key}`;
    await renderEntry(type, { ...baseEntry(type), [key]: canary });
    if (lastProps.get(type)?.[key] === canary) deliverable.add(pair);
  }

  const census: Census = new Map();
  const unattributed: Read[] = [];
  for (const r of all) {
    if (NOT_THE_CHANNEL.test(r.reader)) continue;
    if (r.reader.endsWith('@?')) { unattributed.push(r); continue; }
    if (r.reader.startsWith('props@') && !deliverable.has(`${r.type}\u0000${r.key}`)) continue;
    const row = census.get(r.key) ?? { readers: new Set<string>(), types: new Set<string>() };
    row.readers.add(r.reader);
    row.types.add(r.type);
    census.set(r.key, row);
  }
  return { census, unattributed };
}

/* ── the ledger: read, and not declared ──────────────────────────────────── */

interface LedgerRow {
  /** Every reader the census records for the key, sorted. */
  readers: readonly string[];
  /** Why the strict face refusing the key is right, or why it is still open. */
  why: string;
}

const LOOKUP = 'entry@fields/src/widgets/LookupField.tsx';
const USER = 'entry@fields/src/widgets/UserField.tsx';
const CURRENCY = 'entry@i18n/src/currency.ts';

/**
 * Every key the channel reads that `FormFieldSchema` does not declare, with its
 * readers. The strict face refuses each by name; the `why` says whether that
 * refusal is right.
 */
const LEDGER: Readonly<Record<string, LedgerRow>> = {
  // ── second spellings of a declared key: refused (AGENTS.md #0.1) ────────
  // objectui#12157 removed the `allow_create`, `lookup_columns` and
  // `lookup_page_size` rows: the `lookup` widget reads the spec's camelCase
  // spellings alone now, so the census no longer records a read of them.
  reference_field: { readers: [LOOKUP, USER], why: 'ALIAS — the legacy fallback of `displayField`, which this face declares.' },
  avatar_field: {
    readers: [LOOKUP, USER],
    why: 'ALIAS of `avatarField`, which this face declares camelCase only (objectui#12130 round 2); the widgets read it first.',
  },
  defaultCurrency: {
    readers: [CURRENCY],
    why: 'ALIAS — the pre-spec top-level spelling of `currencyConfig.defaultCurrency`, which `resolveFieldCurrency` still falls back to.',
  },
  // ── runtime values no document can carry ────────────────────────────────
  dataSource: { readers: [LOOKUP], why: 'RUNTIME SLOT — a data-source adapter instance; the form hands the widget its own.' },
  onCreateNew: { readers: [LOOKUP], why: 'RUNTIME SLOT — a host-supplied function; JSON has no function value (the objectui#6124 shape).' },
  onUploadingChange: {
    readers: ['props@fields/src/widgets/AvatarField.tsx', 'props@fields/src/widgets/FileField.tsx', 'props@fields/src/widgets/ImageField.tsx'],
    why: 'RUNTIME SLOT — a host-supplied function; JSON has no function value (the objectui#6124 shape).',
  },
  // ── runtime-only, by an existing ruling ─────────────────────────────────
  field: {
    readers: ['entry@components/src/renderers/form/form.tsx', 'entry@core/src/validation/server-owned-value.ts', LOOKUP, USER],
    why: 'RUNTIME-ONLY (objectui#6609) — the resolved object-field metadata stash; in the authored vocabulary the same '
      + 'key names an object field (objectui#3090).',
  },
  mobile_fullscreen: {
    readers: ['entry@fields/src/widgets/RichTextField.tsx'],
    why: 'RUNTIME-ONLY (objectui#3245) — stamped by `ObjectForm` from `ObjectFormSchema.mobile.fullscreenLongText`.',
  },
  currency: {
    readers: [CURRENCY],
    why: 'RUNTIME-ONLY (objectui#11070 round 13) — the spec\'s `FieldSchema` refuses it; `currencyConfig` is the declared spelling.',
  },
};

/**
 * The keys objectui#12130 declared on `FormFieldSchema`, each with the field
 * types whose widget reads it. The face is flat, so each key is accepted on
 * every other type too, where nothing reads it: this map is that list,
 * re-derived on every run.
 */
const DECLARED_BY_12130: Readonly<Record<string, readonly string[]>> = {
  language: ['code'],
  maxSize: ['file', 'image'],
  capture: ['file'],
  crop: ['image'],
  defaultName: ['avatar'],
  allowCreate: ['lookup', 'master_detail'],
  descriptionField: ['lookup', 'master_detail'],
  displayField: ['lookup', 'master_detail', 'user'],
  idField: ['lookup', 'master_detail'],
  lookupColumns: ['lookup', 'master_detail'],
  lookupFilters: ['lookup', 'master_detail', 'user'],
  lookupPageSize: ['lookup', 'master_detail'],
  picker: ['lookup', 'master_detail', 'user'],
  subtitle: ['lookup', 'master_detail', 'user'],
  avatarField: ['lookup', 'master_detail', 'user'],
  // Round 3. The spec's number: the form renderer's own number input reads it
  // too, under `inputType: 'number'`, which no entry here carries (the
  // effects file measures that input).
  step: ['number', 'slider'],
  // Round 3. These widgets read it by name; the built-in branches and every
  // widget that spreads its props onto its control apply it too, which no
  // recorder sees. The effects file measures where it lands, type by type.
  className: [
    'checkboxes', 'currency', 'filter-condition', 'multiselect', 'object-ref', 'password',
    'percent', 'radio', 'rating', 'recipient-picker', 'tags',
  ],
};

/* ── the census ──────────────────────────────────────────────────────────── */

const { census, unattributed } = await takeCensus();
const declared = new Set(Object.keys(FormFieldSchema.shape));
const readers = (key: string) => [...(census.get(key)?.readers ?? [])].sort();

describe('the instrument sees the channel (objectui#12130)', () => {
  it('every registered field widget was unwrapped and re-registered with recorded props', () => {
    expect([...unwrapped].filter(([, ok]) => !ok).map(([type]) => type)).toEqual([]);
  });

  it('every read on the channel is attributed to a source module', () => {
    expect(unattributed.map((r) => `${r.type}: ${r.key}`)).toEqual([]);
  });

  it('CONTROL: it records reads by all three readers — the form renderer, a widget off its carrier, a widget off its props', () => {
    // Declared keys, so these rows say nothing about the ledger: they say the
    // recorders reached each reader the ledger could name.
    expect(readers('visibleWhen')).toContain('entry@components/src/renderers/form/form.tsx');
    expect(readers('scale')).toContain('entry@fields/src/widgets/NumberField.tsx');
    expect(readers('reference')).toContain('entry@fields/src/widgets/LookupField.tsx');
    expect(readers('dependsOn')).toContain('props@fields/src/widgets/MultiSelectField.tsx');
  });

  it('CONTROL: neither key objectui#12130 was filed for is read by name anywhere on the channel', () => {
    expect(census.has('defaultValue')).toBe(false);
    expect(census.has('defaultChecked')).toBe(false);
  });
});

describe('every key the channel reads is declared on FormFieldSchema, or ledgered (objectui#12130)', () => {
  it('the undeclared reads are exactly the ledger', () => {
    const undeclared = [...census.keys()].filter((k) => !declared.has(k)).sort();
    const unexpected = undeclared.filter((k) => !(k in LEDGER)).map((k) => `${k} ← ${readers(k).join(', ')}`);
    const gone = Object.keys(LEDGER).filter((k) => !undeclared.includes(k));
    expect({ unexpected, gone }).toEqual({ unexpected: [], gone: [] });
  });

  it.each(Object.entries(LEDGER))('ledger row `%s` names exactly the readers the census records', (key, row) => {
    expect(readers(key)).toEqual([...row.readers].sort());
  });

  it.each(Object.entries(DECLARED_BY_12130))('`%s` is declared, and read only by the types named for it', (key, types) => {
    expect(declared.has(key)).toBe(true);
    expect([...(census.get(key)?.types ?? [])].sort()).toEqual([...types].sort());
  });
});

