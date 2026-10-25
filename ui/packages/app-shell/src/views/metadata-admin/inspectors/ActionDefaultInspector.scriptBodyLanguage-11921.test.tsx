// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `scriptBodyPin` — objectui#11921: every script body the action inspector
 * writes names its language, so the spec's `ActionSchema` parses it as soon as
 * the author has typed a source.
 *
 * Since objectui#11820 a new Studio action starts as "Update fields on this
 * record", so "What it does: Run a script" is the path to every script action.
 * That switch used to write no `body`, and the body editor wrote `{ source }`
 * alone: the spec refused the first keystroke at `body.language` ("Invalid
 * discriminator value"), and only an explicit pick of a language that was not
 * the one the picker showed cleared it.
 *
 * Every body write now goes through the inspector's one writer,
 * `writeScriptBody`. The pins below drive the real inspector inside a host that
 * merges each patch shallowly (as `ObjectActionsPanel` and `ResourceEditPage`
 * apply `onPatch`), send the held draft through a JSON round trip (the body the
 * save sends), and parse it with the spec's own `ActionSchema`:
 *
 *  - after the switch, the body names the language the picker shows, and the
 *    spec's ONLY refusal is the missing `body.source`. A body cannot parse
 *    before it has a source: the spec requires a non-empty one in both
 *    languages, and the last case of the first block measures that rather
 *    than claiming it. `source` is the one input only the author can supply,
 *    so nothing is seeded for it;
 *  - after the first keystroke, it parses, in the seeded language;
 *  - after a language change, either way, it parses, and a change from a JS
 *    body carrying its L2 grants writes the expression shape.
 *
 * Controls: the switch INTO an update action writes what it wrote before plus
 * the empty `patch` the spec requires of it; the Type control's write for every
 * non-script type is unchanged and writes no body; an action bound to a
 * registered function by `target` gets no body seeded.
 *
 * Parity: the writer's per-language key list, `BODY_KEYS_BY_LANGUAGE`, is
 * written out in the inspector so the spec's body schema stays out of the
 * console's first load. The last block compares it with the spec's own union,
 * `HookBodySchema.options`, in both directions: the same languages, and per
 * language the same keys. The spec is imported here, test-side only.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ActionSchema } from '@objectstack/spec/ui';
import { HookBodySchema } from '@objectstack/spec/data';

// objectui#4697: the inspector calls `useObjectOptions()` / `useObjectFields()`
// / `useMetaOptions()` on mount. Stub the shared client so nothing reaches the
// network. Nothing below reads the catalog. `useObjectFields()` reads through
// `withPreviewDrafts(true)` since objectui#11895, so the stub answers it with
// itself, as the sibling inspector suites' stubs do.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { ActionDefaultInspector, BODY_KEYS_BY_LANGUAGE } from './ActionDefaultInspector';

afterEach(cleanup);

type Draft = Record<string, unknown>;

const RUN_A_SCRIPT = 'Run a script — sandboxed JS / expression body';
const UPDATE_FIELDS = 'Update fields on this record — no code';
const EXPRESSION = 'Expression (L1)';
const SANDBOXED_JS = 'Sandboxed JS (L2)';

/** The skeleton Studio's New button adds since objectui#11820 (`newActionPin`). */
const NEW_ACTION: Draft = {
  name: 'invoice_action_1',
  label: 'New action',
  objectName: 'invoice',
  locations: ['record_header'],
  operation: 'update',
  patch: {},
};

/** A host that holds the draft and merges each patch the way the action hosts do. */
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

/** The body the save sends: the held draft through the JSON wire. */
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

function type(source: string) {
  fireEvent.change(screen.getByPlaceholderText(/\(input, ctx\) => result/), { target: { value: source } });
}

const bodyOf = (draft: Draft) => sent(draft).body;

describe('scriptBodyPin — the switch to "Run a script" seeds the language (objectui#11921)', () => {
  it('after the switch: the body names the language the picker shows; the only refusal is the source', async () => {
    const seen = mountHost(NEW_ACTION);
    // Control: the skeleton the switch starts from parses.
    expect(refusals(seen.draft)).toEqual([]);

    await pick('What it does', RUN_A_SCRIPT);

    expect(seen.writes.at(-1)).toStrictEqual({
      operation: undefined,
      patch: undefined,
      body: { language: 'expression' },
    });
    expect(screen.getByRole('combobox', { name: 'Script language' })).toHaveTextContent(EXPRESSION);
    // Before objectui#11921 this draft was refused at `body` (a script needs a
    // body or a target), and the first keystroke at `body.language`.
    expect(refusals(seen.draft)).toEqual(['body.source:invalid_type']);
  });

  it('after the first keystroke: it parses, in the seeded language', async () => {
    const seen = mountHost(NEW_ACTION);
    await pick('What it does', RUN_A_SCRIPT);

    type('r');
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'expression', source: 'r' });
    expect(refusals(seen.draft)).toEqual([]);

    // Typing keeps the language.
    type("record.status == 'open'");
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'expression', source: "record.status == 'open'" });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('after a language change, either way: it parses and keeps the source', async () => {
    const seen = mountHost(NEW_ACTION);
    await pick('What it does', RUN_A_SCRIPT);
    type('return { ok: true }');

    await pick('Script language', SANDBOXED_JS);
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'js', source: 'return { ok: true }' });
    expect(refusals(seen.draft)).toEqual([]);

    await pick('Script language', EXPRESSION);
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'expression', source: 'return { ok: true }' });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('a switch away and back: the update switch drops the body, the way back seeds a fresh one', async () => {
    const seen = mountHost({
      name: 'invoice_send',
      label: 'Send',
      objectName: 'invoice',
      locations: ['record_more'],
      type: 'script',
      body: { language: 'js', source: 'return { ok: true }' },
    });
    expect(refusals(seen.draft)).toEqual([]);

    await pick('What it does', UPDATE_FIELDS);
    expect(refusals(seen.draft)).toEqual([]);

    await pick('What it does', RUN_A_SCRIPT);
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'expression' });
    type('true');
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('a script action whose stored body names no language: the first keystroke seeds it and parses', () => {
    // The shape the Type control, or an older draft, leaves: a script with no body.
    const seen = mountHost({ name: 'invoice_go', label: 'Go', objectName: 'invoice', locations: ['record_more'], type: 'script' });
    expect(refusals(seen.draft)).toEqual(['body:custom']);

    type('x');
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'expression', source: 'x' });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('why the switch cannot parse on its own: the spec requires a non-empty source in both languages', () => {
    for (const language of ['expression', 'js']) {
      expect(refusals({ ...NEW_ACTION, operation: undefined, patch: undefined, body: { language } }), language)
        .toEqual(['body.source:invalid_type']);
      expect(refusals({ ...NEW_ACTION, operation: undefined, patch: undefined, body: { language, source: '' } }), language)
        .toEqual(['body.source:too_small']);
    }
  });
});

