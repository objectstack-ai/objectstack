// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26736 — a Type switch leaves a draft the spec can accept, and
 * Body Shape writes only the spec's two shapes.
 *
 * Measured before the fix: type a script body, switch Type to API, and the
 * `body` stayed. The spec refused it ("`body` only runs for `type: 'script'`")
 * and every later save of the object with it. Body Shape was a free-text box:
 * typing the documented `{"wrap":"payload"}` wrote a string the spec's union
 * refuses, and a stored `{ wrap: 'payload' }` re-saved as one.
 *
 * The pins drive the real inspector in a host that merges each patch
 * shallowly, and parse the sent draft with the spec's `ActionSchema`. What a
 * switch leaves for the author to fill (a `target`, a script's source) is the
 * Data pillar's to hold, not refused: `metadataError.actionHeld-26736.test.ts`
 * pins that judge.
 *
 * Parity: `TYPE_SCOPED_KEYS` is written out in the inspector; the last block
 * parses each of its keys on every `ActionType` with the spec, both ways.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ActionSchema, ActionType } from '@objectstack/spec/ui';

const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { ActionDefaultInspector, TYPE_SCOPED_KEYS } from './ActionDefaultInspector';

afterEach(cleanup);

type Draft = Record<string, unknown>;

function mountHost(initial: Draft) {
  const seen: { draft: Draft; writes: Draft[] } = { draft: initial, writes: [] };
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    seen.draft = draft;
    return (
      <ActionDefaultInspector
        type="action"
        name={String(initial.name)}
        locale={'en-US' as never}
        readOnly={false}
        draft={draft}
        onPatch={(patch) => {
          seen.writes.push(patch);
          setDraft((d) => ({ ...d, ...patch }));
        }}
      />
    );
  }
  render(<Host />);
  return seen;
}

const sent = (draft: Draft): Draft => JSON.parse(JSON.stringify(draft));

