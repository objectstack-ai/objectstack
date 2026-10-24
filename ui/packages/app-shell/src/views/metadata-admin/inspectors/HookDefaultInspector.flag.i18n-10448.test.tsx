// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10448 — the flag the Hook inspector's object picker puts on a
 * SELECTED object the live catalog does not list reads in the designer's
 * locale.
 *
 * The picker keeps such an object on screen, flagged, so a draft-only or
 * cross-package selection is never silently dropped. That flag was a
 * hard-coded English template literal, so a zh-CN author read
 * `VALUE (not published)` on an otherwise Chinese inspector. It now goes
 * through `flagUnknownValue` with the catalogue's `engine.form.notPublished`,
 * the device objectui#9652 landed for the designer's other unknown-value flags.
 *
 * `HookDefaultInspector` takes its locale as a prop, so each case passes
 * `locale` and mounts no provider. The catalog ANSWERS here with one object
 * that is not the selected one, and each case waits for that answer before
 * reading the flagged row.
 *
 * - zh: the value followed directly by the catalogue's zh flag, no space. The
 *   flag is read from the catalogue rather than retyped, and the guard below
 *   proves it is a real zh row, so the case cannot pass on a missing key.
 * - en: the pre-fix wording, byte for byte, as a literal.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => ({
  metadataClient: {
    get: vi.fn(async () => undefined),
    withPreviewDrafts() { return this; },
    list: vi.fn(async () => [{ name: 'account', label: 'Account' }] as unknown[]),
  },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { t } from '../i18n';
import { HookDefaultInspector } from './HookDefaultInspector';

afterEach(cleanup);

describe('engine.form.notPublished is a real row in both locales (non-vacuity guard)', () => {
  it('is translated, not echoed and not English', () => {
    const zh = t('engine.form.notPublished', 'zh-CN');
    expect(zh, 'a missing zh row echoes the key back').not.toBe('engine.form.notPublished');
    expect(zh, 'the zh row must not be the English one').not.toBe(t('engine.form.notPublished', 'en-US'));
    expect(zh.startsWith('（'), 'the zh flag opens with a full-width bracket').toBe(true);
  });
});

describe('HookDefaultInspector — a selected object missing from the live catalog', () => {
  async function mount(locale: 'en-US' | 'zh-CN') {
    render(
      <HookDefaultInspector
        type="hook"
        name="audit_hook"
        draft={{ name: 'audit_hook', object: 'ghost_object', events: ['beforeInsert'] }}
        onPatch={vi.fn()}
        readOnly={false}
        locale={locale}
      />,
    );
    // The catalog answered: the published object is on screen.
    await screen.findByRole('checkbox', { name: 'Account (account)' });
  }

  it('zh-CN: the flag is the catalogue\'s "not published", after the value, unspaced', async () => {
    await mount('zh-CN');
    const flagged = `ghost_object${t('engine.form.notPublished', 'zh-CN')}`;
    expect(screen.getByRole('checkbox', { name: flagged })).toBeTruthy();
    expect(screen.queryByText('ghost_object (not published)')).toBeNull();
  });

  it('en-US: the wording is unchanged', async () => {
    await mount('en-US');
    expect(screen.getByRole('checkbox', { name: 'ghost_object (not published)' })).toBeTruthy();
  });
});
