// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12681, read where the author reads it — the validation banner of
 * the metadata-admin object designer.
 *
 * The page is the real `MetadataResourceEditPage` with its registered object
 * canvas, field inspector and `object` resource config, so the banner comes
 * from the page's own live check (`validateMetadataDraft` in edit mode, over
 * the body `fromDraft` serialises). Only the client's reads and transport are
 * doubles. The object is the one the card's reproduction creates over REST.
 *
 * ## Two readings, both over the WHOLE edit — never one sampled moment
 *
 * The page clears its issues on every draft change and re-runs the check 200ms
 * later, and the inspector writes more than once per keystroke (the inferred
 * `returnType` follows the expression). So the banner flickers, and a reading
 * taken at one instant can land in a gap and see nothing — measured: a single
 * sample after the lint line appeared read an empty banner on the unfixed code
 * under a loaded box. The pins therefore record:
 *
 *  - every result of the page's check (the real `validateMetadataDraft`,
 *    wrapped only to keep a copy of what it returned), judged by the issue's
 *    SUBJECT — a path at the field itself, `fields.est_total`, is where the
 *    spec reports an unrecognized key;
 *  - every banner state the DOM went through (a `MutationObserver`), judged by
 *    the location each line renders before its message (`… → est_total`).
 *
 * Lint lines located at the field's `expression` are the author's to see while
 * the expression is incomplete; seeing one is also the positive reading that
 * the banner was live while the edit was under way.
 *
 * Autosave is switched OFF (the page's own per-browser toggle). A save clears
 * the banner and its round-trip drops `undefined`, which is exactly how the
 * false line used to go away a few seconds after each edit; with the timer
 * running, a "banner gone" reading could be the save's doing rather than the
 * check's. Each pin asserts no PUT went out.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

type Row = Record<string, unknown>;

/** Every result the page's live check returned, with the body it judged. */
const { checks } = vi.hoisted(() => ({
  checks: [] as Array<{ draft: Record<string, unknown>; issues: Array<{ path: string; message: string }> }>,
}));

vi.mock('../clientValidation', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../clientValidation')>();
  return {
    ...mod,
    validateMetadataDraft: async (...args: Parameters<typeof mod.validateMetadataDraft>) => {
      const res = await mod.validateMetadataDraft(...args);
      checks.push({ draft: args[1] as Record<string, unknown>, issues: res.issues });
      return res;
    },
  };
});

const objectWith = (estTotal: Row): Row => ({
  name: 'qavrf_job',
  label: 'QA Job',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    est_hours: { type: 'number', label: 'Est' },
    est_total: estTotal,
  },
});

const CLEAN = objectWith({
  type: 'formula',
  label: 'Est Total',
  expression: 'record.est_hours * 1.1',
  returnType: 'number',
});
const LEGACY = objectWith({ type: 'formula', label: 'Est Total', formula: 'record.est_hours * 1.1' });

let served: Row = CLEAN;

const OBJECT_ENTRY = {
  type: 'object',
  name: 'object',
  label: 'Object',
  allowEnvironmentOverlay: true,
  schema: { type: 'object', properties: { label: { type: 'string', title: 'Label' } } },
};

const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
});

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => served),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: served, code: served, editable: true })),
  getDraft: vi.fn(async () => null),
});

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({ entries: [OBJECT_ENTRY] }),
  };
});

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

import { MetadataResourceEditPage } from '../ResourceEditPage';
// The load-time registrations and the built-in resource configs, exactly as the
// package entry runs them.
import '../register-builtins';
import '../../../services/builtinComponents.js';
// The built-in designers, registered at module scope so they exist before the
// first render (the package entry loads them from a dynamic chunk).
import { registerBuiltinDesigners } from '../register-builtin-designers';
registerBuiltinDesigners();

const AUTOSAVE_PREF = 'metadata-admin:autosave';

beforeEach(() => {
  window.localStorage.setItem(AUTOSAVE_PREF, '0');
  checks.length = 0;
});

afterEach(() => {
  cleanup();
  fetchImpl.mockClear();
  served = CLEAN;
  window.localStorage.removeItem(AUTOSAVE_PREF);
});

function renderDesigner(body: Row) {
  served = body;
  render(
    <MemoryRouter initialEntries={['/metadata/object/qavrf_job']}>
      <MetadataResourceEditPage type="object" name="qavrf_job" />
    </MemoryRouter>,
  );
}

/** Select `est_total` on the canvas and return its Formula (CEL) editor. */
async function openFormulaEditor(): Promise<HTMLTextAreaElement> {
  const card = (await screen.findAllByText('Est Total', {}, { timeout: 8000 }))
    .map((el) => el.closest('[role="button"]'))
    .find((el): el is HTMLElement => !!el);
  expect(card, 'the `est_total` field is on the canvas').toBeTruthy();
  fireEvent.click(card!);
  let editor: HTMLElement | null = null;
  await waitFor(
    () => {
      editor = document.getElementById('field-formula-est_total');
      expect(editor).toBeTruthy();
    },
    { timeout: 8000 },
  );
  return editor! as HTMLTextAreaElement;
}

