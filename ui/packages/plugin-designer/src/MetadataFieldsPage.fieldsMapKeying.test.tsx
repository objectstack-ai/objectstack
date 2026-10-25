/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6489 — `MetadataFieldsPage` builds its `fields` MAP by defining own
 * properties, and refuses the three inputs a name-keyed map cannot carry.
 *
 * This is the plugin-designer half of the objectui#5761 parity family, ported
 * from the app-shell writer objectui#6240 already closed
 * (`MetadataService.toFieldsMap`, pinned in
 * `MetadataService.objectPayloadFieldsMap.test.ts`). Same three refusals, same
 * construction, so the two object writers cannot drift.
 *
 * The page used to build the map by blind assignment:
 *
 *     const nextFields: Record<string, ServerFieldSchema> = {};
 *     for (const f of next) nextFields[f.name] = fromDesignerField(f, prevFields[f.name]);
 *
 * ## Why the spec cannot be the one to catch this
 *
 * Measured against the installed `@objectstack/spec` 17.2.0 and asserted in
 * `the instrument` below — both hazards parse GREEN once they have been keyed:
 *
 *   - `fields: { undefined: … }`  => success = true. A nameless field keys as
 *     the literal string `"undefined"`, so it is STORED, with no reader
 *     anywhere. A silently corrupt document instead of a loud refusal.
 *   - `fields: { __proto__: … }`  => success = true. `__proto__` matches the
 *     record's key rule `/^[a-z_][a-z0-9_]*$/`, so it is an authorable field
 *     name — and `map['__proto__'] = def` does not create a key at all, it
 *     invokes the prototype setter. The field vanished from the serialised
 *     body while the spec stood ready to accept it. That is what makes
 *     `Object.fromEntries` load-bearing here rather than stylistic.
 *     ⚠️ `@objectstack/spec` 17.5.0 refuses this name BY NAME (objectui#11073
 *     re-pinned `the instrument`), which keeps the load-bearing part: the
 *     refusal can name the field only if the serialised body still carries
 *     it, and a document stored before 17.5.0 still arrives with it.
 *
 * The third refusal, duplicates, is the conversion's OWN hazard: a designer
 * list can carry two fields called `amount` and a map cannot, so the later one
 * silently swallowed the earlier.
 *
 * ## Two mechanics this file depends on, both easy to get backwards
 *
 *   - **`{ __proto__: v }` in an object literal SETS THE PROTOTYPE** (Annex
 *     B.3.1) — it does not create a key. Every fixture below therefore spells
 *     the key `['__proto__']`, a computed key, which defines an own property.
 *     A fixture written the plain way tests `{}` with an odd prototype and
 *     passes for the wrong reason.
 *   - **`JSON.parse` DOES create an own `__proto__` property**, so a captured
 *     request body reads the key back honestly. Every assertion here is on the
 *     PUT bytes, parsed back — the same discipline as the file's siblings
 *     `MetadataFieldsPage.saveEnvelope` and `.specKeyReference`, and the only
 *     level at which "the field vanished" is visible at all.
 *
 * ## Where the refusal surfaces
 *
 * In the sibling writer the refusal throws to its caller — `MetadataService` is
 * a service. Here the caller is `onFieldsChange={(next) => { void
 * handleFieldsChange(next); }}`, so a throw would become an unhandled rejection
 * and the author would see NOTHING: the same silent failure wearing a different
 * spelling. The port therefore raises inside the page's existing error path, so
 * the refusal lands in the `metadata-fields-page-error` surface the save path
 * already renders. What both writers share is the invariant that matters: the
 * refusal happens BEFORE the request, and no PUT is issued.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';

// ---------------------------------------------------------------------------
// Fixtures — the wire, both directions
// ---------------------------------------------------------------------------

/** The plain object document most cases start from. */
const BASE_BODY = {
  name: 'probe_widget',
  label: 'Widget',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    amount: { type: 'number', label: 'Amount', precision: 2 },
  },
};

