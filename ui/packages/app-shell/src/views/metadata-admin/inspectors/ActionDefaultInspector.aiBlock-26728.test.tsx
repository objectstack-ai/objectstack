// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26728 — "Expose to AI agents" writes the spec's nested `ai`
 * block, and unticking leaves a draft the spec accepts.
 *
 * The control used to write a flat `aiExposed` (and its description a flat
 * `aiDescription`). The spec's `ActionSchema` refuses both by name, so one tick
 * refused every later save of the object, and unticking wrote `aiExposed:
 * false`, still refused. The pins drive the real inspector inside a host that
 * merges each patch shallowly (as `ObjectActionsPanel` applies `onPatch`), send
 * the held draft through a JSON round trip (the body the save sends), and parse
 * it with the spec's own `ActionSchema`:
 *
 *  - a tick writes `ai.exposed`, and the spec's only refusal is the
 *    description it requires beside it — the input the inspector opens;
 *  - a description of the spec's minimum length parses, and reads back;
 *  - unticking parses, with or without a description typed;
 *  - an older draft carrying the flat keys parses after the control's next
 *    write, which clears them;
 *  - the other `ai` keys (edited under "More fields") are kept.
 *
 * Parity: `AI_DESCRIPTION_MIN` is the spec's own minimum, measured both sides.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ActionSchema } from '@objectstack/spec/ui';

// objectui#4697: the inspector reads the shared client on mount; stub it so
// nothing reaches the network, as the sibling inspector suites do.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { ActionDefaultInspector, AI_DESCRIPTION_MIN } from './ActionDefaultInspector';

afterEach(cleanup);

type Draft = Record<string, unknown>;

const SCRIPT_ACTION: Draft = {
  name: 'invoice_send',
  label: 'Send',
  objectName: 'invoice',
  locations: ['record_more'],
  type: 'script',
  body: { language: 'expression', source: 'true' },
};

const DESCRIPTION = 'Send the invoice to its customer once it has been approved by finance.';

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

const exposeBox = () => screen.getByRole('checkbox', { name: 'Expose to AI agents' });
const typeDescription = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText('When and why an agent should call this action…'), { target: { value: text } });

describe('aiBlockPin — "Expose to AI agents" writes the nested ai block (objectstack#26728)', () => {
  it('a tick writes ai.exposed, never a flat key; the only refusal is the description it requires', () => {
    const seen = mountHost(SCRIPT_ACTION);
    expect(refusals(seen.draft)).toEqual([]);

    fireEvent.click(exposeBox());
    expect(seen.writes.at(-1)).toStrictEqual({ ai: { exposed: true } });
    expect(sent(seen.draft)).not.toHaveProperty('aiExposed');
    // Before the fix: `:unrecognized_keys` at the action, on every later save.
    expect(refusals(seen.draft)).toEqual(['ai.description:custom']);
    expect(exposeBox()).toBeChecked();
  });

  it('a description of the spec minimum parses, and reads back into the box', () => {
    const seen = mountHost(SCRIPT_ACTION);
    fireEvent.click(exposeBox());
    typeDescription('short');
    expect(refusals(seen.draft)).toEqual(['ai.description:too_small']);

    typeDescription(DESCRIPTION);
    expect(sent(seen.draft).ai).toStrictEqual({ exposed: true, description: DESCRIPTION });
    expect(refusals(seen.draft)).toEqual([]);
    expect(screen.getByPlaceholderText('When and why an agent should call this action…')).toHaveValue(DESCRIPTION);
  });

  it('unticking parses: a finished description is kept, one the spec would refuse goes with the box', () => {
    const seen = mountHost(SCRIPT_ACTION);
    fireEvent.click(exposeBox());
    typeDescription(DESCRIPTION);
    fireEvent.click(exposeBox());
    expect(sent(seen.draft).ai).toStrictEqual({ exposed: false, description: DESCRIPTION });
    expect(refusals(seen.draft)).toEqual([]);

    fireEvent.click(exposeBox());
    typeDescription('short');
    fireEvent.click(exposeBox());
    expect(sent(seen.draft).ai).toStrictEqual({ exposed: false });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('an older draft carrying the flat keys parses after the control\'s next write', () => {
    // The shape the control wrote before this fix: refused at the action.
    const seen = mountHost({ ...SCRIPT_ACTION, aiExposed: true, aiDescription: 'x' });
    expect(refusals(seen.draft)).toEqual([':unrecognized_keys']);
    // The flat keys are never read: the box is unticked.
    expect(exposeBox()).not.toBeChecked();

    fireEvent.click(exposeBox());
    fireEvent.click(exposeBox());
    expect(sent(seen.draft)).not.toHaveProperty('aiExposed');
    expect(sent(seen.draft)).not.toHaveProperty('aiDescription');
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('control: the other ai keys are kept through a tick and an untick', () => {
    const seen = mountHost({ ...SCRIPT_ACTION, ai: { category: 'data', requiresConfirmation: true } });
    fireEvent.click(exposeBox());
    typeDescription(DESCRIPTION);
    expect(sent(seen.draft).ai).toStrictEqual({ category: 'data', requiresConfirmation: true, exposed: true, description: DESCRIPTION });
    expect(refusals(seen.draft)).toEqual([]);
  });
});

describe('aiBlockPin — AI_DESCRIPTION_MIN is the spec minimum (objectstack#26728)', () => {
  const withDescription = (length: number): Draft => ({ ...SCRIPT_ACTION, ai: { exposed: true, description: 'x'.repeat(length) } });

  it('the spec accepts a description of that length and refuses one shorter', () => {
    expect(refusals(withDescription(AI_DESCRIPTION_MIN))).toEqual([]);
    expect(refusals(withDescription(AI_DESCRIPTION_MIN - 1))).toEqual(['ai.description:too_small']);
  });
});
