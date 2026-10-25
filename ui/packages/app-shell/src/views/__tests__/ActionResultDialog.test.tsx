// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ResultDialogSpec } from '@object-ui/core';
import { ActionResultDialog } from '../ActionResultDialog';

/**
 * The display language the dialog resolves an `I18nLabel` against, mutable per
 * test. Hoisted so the `vi.mock` factory below can close over it — a plain
 * `let` would still be in TDZ when the hoisted factory first runs.
 */
const i18nState = vi.hoisted(() => ({ language: 'en' }));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  // `language` is the source every other `resolveI18nLabel` caller in this
  // package threads (`UnifiedSidebar`, `resolveActionParams`, and
  // metadata-admin's `useMetadataLocale`), so the stub carries it too.
  useObjectTranslation: () => ({ t: (key: string) => key, language: i18nState.language }),
}));
// jsdom has no canvas; the qrcode path is not under test.
vi.mock('qrcode', () => ({ toCanvas: vi.fn() }));

function open(spec: ResultDialogSpec, data: unknown) {
  render(
    <ActionResultDialog
      state={{ open: true, spec, data }}
      onAcknowledge={() => {}}
    />,
  );
}

describe('ActionResultDialog — unresolved field paths are skipped', () => {
  const spec: ResultDialogSpec = {
    title: 'User Created',
    fields: [
      { path: 'user.email', label: 'Email', format: 'text' },
      { path: 'temporaryPassword', label: 'Temporary Password', format: 'secret' },
    ],
  };

  it('drops a declared field whose path does not resolve in the payload', () => {
    // Admin typed the password themselves — the server never minted one, so
    // the response has no `temporaryPassword` key at all.
    open(spec, { user: { email: 'a@example.com' } });

    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Temporary Password')).not.toBeInTheDocument();
    // No JsonBlock fallback rendering the literal `undefined` either.
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('renders every declared field when all paths resolve', () => {
    open(spec, { user: { email: 'a@example.com' }, temporaryPassword: 'p@ss' });

    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Temporary Password')).toBeInTheDocument();
    // Secret renders masked until revealed.
    expect(screen.getByText('••••')).toBeInTheDocument();
  });

  it('still falls back to whole-payload JSON when no fields are declared', () => {
    open({ title: 'Done' }, { anything: 1 });

    expect(screen.getByText(/"anything": 1/)).toBeInTheDocument();
  });
});

/**
 * objectui#9542 — every label member the contract declares as `I18nLabel`
 * reaches this dialog in EITHER authorized form: a plain string, or an inline
 * per-locale map. `@objectstack/spec`'s `I18nLabel` authorizes both and
 * deprecates neither, and `ActionSchema.resultDialog` declares `title`,
 * `description`, `acknowledge` and `fields[].label` as `I18nLabel`.
 *
 * ⭐ Before this card these went red by THROWING, not by mis-rendering: the map
 * was passed straight into JSX as a React child, and React refuses an object
 * there ("Objects are not valid as a React child"). The dialog therefore failed
 * to render AT ALL on an action that had already succeeded — and this dialog is
 * the only place its one-shot value is ever shown. The plain-string cases above
 * are the control: they passed before and after, so these legs are about the
 * map arm and nothing else.
 */
describe('ActionResultDialog — an inline per-locale map resolves against the display language', () => {
  it('resolves title, description and acknowledge for the active language', () => {
    i18nState.language = 'zh-CN';
    open(
      {
        title: { en: 'Save this value now', 'zh-CN': '立即保存此值' },
        description: { en: 'Shown once.', 'zh-CN': '仅显示一次。' },
        acknowledge: { en: 'I have saved this', 'zh-CN': '我已保存' },
        fields: [{ path: 'secret', label: { en: 'Secret', 'zh-CN': '密钥' }, format: 'text' }],
      },
      { secret: 's3cr3t' },
    );

    expect(screen.getByText('立即保存此值')).toBeInTheDocument();
    expect(screen.getByText('仅显示一次。')).toBeInTheDocument();
    expect(screen.getByText('我已保存')).toBeInTheDocument();
    expect(screen.getByText('密钥')).toBeInTheDocument();
    // The value itself still reaches the user — the whole reason the dialog exists.
    expect(screen.getByText('s3cr3t')).toBeInTheDocument();
    // The other locale's text is resolved AWAY, not rendered alongside.
    expect(screen.queryByText('Save this value now')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });

  it('picks the other locale when the display language changes — so the language is really read', () => {
    i18nState.language = 'en';
    open(
      {
        title: { en: 'Save this value now', 'zh-CN': '立即保存此值' },
        fields: [{ path: 'secret', label: { en: 'Secret', 'zh-CN': '密钥' }, format: 'text' }],
      },
      { secret: 's3cr3t' },
    );

    expect(screen.getByText('Save this value now')).toBeInTheDocument();
    expect(screen.getByText('Secret')).toBeInTheDocument();
    expect(screen.queryByText('立即保存此值')).not.toBeInTheDocument();
  });

  it('falls back to the translated default when the map has no usable entry', () => {
    i18nState.language = 'zh-CN';
    // An empty map resolves to `undefined`, which must behave exactly as an
    // absent `title` does — the fallback chain, not an empty heading.
    open({ title: {}, fields: [{ path: 'secret', format: 'text' }] }, { secret: 's3cr3t' });

    expect(screen.getByText('actions.resultDialog.defaultTitle')).toBeInTheDocument();
  });
});
