// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29181 — the action inspector authors a script body's
 * `body.capabilities`.
 *
 * The sandbox refuses every `ctx` call a body was not granted, and the action
 * editor kept `capabilities` in the JS body's key set while drawing no control
 * for it: a Studio-authored script action that read or wrote data was refused
 * on every click, and only raw metadata could grant it. The Hook inspector's
 * Capabilities control (objectstack#26726) is now shared with this editor.
 *
 * FIXTURE DISCIPLINE: the pins drive the real inspector inside a host that
 * merges each patch shallowly (as `ObjectActionsPanel` applies `onPatch`), send
 * the held draft through a JSON round trip (the body the save sends), and parse
 * it with the spec's own `ActionSchema`, so a case cannot pass on a shape the
 * spec refuses. The token list is compared with the spec enum, not restated.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ActionSchema } from '@objectstack/spec/ui';
import { HookBodyCapability } from '@objectstack/spec/data';

// The inspector calls `useObjectOptions()` / `useObjectFields()` /
// `useMetaOptions()` on mount. Stub the shared client so nothing reaches the
// network; nothing below reads the catalog.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { t } from '../i18n';
import { ActionDefaultInspector } from './ActionDefaultInspector';
// `engine.inspector.*` rows live in the lazy `studio` namespace (objectstack#25922).
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

afterEach(cleanup);

type Draft = Record<string, unknown>;

const RUN_A_SCRIPT = 'Run a script — sandboxed JS / expression body';
const EXPRESSION = 'Expression (L1)';
const SANDBOXED_JS = 'Sandboxed JS (L2)';
const CONTROL = 'action-body-capabilities';

/** The skeleton Studio's New button adds (an update action, no code). */
const NEW_ACTION: Draft = {
  name: 'invoice_action_1',
  label: 'New action',
  objectName: 'invoice',
  locations: ['record_header'],
  operation: 'update',
  patch: {},
};

/** A stored script action with a JS body that grants nothing. */
const STORED_JS: Draft = {
  name: 'invoice_stamp',
  label: 'Stamp',
  objectName: 'invoice',
  locations: ['record_more'],
  type: 'script',
  body: { language: 'js', source: 'return { ok: true };' },
};

const WRITE_SOURCE = "await ctx.api.object('invoice').update({ id: ctx.recordId, stamp: 'x' }); return { ok: true };";

/** A host that holds the draft and merges each patch the way the action hosts do. */
function mountHost(initial: Draft, locale = 'en-US') {
  const seen: { draft: Draft; writes: Draft[] } = { draft: initial, writes: [] };
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    seen.draft = draft;
    return (
      <ActionDefaultInspector
        type="action"
        name={String(initial.name)}
        locale={locale as never}
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

/** The draft the save sends: the held draft through the JSON wire. */
const sent = (draft: Draft): Draft => JSON.parse(JSON.stringify(draft));

/** The spec's refusals of the sent draft, as `path:code`; empty when it parses. */
function refusals(draft: Draft): string[] {
  const parsed = ActionSchema.safeParse(sent(draft));
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}:${i.code}`);
}

async function pick(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

function typeSource(source: string) {
  fireEvent.change(screen.getByPlaceholderText(/\(input, ctx\) => result/), { target: { value: source } });
}

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const bodyOf = (draft: Draft) => sent(draft).body as Draft;

describe('ActionDefaultInspector — script body capabilities (objectstack#29181)', () => {
  it('the card path: Run a script → Sandboxed JS shows the control; ticking api.write grants it and the action parses', async () => {
    const seen = mountHost(NEW_ACTION);
    await pick('What it does', RUN_A_SCRIPT);
    // The seeded language is the expression one: no grant list yet.
    expect(screen.queryByTestId(CONTROL)).toBeNull();

    await pick('Script language', SANDBOXED_JS);
    typeSource(WRITE_SOURCE);

    const control = screen.getByTestId(CONTROL);
    const names = within(control)
      .getAllByRole('checkbox')
      .map((el) => el.closest('label')!.textContent);
    expect(names).toEqual([...HookBodyCapability.options]);
    expect(within(control).getByText('ctx.api.object(…).insert / update / delete / updateMany / deleteMany / upsert')).toBeInTheDocument();
    // The hint names the action, not the hook.
    expect(within(control).getByText(t('engine.inspector.action.capabilitiesHint', 'en-US'))).toBeInTheDocument();

    fireEvent.click(box('api.write'));

    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'js', source: WRITE_SOURCE, capabilities: ['api.write'] });
    expect(seen.draft.type).toBe('script');
    expect(refusals(seen.draft)).toEqual([]);
    expect(ActionSchema.parse(sent(seen.draft)).body).toMatchObject({ capabilities: ['api.write'] });
  });

  it('an expression body shows no control, and its edits never write the key', () => {
    const seen = mountHost({ ...STORED_JS, body: { language: 'expression', source: 'true' } });
    expect(screen.getByRole('combobox', { name: 'Script language' })).toHaveTextContent(EXPRESSION);
    expect(screen.queryByTestId(CONTROL)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'api.read' })).toBeNull();

    typeSource('1 == 1');
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'expression', source: '1 == 1' });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('a stored JS action without capabilities loads with nothing ticked and round-trips unchanged', () => {
    const seen = mountHost(STORED_JS);
    expect(screen.getByTestId(CONTROL)).toBeInTheDocument();
    for (const token of HookBodyCapability.options) expect(box(token).checked).toBe(false);
    // Rendering writes nothing.
    expect(seen.writes).toEqual([]);

    // A source edit keeps the body's shape: no `capabilities` key appears.
    typeSource('return { ok: false };');
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'js', source: 'return { ok: false };' });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('an existing grant is shown ticked; a new one is written in spec order; clearing the last writes []', () => {
    const seen = mountHost({ ...STORED_JS, body: { language: 'js', source: 'return 1;', capabilities: ['log', 'api.read'] } });
    expect(box('api.read').checked).toBe(true);
    expect(box('log').checked).toBe(true);
    expect(box('api.write').checked).toBe(false);

    fireEvent.click(box('api.write'));
    expect(bodyOf(seen.draft).capabilities).toEqual(['api.read', 'api.write', 'log']);
    expect(refusals(seen.draft)).toEqual([]);

    for (const token of ['api.read', 'api.write', 'log']) fireEvent.click(box(token));
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'js', source: 'return 1;', capabilities: [] });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('switching a granted JS body to expression drops the grant and hides the control, so the save parses', async () => {
    const seen = mountHost({ ...STORED_JS, body: { language: 'js', source: 'true', capabilities: ['api.read'] } });
    expect(screen.getByTestId(CONTROL)).toBeInTheDocument();

    await pick('Script language', EXPRESSION);

    expect(screen.queryByTestId(CONTROL)).toBeNull();
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'expression', source: 'true' });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('reads its words in the designer locale', () => {
    mountHost(STORED_JS, 'zh-CN');
    const control = screen.getByTestId(CONTROL);
    const hint = t('engine.inspector.action.capabilitiesHint', 'zh-CN');
    expect(hint).not.toBe(t('engine.inspector.action.capabilitiesHint', 'en-US'));
    expect(within(control).getByText(hint)).toBeInTheDocument();
    expect(within(control).getByText(t('engine.inspector.hook.capabilities', 'zh-CN'))).toBeInTheDocument();
  });
});
