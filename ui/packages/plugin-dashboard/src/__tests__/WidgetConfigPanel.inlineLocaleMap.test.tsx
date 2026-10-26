/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `WidgetConfigPanel` reads AND writes an inline-locale-map title
 * (objectui#5301).
 *
 * The panel carried a private `resolveLabel` reading `defaultValue || key` —
 * the key-reference form `@objectstack/spec` RETIRED at 17.0.0-rc.6
 * (objectstack#5055). The inline per-locale map `I18nLabelSchema` admits has
 * neither limb, so it resolved to `''`.
 *
 * ## Red-first — measured against the unfixed source, verbatim
 *
 * With `config.title = { en: 'Revenue', zh: '收入' }` the Title input rendered
 * with `value=""`:
 *
 * ```
 * AssertionError: expected '' to be '收入'
 * ```
 *
 * and the save that followed an unrelated edit emitted `title: ''` — the
 * author's map replaced by an empty string. That is why this file asserts the
 * SAVE payload and not only the rendered value: an empty input is cosmetic, an
 * empty input that seeds the draft is data loss on the ordinary path (open
 * widget -> change anything -> save).
 *
 * ## What the ruling pins (maintainer, 2026-08-20)
 *
 * - read through `pickLocalized(value, language)`, like every sibling surface
 *   post-objectui#4032;
 * - a save writes back ONLY the active locale's entry and preserves the others;
 * - an untouched map survives an unrelated edit **byte-identically** — asserted
 *   with `toBe`, i.e. the same object, because an equal-but-rebuilt object is
 *   a different guarantee (a rebuild would add an entry for the active locale
 *   to a map that never carried one).
 *
 * A full multi-locale editor is deliberately NOT asserted here — this suite pins
 * the single-locale write rule above and nothing wider. Authoring every locale
 * from one panel remains an OPEN product question, not deferred to a tracker
 * here: the deferral this replaced named objectui#4163, which closed as
 * completed on 2026-08-15 with the question still unanswered.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { WidgetConfigPanel, restoreI18nLabels } from '../WidgetConfigPanel';

afterEach(cleanup);

/**
 * `zh` is spelled as a bare base tag on BOTH sides — the provider's language and
 * the map's key — so the write target is the same entry whether the active
 * language arrives as `zh` or `zh-CN` (exact hit, or base hit). The point under
 * test is which entries survive, not which spelling of Chinese wins; that is
 * `pickLocalized`'s own suite.
 */
const MAP_TITLE = { en: 'Revenue', zh: '收入' } as const;
const MAP_DESCRIPTION = { en: 'Monthly total', zh: '每月总额' } as const;

function renderPanel(
  config: Record<string, any>,
  handlers: { onSave?: (c: Record<string, any>) => void; onFieldChange?: (f: string, v: any) => void } = {},
  language = 'zh',
) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <WidgetConfigPanel
        open
        onClose={vi.fn()}
        config={config}
        onSave={handlers.onSave ?? vi.fn()}
        onFieldChange={handlers.onFieldChange}
      />
    </I18nProvider>,
  );
}

const titleInput = () => screen.getByTestId('config-field-title') as HTMLInputElement;
const descriptionInput = () =>
  screen.getByTestId('config-field-description') as HTMLInputElement;

/** An edit that has nothing to do with the label keys — the ordinary path. */
function makeUnrelatedEdit() {
  fireEvent.change(screen.getByTestId('config-field-dataset'), {
    target: { value: 'sales_pipeline' },
  });
}

const save = () => fireEvent.click(screen.getByTestId('config-panel-save'));

describe('WidgetConfigPanel — reading an inline locale map', () => {
  it('shows the active locale in the Title field', () => {
    renderPanel({ id: 'w1', type: 'bar', title: MAP_TITLE });
    expect(titleInput().value).toBe('收入');
  });

  it('shows the same map differently for another language', () => {
    renderPanel({ id: 'w1', type: 'bar', title: MAP_TITLE }, {}, 'en');
    expect(titleInput().value).toBe('Revenue');
  });

  it('shows the active locale in the Description field', () => {
    renderPanel({ id: 'w1', type: 'bar', description: MAP_DESCRIPTION });
    expect(descriptionInput().value).toBe('每月总额');
  });

  it('leaves a plain-string title exactly as authored', () => {
    renderPanel({ id: 'w1', type: 'bar', title: 'Revenue' });
    expect(titleInput().value).toBe('Revenue');
  });
});

describe('WidgetConfigPanel — an untouched map survives an unrelated edit', () => {
  it('saves the stored title object itself, not a rebuilt equal one', () => {
    const onSave = vi.fn();
    const config = { id: 'w1', type: 'bar', title: MAP_TITLE, description: MAP_DESCRIPTION };
    renderPanel(config, { onSave });

    makeUnrelatedEdit();
    save();

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.dataset).toBe('sales_pipeline');
    // The byte-identical round trip the ruling requires.
    expect(saved.title).toBe(config.title);
    expect(saved.description).toBe(config.description);
  });

  it('still saves a plain-string title as a plain string', () => {
    const onSave = vi.fn();
    renderPanel({ id: 'w1', type: 'bar', title: 'Revenue' }, { onSave });

    makeUnrelatedEdit();
    save();

    expect(onSave.mock.calls[0][0].title).toBe('Revenue');
  });

  it('does not invent a title for a widget that never had one', () => {
    const onSave = vi.fn();
    renderPanel({ id: 'w1', type: 'bar' }, { onSave });

    makeUnrelatedEdit();
    save();

    expect(onSave.mock.calls[0][0].title).toBeUndefined();
  });
});