/**
 * A document that ALREADY stores a field named `__proto__`, written with a
 * computed key so it is an own property (see the header note). `JSON.stringify`
 * in the fetch double emits it as `{"__proto__": …}`, which is what a server
 * sends for a document stored while the spec still accepted the name (through
 * `@objectstack/spec` 17.4.0). Since 17.5.0 the spec refuses it as a `fields`
 * key (`describe('the instrument')` below), so the server refuses a save that
 * carries it, at `fields.__proto__`; a document stored before then is still
 * served with it, and that is the case this fixture models. This file's fetch
 * double accepts every PUT: the cases here measure the client's writer, not
 * the server's gate.
 */
const PROTO_BODY = {
  name: 'probe_widget',
  label: 'Widget',
  fields: {
    name: { type: 'text', label: 'Name' },
    ['__proto__']: { type: 'text', label: 'Proto', inlineHelpText: 'Stored before the spec refused this name.' },
  },
};

let served: Record<string, unknown> = BASE_BODY;

const envelope = () => ({
  type: 'object',
  name: 'probe_widget',
  item: served,
  lock: 'none',
  provenance: 'org',
  editable: true,
});

interface RecordedDesignerProps {
  objectName: string;
  fields: DesignerFieldDefinition[];
  onFieldsChange?: (fields: DesignerFieldDefinition[]) => void;
  readOnly?: boolean;
}

let designerProps: RecordedDesignerProps | null = null;

vi.mock('./FieldDesigner', () => ({
  FieldDesigner: (props: RecordedDesignerProps) => {
    designerProps = props;
    return null;
  },
}));

import { MetadataFieldsPage } from './MetadataFieldsPage';

/** Every PUT body, parsed back from the bytes that went over the wire. */
let puts: Array<Record<string, unknown>> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Nothing here mocks the client — this is the transport underneath a real one. */
function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return json({ success: true, name: 'probe_widget' });
      }
      if (/\/meta\/object\/probe_widget(\?|$)/.test(url)) return json(envelope());
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

async function renderPage() {
  render(<MetadataFieldsPage objectName="probe_widget" client={realClient()} />);
  await waitFor(() => expect(designerProps).not.toBeNull());
}

/** The fields map exactly as it went over the wire on the last PUT. */
function savedFields(): Record<string, Record<string, unknown>> {
  return puts[puts.length - 1].fields as Record<string, Record<string, unknown>>;
}

/**
 * Read one entry as an OWN property. Written this way because the whole subject
 * of this file is the difference between an own key and the prototype chain: a
 * bare `map[name]` would answer for `Object.prototype` and report a field that
 * is not there.
 */
function own(map: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(map, key)
    ? Object.getOwnPropertyDescriptor(map, key)!.value
    : undefined;
}

const field = (name: string, over: Partial<DesignerFieldDefinition> = {}): DesignerFieldDefinition => ({
  id: name,
  name,
  label: name,
  type: 'text',
  ...over,
});

/** Hand the page a field list and let its save path run to completion. */
async function emit(next: DesignerFieldDefinition[]) {
  await act(async () => {
    designerProps!.onFieldsChange!(next);
  });
}

/** The refusal text the page renders, or `null` while there is none. */
function shownError(): string | null {
  return screen.queryByTestId('metadata-fields-page-error')?.textContent ?? null;
}

const issuesOf = (result: ReturnType<typeof ObjectSchema.safeParse>): string[] =>
  result.success ? [] : result.error.issues.map((i) => `${i.code} @ ${i.path.join('.')}`);

const parseWithFields = (fields: Record<string, unknown>) =>
  ObjectSchema.safeParse({ name: 'account', label: 'Account', fields });

beforeEach(() => {
  served = BASE_BODY;
  puts = [];
  designerProps = null;
});

afterEach(() => {
  designerProps = null;
});

// ---------------------------------------------------------------------------

