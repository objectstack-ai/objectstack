// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11067 — what the author SEES once the start node's trigger select
 * stops offering 「Platform event」.
 *
 * 1. The open Trigger list carries no 「Platform event」 row.
 * 2. A start node that already stores `triggerType: 'event'` shows it as the
 *    select's flagged unknown value — the value itself under the flag the
 *    select branch words for a value it no longer offers — so the author can
 *    see the trigger is not one the list offers.
 * 3. That value is never rewritten: a save of the node after an edit that did
 *    not touch the select sends `event` back as it was stored.
 *
 * The flag's wording is not pinned here (`unknownValueFlag.i18n-9652.test.tsx`
 * owns it). The expected text is built with the same `flagUnknownValue` and
 * catalogue key the select branch uses, and each case checks it differs from
 * the bare value, so a select that drew the value unflagged would fail.
 *
 * The table half (option, gates, resolver answer) is pinned in
 * `flow-node-config.platformEvent-11067.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { flagUnknownValue } from './_shared';
import { t } from '../i18n';
import type { MetadataSelection } from '../preview-registry';

/* ── The `meta/object` double ─────────────────────────────────────────
 * A start node holding an `objectName` shows the Object reference field, which
 * lists objects via `GET /api/v1/meta/object` through the GLOBAL `fetch`. It is
 * answered as an empty registry by a RECORDING double (the shape
 * `FlowNodeInspector.inactiveRetained.test.tsx` documents in full), and any
 * URL outside that route fails the test in `afterEach`.
 * ──────────────────────────────────────────────────────────── */

const META_OBJECT_ROUTE = '/api/v1/meta/object';
let metaCalls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      metaCalls.push(url);
      if (routeOf(url) !== META_OBJECT_ROUTE) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ type: 'object', items: [] }) };
    }),
  );
});

afterEach(() => {
  expect(metaCalls.filter((url) => routeOf(url) !== META_OBJECT_ROUTE)).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

type Draft = Record<string, unknown>;
type Locale = 'en-US' | 'zh-CN';

function flowWith(config: Record<string, unknown>): Draft {
  return {
    name: 'on_event',
    label: 'On event',
    type: 'autolaunched',
    nodes: [{ id: 'start', type: 'start', label: 'Start', config }],
    edges: [],
  };
}

const startConfig = (draft: Draft) =>
  ((draft.nodes as Array<Record<string, unknown>>)[0].config ?? {}) as Record<string, unknown>;

/**
 * The editor loop: every patch is applied to the draft the inspector renders
 * next, as the host does. `latest()` is the draft a save would send.
 */
function mount(initial: Draft, locale: Locale = 'en-US') {
  let current = initial;
  const patches: Draft[] = [];
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    return (
      <FlowNodeInspector
        type="flow"
        name="on_event"
        draft={draft}
        selection={{ kind: 'node', id: 'start' } as MetadataSelection}
        onPatch={(patch) => {
          patches.push(patch);
          setDraft((d) => {
            current = { ...d, ...patch };
            return current;
          });
        }}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale={locale}
      />
    );
  }
  const utils = render(<Host />);
  return { ...utils, patches, latest: () => current };
}

/** The Trigger select's accessible name in each locale (the zh overlay's label). */
const TRIGGER_LABEL: Record<Locale, string> = { 'en-US': 'Trigger', 'zh-CN': '触发方式' };
const triggerBox = (locale: Locale) => screen.getByRole('combobox', { name: TRIGGER_LABEL[locale] });

/** What the select branch draws for a stored value it does not offer. */
const flagged = (value: string, locale: Locale) =>
  flagUnknownValue(value, t('engine.form.deprecated', locale), locale);

describe('the Trigger select does not offer 「Platform event」 (objectui#11067)', () => {
  it('the open list has no such row', async () => {
    mount(flowWith({ triggerType: 'manual' }));
    await userEvent.click(triggerBox('en-US'));
    // Control: the list really is open and populated.
    expect(await screen.findByRole('option', { name: 'Webhook / API' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Platform event' })).toBeNull();
    expect(screen.queryByRole('option', { name: /event/i })).toBeNull();
  });
});

describe('a stored `triggerType: event` shows as the flagged unknown value (objectui#11067)', () => {
  for (const locale of ['en-US', 'zh-CN'] as const) {
    it(`${locale}: the trigger draws the value under the flag, not bare and not blank`, () => {
      mount(flowWith({ triggerType: 'event' }), locale);
      const text = triggerBox(locale).textContent;
      expect(text).toBe(flagged('event', locale));
      // The flag is really there: the expected text is not the bare value.
      expect(flagged('event', locale)).not.toBe('event');
    });
  }

  it('the flagged value is a selectable row of the open list', async () => {
    mount(flowWith({ triggerType: 'event' }));
    await userEvent.click(triggerBox('en-US'));
    expect(await screen.findByRole('option', { name: flagged('event', 'en-US') })).toBeTruthy();
  });
});

describe('a stored `triggerType: event` is saved back unchanged (objectui#11067)', () => {
  for (const config of [{ triggerType: 'event' }, { triggerType: 'event', objectName: 'task' }]) {
    it(`an edit that does not touch the select keeps ${JSON.stringify(config)} as stored`, () => {
      const { latest, patches } = mount(flowWith(config));
      fireEvent.change(screen.getByDisplayValue('Start'), { target: { value: 'On event' } });
      expect(patches.length).toBeGreaterThan(0);
      expect(startConfig(latest())).toEqual(config);
    });
  }
});