function refusals(draft: Draft): string[] {
  const parsed = ActionSchema.safeParse(sent(draft));
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}:${i.code}`);
}

async function pick(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

/** The text input under a visible label. */
function inputUnder(label: string): HTMLInputElement {
  const lab = screen.getByText(label, { selector: 'label' });
  return lab.parentElement!.querySelector('input') as HTMLInputElement;
}

const SCRIPT_ACTION: Draft = {
  name: 'invoice_sync',
  label: 'Sync',
  objectName: 'invoice',
  locations: ['record_more'],
  type: 'script',
  body: { language: 'expression', source: 'true' },
};

const API = 'API — call an endpoint';
const FLAT = 'Flat — inputs at the top level';
const WRAP = 'Wrap — inputs nested under a key';

describe('typeSwitchPin — a Type switch drops what the new type refuses (objectstack#26736)', () => {
  it('script with a body → API: the body goes; once the endpoint is typed, the draft parses', async () => {
    const seen = mountHost(SCRIPT_ACTION);
    expect(refusals(seen.draft)).toEqual([]);

    await pick('Type', API);
    expect(seen.writes.at(-1)).toStrictEqual({ type: 'api', body: undefined });
    // Before the fix `body:custom` stood here too, on every later save. What
    // remains is the input the switch put in front of the author.
    expect(refusals(seen.draft)).toEqual(['target:custom']);

    fireEvent.change(inputUnder('API endpoint *'), { target: { value: '/api/v1/sync' } });
    expect(refusals(seen.draft)).toEqual([]);

    // The later edits the card saw refused now land on a draft that parses.
    await pick('Method', 'PATCH');
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('each type-scoped key the draft holds is cleared on a switch to a type that refuses it', async () => {
    const seen = mountHost({
      ...SCRIPT_ACTION,
      onSuccess: { navigate: '/app/invoice' },
      outcomeMessages: { sent: 'Sent.' },
      undoable: false,
    });
    expect(refusals(seen.draft)).toEqual([]);

    await pick('Type', 'Modal — open a modal/page');
    // `undoable: false` is accepted on every type, so it stays.
    expect(seen.writes.at(-1)).toStrictEqual({ type: 'modal', body: undefined, onSuccess: undefined, outcomeMessages: undefined });
    expect(refusals({ ...seen.draft, target: 'invoice_page' })).toEqual([]);
  });

  it('control: a switch with nothing to clear writes the type alone, and the target is kept', async () => {
    const seen = mountHost({ ...SCRIPT_ACTION, type: 'flow', body: undefined, target: 'approve_invoice' });
    await pick('Type', API);
    expect(seen.writes).toStrictEqual([{ type: 'api' }]);
    expect(refusals(seen.draft)).toEqual([]);
  });
});

describe('bodyShapePin — Body Shape is Flat or Wrap under a key (objectstack#26736)', () => {
  const API_ACTION: Draft = { ...SCRIPT_ACTION, type: 'api', body: undefined, target: '/api/v1/sync' };

  it('a stored { wrap } reads back as Wrap with its key, and re-saves as written', () => {
    const seen = mountHost({ ...API_ACTION, bodyShape: { wrap: 'payload' } });
    expect(screen.getByRole('combobox', { name: 'Body shape' })).toHaveTextContent(WRAP);
    expect(inputUnder('Wrap key')).toHaveValue('payload');
    expect(sent(seen.draft).bodyShape).toStrictEqual({ wrap: 'payload' });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('Wrap writes nothing until it has a key, then { wrap: KEY }; Flat writes \'flat\'', async () => {
    const seen = mountHost(API_ACTION);
    expect(screen.getByRole('combobox', { name: 'Body shape' })).toHaveTextContent(FLAT);

    await pick('Body shape', WRAP);
    expect(seen.writes).toStrictEqual([]);
    fireEvent.change(inputUnder('Wrap key'), { target: { value: 'data' } });
    expect(sent(seen.draft).bodyShape).toStrictEqual({ wrap: 'data' });
    expect(refusals(seen.draft)).toEqual([]);

    // Clearing the key takes the shape off rather than writing `{ wrap: '' }`.
    fireEvent.change(inputUnder('Wrap key'), { target: { value: '' } });
    expect(sent(seen.draft)).not.toHaveProperty('bodyShape');
    expect(refusals(seen.draft)).toEqual([]);

    await pick('Body shape', FLAT);
    expect(sent(seen.draft).bodyShape).toBe('flat');
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('why a control and not a text box: the spec refuses the JSON text the box wrote', () => {
    expect(refusals({ ...API_ACTION, bodyShape: '{"wrap":"payload"}' })).toEqual(['bodyShape:invalid_union']);
  });

  it('control: no Body shape control on a script action that holds none', () => {
    mountHost(SCRIPT_ACTION);
    expect(screen.queryByRole('combobox', { name: 'Body shape' })).toBeNull();
  });
});

describe('typeSwitchPin — TYPE_SCOPED_KEYS matches the spec (objectstack#26736)', () => {
  /** A minimal action of `type` the spec accepts, before the key under test. */
  const base = (type: string): Draft =>
    type === 'script'
      ? { name: 'probe', label: 'Probe', type, body: { language: 'expression', source: 'true' } }
      : { name: 'probe', label: 'Probe', type, target: type === 'url' ? 'https://example.com' : 'probe_target' };
  const SAMPLE: Record<string, unknown> = {
    body: { language: 'expression', source: 'true' },
    onSuccess: { navigate: '/app/home' },
    outcomeMessages: { done: 'Done.' },
    undoable: true,
  };

  it('every key is accepted on exactly the listed types', () => {
    for (const { key, types, refused } of TYPE_SCOPED_KEYS) {
      expect(refused(SAMPLE[key]), key).toBe(true);
      for (const type of ActionType.options) {
        const issues = refusals({ ...base(type), [key]: SAMPLE[key] }).filter((i) => i.startsWith(`${key}:`));
        expect(issues.length > 0, `${key} on ${type}`).toBe(!types.has(type));
      }
    }
  });

  it('control: every base parses on its own', () => {
    for (const type of ActionType.options) expect(refusals(base(type)), type).toEqual([]);
  });
});