describe('the instrument', () => {
  it('does NOT catch a nameless field once keyed — `{ undefined: … }` parses GREEN', () => {
    // The measured reason this page has to be the one that refuses. If this
    // ever goes false the guard is still right, but its justification changed.
    expect(parseWithFields({ undefined: { type: 'text', label: 'N' } }).success).toBe(true);
  });

  it('refuses `__proto__` BY NAME since 17.5.0 — a refusal that reaches the author only if the key survives', () => {
    // Through `@objectstack/spec` 17.4.0 this row read `success === true`: the
    // spec would have accepted what assignment threw away. 17.5.0 refuses the
    // name at the key, by name (`z.record()` drops it from its output while
    // reporting success), so keeping it in the body is now what lets that
    // refusal name the field instead of the save silently losing it
    // (objectui#11073 re-pin).
    expect(issuesOf(parseWithFields({ ['__proto__']: { type: 'text', label: 'P' } }))).toEqual([
      'custom @ fields.__proto__',
    ]);
    // Control, so the line above is a verdict about this key rather than a
    // schema that accepts anything: a camelCase name is refused AT THE KEY.
    expect(issuesOf(parseWithFields({ firstName: { type: 'text', label: 'F' } }))).toEqual([
      'invalid_key @ fields.firstName',
    ]);
  });

  it('is JavaScript itself: assignment drops `__proto__`, `Object.fromEntries` keeps it', () => {
    // The defect and the fix, stated on plain objects before any claim about
    // the page. `JSON.stringify` is what the request body is made of, so the
    // second half of each pair is the byte-level consequence.
    const assigned: Record<string, unknown> = {};
    assigned['__proto__'] = { type: 'text', label: 'P' };
    assigned['amount'] = { type: 'number', label: 'A' };
    expect(Object.keys(assigned)).toEqual(['amount']);
    expect(JSON.stringify(assigned)).toBe('{"amount":{"type":"number","label":"A"}}');

    const built = Object.fromEntries([
      ['__proto__', { type: 'text', label: 'P' }],
      ['amount', { type: 'number', label: 'A' }],
    ]);
    expect(Object.keys(built)).toEqual(['__proto__', 'amount']);

    // …and the nameless half of the same mechanic.
    const nameless: Record<string, unknown> = {};
    nameless[undefined as unknown as string] = { type: 'text' };
    expect(Object.keys(nameless)).toEqual(['undefined']);
  });

  it('is a fixture rule too: `{ __proto__: v }` in a LITERAL sets the prototype, it does not add a key', () => {
    // Why every fixture in this file spells the key `['__proto__']`. A fixture
    // written the plain way carries zero own keys and passes for the wrong
    // reason — the assertion would be about `{}`.
    const plain = { __proto__: { type: 'text', label: 'P' } } as Record<string, unknown>;
    expect(Object.keys(plain)).toEqual([]);
    const computed = { ['__proto__']: { type: 'text', label: 'P' } } as Record<string, unknown>;
    expect(Object.keys(computed)).toEqual(['__proto__']);
    // And the reason assertions on captured bytes are honest: JSON.parse
    // defines an own property rather than invoking the setter.
    expect(Object.keys(JSON.parse('{"__proto__":{"type":"text"}}'))).toEqual(['__proto__']);
  });
});