describe('scriptBodyPin — a language change writes the new language’s shape (objectui#11921)', () => {
  const JS_ACTION: Draft = {
    name: 'invoice_stamp',
    label: 'Stamp',
    objectName: 'invoice',
    locations: ['record_more'],
    type: 'script',
    // The spec's own L2 example shape: a grant and a limit beside the source.
    body: { language: 'js', source: 'return 1', capabilities: ['api.read'], timeoutMs: 250 },
  };

  it('a JS body carrying its L2 grants switches to an expression the spec parses', async () => {
    const seen = mountHost(JS_ACTION);
    expect(refusals(seen.draft)).toEqual([]);

    await pick('Script language', EXPRESSION);
    // `capabilities` and `timeoutMs` are refused by name beside an expression.
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'expression', source: 'return 1' });
    expect(refusals(seen.draft)).toEqual([]);

    await pick('Script language', SANDBOXED_JS);
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'js', source: 'return 1' });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('control: a key neither language admits is the author’s, kept for the spec to name', async () => {
    const seen = mountHost({ ...JS_ACTION, body: { language: 'js', source: 'return 1', timeout: 250 } });

    await pick('Script language', EXPRESSION);
    expect(bodyOf(seen.draft)).toStrictEqual({ language: 'expression', source: 'return 1', timeout: 250 });
    expect(refusals(seen.draft)).toEqual(['body:unrecognized_keys']);
  });
});

describe('scriptBodyPin — controls: the other writes (objectui#11921)', () => {
  it('the switch into an update action writes what it did, plus the empty patch the spec requires', async () => {
    const seen = mountHost({
      name: 'invoice_send',
      label: 'Send',
      objectName: 'invoice',
      locations: ['record_more'],
      type: 'script',
      body: { language: 'expression', source: 'true' },
    });

    await pick('What it does', UPDATE_FIELDS);
    expect(seen.writes.at(-1)).toStrictEqual({
      operation: 'update',
      type: 'script',
      target: undefined,
      body: undefined,
      method: undefined,
      bodyExtra: undefined,
      bodyShape: undefined,
      recordIdParam: undefined,
      recordIdField: undefined,
      onSuccess: undefined,
      opensInNewTab: undefined,
      newTabUrl: undefined,
      patch: {},
    });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('the Type control writes only the type for every non-script type, and no body', async () => {
    for (const [value, option] of [
      ['api', 'API — call an endpoint'],
      ['flow', 'Flow — invoke a flow'],
      ['modal', 'Modal — open a modal/page'],
      ['form', 'Form — open a FormView'],
      ['url', 'URL — navigate to a link'],
    ] as const) {
      const seen = mountHost({ name: 'invoice_go', label: 'Go', objectName: 'invoice', locations: ['record_more'], type: 'script' });
      await pick('Type', option);
      expect(seen.writes, value).toStrictEqual([{ type: value }]);
      cleanup();
    }
  });

  it('an action bound to a registered function by target gets no body seeded', async () => {
    const seen = mountHost({ ...NEW_ACTION, target: 'stamp_invoice' });

    await pick('What it does', RUN_A_SCRIPT);
    expect(seen.writes.at(-1)).toStrictEqual({ operation: undefined, patch: undefined });
    expect(refusals(seen.draft)).toEqual([]);
  });
});

describe('scriptBodyPin — the writer key list matches the spec body union (objectui#11921)', () => {
  /** The spec's own answer: each `HookBodySchema` shape, keyed by its `language` literal. */
  const specKeys = new Map<string, string[]>(
    HookBodySchema.options.map((shape) => [shape.shape.language.value, Object.keys(shape.shape).sort()]),
  );

  it('names the same languages as the spec union', () => {
    expect([...BODY_KEYS_BY_LANGUAGE.keys()].sort()).toEqual([...specKeys.keys()].sort());
  });

  it('admits, per language, exactly the keys the spec shape declares: none missing, none extra', () => {
    for (const [language, keys] of specKeys) {
      expect([...(BODY_KEYS_BY_LANGUAGE.get(language) ?? [])].sort(), language).toEqual(keys);
    }
  });
});