/** The issue location of every line the validation banner shows (empty when there is no banner). */
function bannerLocations(): string[] {
  const banner = screen.queryByTestId('metadata-validation-banner');
  if (!banner) return [];
  return Array.from(banner.querySelectorAll('li > span')).map((s) => (s.textContent ?? '').trim());
}

/** Every banner line location the DOM shows from now until `stop()`. */
function recordBanner(): { seen: Set<string>; stop: () => void } {
  const seen = new Set<string>();
  const snap = () => bannerLocations().forEach((l) => seen.add(l));
  const observer = new MutationObserver(snap);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  snap();
  return { seen, stop: () => observer.disconnect() };
}

/** A banner line located at the formula field itself — where the spec reports an unrecognized key. */
const AT_FIELD = /→ est_total$/;
/** A banner line located at the field's expression — the CEL lint. */
const AT_EXPRESSION = /→ est_total → expression$/;
/** The check's own subject for the same line. */
const FIELD_PATH = 'fields.est_total';

const sourceOf = (draft: Row): unknown => {
  const e = ((draft.fields as Record<string, Row> | undefined)?.est_total ?? {}).expression;
  return e && typeof e === 'object' ? (e as { source?: unknown }).source : e;
};

/** Let the page's check judge the draft whose expression is `source`, and React render its answer. */
async function judgedWith(source: string) {
  await waitFor(() => expect(checks.some((c) => sourceOf(c.draft) === source)).toBe(true), { timeout: 4000 });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
}

describe('object designer banner — editing a clean formula field shows no retired-key line (objectui#12681)', () => {
  it("THE PIN: across the card's keystrokes no check and no banner state names the field itself", async () => {
    renderDesigner(CLEAN);
    const editor = await openFormulaEditor();
    expect(editor).toHaveValue('record.est_hours * 1.1');
    const banner = recordBanner();
    checks.length = 0;

    // ` +` leaves a dangling operator: the lint line at `expression` must show.
    fireEvent.change(editor, { target: { value: 'record.est_hours * 1.1 ' } });
    fireEvent.change(editor, { target: { value: 'record.est_hours * 1.1 +' } });
    await judgedWith('record.est_hours * 1.1 +');
    await waitFor(() => expect([...banner.seen].some((l) => AT_EXPRESSION.test(l))).toBe(true), { timeout: 4000 });

    // ` + 1` completes the expression, and the banner ends empty.
    fireEvent.change(editor, { target: { value: 'record.est_hours * 1.1 + ' } });
    fireEvent.change(editor, { target: { value: 'record.est_hours * 1.1 + 1' } });
    await judgedWith('record.est_hours * 1.1 + 1');
    await waitFor(() => expect(bannerLocations()).toEqual([]), { timeout: 4000 });
    banner.stop();

    expect(checks.length).toBeGreaterThan(0);
    expect(checks.flatMap((c) => c.issues).filter((i) => i.path === FIELD_PATH)).toEqual([]);
    expect([...banner.seen].filter((l) => AT_FIELD.test(l))).toEqual([]);
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === 'PUT')).toEqual([]);
  });

  it('the legacy pointer stands on a stored `formula` key until the first edit, and that edit clears it', async () => {
    renderDesigner(LEGACY);
    // Before the edit: the banner carries the line at the field (the
    // objectui#6526 pointer rides on it), from a check that named the field.
    await waitFor(() => expect(bannerLocations().some((l) => AT_FIELD.test(l))).toBe(true), { timeout: 8000 });
    expect(checks.some((c) => c.issues.some((i) => i.path === FIELD_PATH))).toBe(true);

    const editor = await openFormulaEditor();
    expect(editor).toHaveValue('record.est_hours * 1.1');
    checks.length = 0;
    fireEvent.change(editor, { target: { value: 'record.est_hours * 1.1 + 1' } });
    await judgedWith('record.est_hours * 1.1 + 1');
    await waitFor(() => expect(bannerLocations()).toEqual([]), { timeout: 4000 });

    // Every check of a draft the edit produced is clean at the field.
    const afterEdit = checks.filter((c) => sourceOf(c.draft) === 'record.est_hours * 1.1 + 1');
    expect(afterEdit.length).toBeGreaterThan(0);
    expect(afterEdit.flatMap((c) => c.issues).filter((i) => i.path === FIELD_PATH)).toEqual([]);
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === 'PUT')).toEqual([]);
  });
});