describe('WidgetConfigPanel — editing writes ONE locale entry', () => {
  it('merges the edit into the active locale and keeps the others', () => {
    const onSave = vi.fn();
    renderPanel({ id: 'w1', type: 'bar', title: MAP_TITLE }, { onSave });

    fireEvent.change(titleInput(), { target: { value: '营收' } });
    save();

    expect(onSave.mock.calls[0][0].title).toEqual({ en: 'Revenue', zh: '营收' });
  });

  it('edits the description independently of the title', () => {
    const onSave = vi.fn();
    const config = { id: 'w1', type: 'bar', title: MAP_TITLE, description: MAP_DESCRIPTION };
    renderPanel(config, { onSave });

    fireEvent.change(descriptionInput(), { target: { value: '季度总额' } });
    save();

    const saved = onSave.mock.calls[0][0];
    expect(saved.description).toEqual({ en: 'Monthly total', zh: '季度总额' });
    expect(saved.title).toBe(config.title);
  });

  it('adds an entry for a locale the map does not carry, overwriting nothing', () => {
    const onSave = vi.fn();
    renderPanel({ id: 'w1', type: 'bar', title: MAP_TITLE }, { onSave }, 'de');

    // The panel showed the `en` entry (display fallback); the edit must NOT
    // land there.
    expect(titleInput().value).toBe('Revenue');
    fireEvent.change(titleInput(), { target: { value: 'Umsatz' } });
    save();

    expect(onSave.mock.calls[0][0].title).toEqual({
      en: 'Revenue',
      zh: '收入',
      de: 'Umsatz',
    });
  });

  it('restores the stored map when an edit is typed back to what was shown', () => {
    const onSave = vi.fn();
    const config = { id: 'w1', type: 'bar', title: MAP_TITLE };
    renderPanel(config, { onSave });

    fireEvent.change(titleInput(), { target: { value: '营收' } });
    fireEvent.change(titleInput(), { target: { value: '收入' } });
    save();

    expect(onSave.mock.calls[0][0].title).toBe(config.title);
  });

  it('writes an emptied field into the active locale rather than over the map', () => {
    const onSave = vi.fn();
    renderPanel({ id: 'w1', type: 'bar', title: MAP_TITLE }, { onSave });

    fireEvent.change(titleInput(), { target: { value: '' } });
    save();

    // Clearing the title in this locale is an authoring act; clearing every
    // other locale with it is not. `InlineLocaleMapSchema` is
    // `z.record(<tag >, z.string())`, so `''` is an admissible entry.
    expect(onSave.mock.calls[0][0].title).toEqual({ en: 'Revenue', zh: '' });
  });
});

/**
 * The live-update callback is the panel's other way out, and hosts feed it
 * straight back into the widget the panel re-opens from — `DashboardWithConfig`
 * writes it into `liveSchema`, which is where the next `config` prop is derived
 * from. Forwarding the bare editor string would drop the map before a save ever
 * ran: open, type, close without saving, re-open, and the other locales are
 * already gone.
 */
describe('WidgetConfigPanel — onFieldChange preserves the map too', () => {
  it('forwards the merged map, not the bare string', () => {
    const onFieldChange = vi.fn();
    renderPanel({ id: 'w1', type: 'bar', title: MAP_TITLE }, { onFieldChange });

    fireEvent.change(titleInput(), { target: { value: '营收' } });

    expect(onFieldChange).toHaveBeenCalledWith('title', { en: 'Revenue', zh: '营收' });
  });

  it('forwards a plain string unchanged for a string-valued title', () => {
    const onFieldChange = vi.fn();
    renderPanel({ id: 'w1', type: 'bar', title: 'Revenue' }, { onFieldChange });

    fireEvent.change(titleInput(), { target: { value: 'Turnover' } });

    expect(onFieldChange).toHaveBeenCalledWith('title', 'Turnover');
  });

  it('forwards non-label fields untouched', () => {
    const onFieldChange = vi.fn();
    renderPanel({ id: 'w1', type: 'bar', title: MAP_TITLE }, { onFieldChange });

    makeUnrelatedEdit();

    expect(onFieldChange).toHaveBeenCalledWith('dataset', 'sales_pipeline');
  });
});

/**
 * The pure rule, tested directly. The panel reaches it only through
 * `useConfigDraft`, so the component cases above are also asserting that hook's
 * behaviour; these are not.
 */
describe('restoreI18nLabels — the pure write-back rule', () => {
  const language = 'zh';

  it('returns the draft untouched when no label key was stored as a map', () => {
    const draft = { id: 'w1', title: 'Revenue', description: 'x' };
    expect(restoreI18nLabels(draft, { id: 'w1', title: 'Revenue' }, language)).toBe(draft);
  });

  it('restores the stored object by reference for an untouched label', () => {
    const source = { title: MAP_TITLE };
    const out = restoreI18nLabels({ title: '收入' }, source, language);
    expect(out.title).toBe(source.title);
  });

  it('merges an edited label into the active locale', () => {
    const out = restoreI18nLabels({ title: '营收' }, { title: MAP_TITLE }, language);
    expect(out.title).toEqual({ en: 'Revenue', zh: '营收' });
  });

  it('never mutates the draft it was given', () => {
    const draft = { title: '营收' };
    restoreI18nLabels(draft, { title: MAP_TITLE }, language);
    expect(draft.title).toBe('营收');
  });

  it('leaves a draft value that is not a string alone', () => {
    // Nothing was collapsed into an input, so there is nothing to merge back.
    const out = restoreI18nLabels({ title: MAP_TITLE }, { title: MAP_TITLE }, language);
    expect(out.title).toBe(MAP_TITLE);
  });

  it('tolerates a missing source', () => {
    const draft = { title: 'Revenue' };
    expect(restoreI18nLabels(draft, undefined as any, language)).toBe(draft);
  });
});
