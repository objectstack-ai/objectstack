// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26734 — a script action authored in Studio is stored with
 * `type: 'script'`, and the Type control shows only a `type` the draft holds.
 *
 * Measured before the fix: New → "Run a script" → a body left the draft as
 * `{ name, body }` with no `type`, while the Type control read Script. The
 * console reads the stored row, finds no `type`, and runs nothing ("is not
 * executable: no handler is registered under that name …"); the same action
 * with `type: 'script'` added through the API ran.
 *
 * The pins drive the real inspector in a host that merges each patch
 * shallowly, and parse the sent draft with the spec's `ActionSchema`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ActionSchema } from '@objectstack/spec/ui';

const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { ActionDefaultInspector } from './ActionDefaultInspector';

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

const typeControl = () => screen.getByRole('combobox', { name: 'Type' });
const scriptBody = () => screen.getByText('Script body', { selector: 'label' }).parentElement!.querySelector('textarea')!;

const SCRIPT = 'Script — run an expression / sandboxed JS';
const RUN_A_SCRIPT = 'Run a script — sandboxed JS / expression body';

/** The skeleton Studio's New starts from (objectui#11820): `type` left to the spec. */
const NEW_UPDATE_ACTION: Draft = {
  name: 'invoice_action_2',
  label: 'New action',
  objectName: 'invoice',
  locations: ['record_header'],
  operation: 'update',
  patch: {},
};

describe('scriptTypePin — a script authored here is stored with its type (objectstack#26734)', () => {
  it('New → "Run a script" → a body: the draft carries `type: \'script\'` and parses', async () => {
    const seen = mountHost(NEW_UPDATE_ACTION);
    // The draft holds no `type`, so the Type control shows none.
    expect(typeControl()).not.toHaveTextContent(SCRIPT);

    await pick('What it does', RUN_A_SCRIPT);
    expect(sent(seen.draft).type).toBe('script');
    expect(typeControl()).toHaveTextContent(SCRIPT);

    fireEvent.change(scriptBody(), { target: { value: 'true' } });
    const stored = sent(seen.draft);
    expect(stored).toMatchObject({ type: 'script', body: { language: 'expression', source: 'true' } });
    expect(stored).not.toHaveProperty('operation');
    expect(stored).not.toHaveProperty('patch');
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('a stored script with no `type` shows none in Type, and its first body edit stores it', () => {
    const seen = mountHost({
      name: 'run_script',
      label: 'Run',
      objectName: 'invoice',
      locations: ['record_more'],
      body: { language: 'expression', source: 'true' },
    });
    expect(typeControl()).not.toHaveTextContent(SCRIPT);
    // The editor for what it will run stays on screen.
    expect(scriptBody()).toHaveValue('true');

    fireEvent.change(scriptBody(), { target: { value: 'false' } });
    expect(seen.writes).toStrictEqual([{ type: 'script', body: { language: 'expression', source: 'false' } }]);
    expect(typeControl()).toHaveTextContent(SCRIPT);
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('the first field value of an update action from New stores `type` too', () => {
    const seen = mountHost(NEW_UPDATE_ACTION);
    fireEvent.click(screen.getByRole('button', { name: 'Add field value' }));
    const field = screen.getByText('Field', { selector: 'label' }).parentElement!.querySelector('input')!;
    fireEvent.change(field, { target: { value: 'status' } });
    expect(seen.writes).toStrictEqual([{ type: 'script', patch: { status: '' } }]);
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('why the panels still show the script editor: the spec gives a draft with no `type` the script route', () => {
    const parsed = ActionSchema.safeParse({ name: 'run_script', label: 'Run', body: { language: 'expression', source: 'true' } });
    expect(parsed.success && parsed.data.type).toBe('script');
  });

  it('control: an action that holds a `type` is written without one', async () => {
    const seen = mountHost({
      name: 'invoice_sync',
      label: 'Sync',
      objectName: 'invoice',
      locations: ['record_more'],
      type: 'script',
      body: { language: 'expression', source: 'true' },
    });
    expect(typeControl()).toHaveTextContent(SCRIPT);
    fireEvent.change(scriptBody(), { target: { value: 'false' } });
    await pick('Script language', 'Sandboxed JS (L2)');
    for (const write of seen.writes) expect(write).not.toHaveProperty('type');
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('control: an api action keeps its type, and Type shows it', () => {
    mountHost({ name: 'invoice_api', label: 'Call', type: 'api', target: '/api/v1/sync' });
    expect(typeControl()).toHaveTextContent('API — call an endpoint');
  });
});