describe('objectui#6489 · the map the page PUTs is built as own properties', () => {
  it('C0 (control): an ordinary edit still PUTs one name-keyed map, in declaration order', async () => {
    // Green before and after this card. Its job is to prove the cases below
    // are about the map construction and not about a save that stopped firing
    // — and to hold `fromDesignerField`'s carry-over, which this card must not
    // touch (objectui#6488 copied that exact form into the app-shell writer).
    await renderPage();
    await emit([
      field('name', { label: 'Full name', required: true }),
      field('amount', { type: 'number', label: 'Amount' }),
    ]);
    await waitFor(() => expect(puts).toHaveLength(1));

    expect(Object.keys(savedFields())).toEqual(['name', 'amount']);
    expect(savedFields().name).toMatchObject({ type: 'text', label: 'Full name', required: true });
    // The per-field key the designer renders no control for: it survives only
    // through `carryOver(prev)`, which the new construction still feeds.
    expect(savedFields().amount.precision).toBe(2);
    expect(shownError()).toBeNull();
  });

  it('H2: a field named `__proto__` reaches the wire instead of vanishing', async () => {
    // THE case this card exists for. Built by assignment the entry invoked the
    // prototype setter and never appeared in the serialised body at all, while
    // the spec (see `the instrument`) stood ready to accept it.
    await renderPage();
    await emit([
      field('name', { label: 'Name' }),
      field('__proto__', { label: 'Proto' }),
      field('amount', { type: 'number', label: 'Amount' }),
    ]);
    await waitFor(() => expect(puts).toHaveLength(1));

    expect(Object.keys(savedFields())).toEqual(['name', '__proto__', 'amount']);
    expect(own(savedFields(), '__proto__')).toMatchObject({ type: 'text', label: 'Proto' });
    // The whole body, not just the map: the key really is in the bytes.
    expect(JSON.stringify(puts[0])).toContain('"__proto__"');
    expect(shownError()).toBeNull();
  });

  it('H2 (round trip): a stored `__proto__` field loads, and its unknown server key carries back out', async () => {
    // The read half. `toDesignerField` walks `Object.entries`, which sees the
    // own property `JSON.parse` created — so the field is offered for editing,
    // and re-saving it must not drop what the server sent inside it.
    served = PROTO_BODY;
    await renderPage();
    expect(designerProps!.fields.map((f) => f.name)).toEqual(['name', '__proto__']);

    await emit(designerProps!.fields.map((f) => (f.name === '__proto__' ? { ...f, label: 'Renamed' } : f)));
    await waitFor(() => expect(puts).toHaveLength(1));

    expect(Object.keys(savedFields())).toEqual(['name', '__proto__']);
    expect(own(savedFields(), '__proto__')).toMatchObject({
      type: 'text',
      label: 'Renamed',
      inlineHelpText: 'Stored before the spec refused this name.',
    });
  });
});

describe('objectui#6489 · the three inputs a name-keyed map cannot carry are REFUSED before the request', () => {
  it('H1: a nameless field is refused — nothing is sent, and the author is told', async () => {
    // Not a throw into the void: `onFieldsChange` is fire-and-forget, so the
    // refusal has to land where the page already shows save failures.
    await renderPage();
    await emit([
      field('name'),
      { id: 'x', label: 'Nameless', type: 'text' } as unknown as DesignerFieldDefinition,
    ]);
    await waitFor(() => expect(shownError()).not.toBeNull());

    expect(shownError()).toMatch(/has no `name`/);
    // The half a "it failed" assertion cannot see: no `{ undefined: … }` entry
    // was written, because no request was issued at all.
    expect(puts).toHaveLength(0);
  });

  it('H1: the message names the offending position, so it is actionable', async () => {
    await renderPage();
    await emit([
      field('name'),
      { id: 'x', label: 'Nameless', type: 'text' } as unknown as DesignerFieldDefinition,
    ]);
    await waitFor(() => expect(shownError()).not.toBeNull());
    expect(shownError()).toMatch(/index 1/);
  });

  it('H1: a blank name counts as no name — `"   "` would key as whitespace', async () => {
    await renderPage();
    await emit([field('   ', { label: 'Blank' })]);
    await waitFor(() => expect(shownError()).not.toBeNull());

    expect(shownError()).toMatch(/has no `name`/);
    expect(puts).toHaveLength(0);
  });

  it('H3: duplicate names are refused rather than collapsed into one entry', async () => {
    // An array carries two entries called `amount`; a map cannot, so the second
    // silently swallowed the first. The loss is introduced BY the conversion,
    // so the conversion is what has to refuse it.
    await renderPage();
    await emit([
      field('amount', { type: 'number', label: 'Amount' }),
      field('amount', { label: 'Amount again' }),
    ]);
    await waitFor(() => expect(shownError()).not.toBeNull());

    expect(shownError()).toMatch(/duplicate field name `amount`/);
    expect(shownError()).toMatch(/index 1/);
    expect(puts).toHaveLength(0);
  });

  it('a refusal is not a dead end — the next valid save goes out', async () => {
    // The refusal leaves no half-written state behind: it happens before the
    // request, so correcting the list and saving again just works.
    await renderPage();
    await emit([field('amount'), field('amount', { label: 'Dup' })]);
    await waitFor(() => expect(shownError()).not.toBeNull());
    expect(puts).toHaveLength(0);

    await emit([field('amount', { type: 'number', label: 'Amount' })]);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(Object.keys(savedFields())).toEqual(['amount']);
  });
});
