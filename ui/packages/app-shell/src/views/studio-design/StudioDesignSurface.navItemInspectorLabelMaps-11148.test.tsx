// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11148: the Studio's nav-item inspector (`StudioNavItemInspector`)
 * shows a locale-map label resolved in the designer locale, and an edit of a
 * map writes only the designer locale's entry.
 *
 * The spec types a nav item's `label` as `I18nLabel`: a plain string or an
 * inline locale map. Before this card the inspector read
 * `String(label ?? title ?? name)`, so a map showed as `[object Object]`, and
 * its Label input wrote `label: <typed text>`, so one keystroke replaced the
 * whole map with one string and deleted every other language's text. The
 * canvas card beside it had already been fixed (objectui#11128); both editors
 * now go through one module, `navItemLabel.ts`.
 *
 * The cases:
 *   - a map label shows its resolved text under en and under zh;
 *   - an edit under zh changes only `zh-CN`, and `en` survives;
 *   - an edit under en writes the `en` entry the input read, not a second key;
 *   - a map with no entry for the designer locale gains one exactly once over
 *     several keystrokes (the inspector writes on every keystroke);
 *   - a plain-string label edits to a plain string, as before (the control);
 *   - `title` / `name` are not read as the label;
 *   - binding an object keeps a real map label as authored, and the item the
 *     binding writes still parses.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import { I18nProvider } from '@object-ui/i18n';

import { StudioNavItemInspector } from './StudioDesignSurface';

afterEach(cleanup);

const ITEM_LABEL = { en: 'Accounts', 'zh-CN': '客户' };
const OBJECTS = [{ name: 'account', label: 'Account' }];

type Language = 'en' | 'zh';

type NavPatch = { navigation: Array<Record<string, unknown>> };

function renderInspector(node: Record<string, unknown>, language: Language) {
  const onNavPatch = vi.fn();
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <StudioNavItemInspector
        navId="navigation[0]"
        appDraft={{ navigation: [node] }}
        objects={OBJECTS}
        packageId="com.acme.app"
        onNavPatch={onNavPatch}
        onClear={vi.fn()}
      />
    </I18nProvider>,
  );
  return onNavPatch;
}

/** The label the inspector wrote in its `n`-th patch (1-based). */
function writtenLabel(onNavPatch: ReturnType<typeof vi.fn>, n = 1): unknown {
  return (onNavPatch.mock.calls[n - 1][0] as NavPatch).navigation[0].label;
}

/**
 * Holds the draft the way `InterfacesPillar` does, so every patch the
 * inspector emits is what the next keystroke reads.
 */
function StatefulInspector({ node, onDraft }: { node: Record<string, unknown>; onDraft: (d: NavPatch) => void }) {
  const [draft, setDraft] = React.useState<NavPatch>({ navigation: [node] });
  return (
    <StudioNavItemInspector
      navId="navigation[0]"
      appDraft={draft}
      objects={OBJECTS}
      packageId="com.acme.app"
      onNavPatch={(p) => {
        const next = { ...draft, ...(p as NavPatch) };
        onDraft(next);
        setDraft(next);
      }}
      onClear={vi.fn()}
    />
  );
}

describe('StudioNavItemInspector shows a locale-map label in the designer locale (objectui#11148)', () => {
  const cases: Array<[Language, string]> = [
    ['en', 'Accounts'],
    ['zh', '客户'],
  ];

  for (const [language, shown] of cases) {
    it(`shows a map label as its ${language} text, never as [object Object]`, () => {
      renderInspector({ id: 'accounts', type: 'object', label: ITEM_LABEL, objectName: 'account' }, language);

      expect(screen.getByRole('textbox')).toHaveValue(shown);
      expect(screen.queryByDisplayValue('[object Object]')).toBeNull();
    });
  }

  it('does not read `title` / `name` as the label', () => {
    renderInspector({ id: 'accounts', type: 'object', title: 'Accounts title', name: 'accounts_name' }, 'en');

    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});

describe('StudioNavItemInspector edits only the designer locale entry of a map (objectui#11148)', () => {
  it('an edit under zh changes only `zh-CN`, and `en` survives', () => {
    const onNavPatch = renderInspector({ id: 'accounts', type: 'object', label: ITEM_LABEL, objectName: 'account' }, 'zh');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '客户账户' } });

    expect(onNavPatch).toHaveBeenCalledTimes(1);
    expect(writtenLabel(onNavPatch)).toEqual({ en: 'Accounts', 'zh-CN': '客户账户' });
  });

  it('an edit under en writes the `en` entry the input read, not a second `en-US` key', () => {
    const onNavPatch = renderInspector({ id: 'accounts', type: 'object', label: ITEM_LABEL, objectName: 'account' }, 'en');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Customers' } });

    expect(writtenLabel(onNavPatch)).toEqual({ en: 'Customers', 'zh-CN': '客户' });
  });

  it('a map with no designer-locale entry gains one exactly once over several keystrokes', () => {
    const drafts: NavPatch[] = [];
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <StatefulInspector
          node={{ id: 'accounts', type: 'object', label: { en: 'Accounts' }, objectName: 'account' }}
          onDraft={(d) => drafts.push(d)}
        />
      </I18nProvider>,
    );
    const input = screen.getByRole('textbox');
    // Under zh-CN the input falls back to the `en` text, which is not the
    // zh-CN entry. Each keystroke is one `change` with the input's whole value.
    expect(input).toHaveValue('Accounts');
    for (const value of ['客', '客户', '客户账户']) fireEvent.change(input, { target: { value } });

    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => Object.keys(d.navigation[0].label as object))).toEqual([
      ['en', 'zh-CN'],
      ['en', 'zh-CN'],
      ['en', 'zh-CN'],
    ]);
    expect(drafts[2].navigation[0].label).toEqual({ en: 'Accounts', 'zh-CN': '客户账户' });
    expect(input).toHaveValue('客户账户');
  });

  it('a plain-string label edits to a plain string, as before (the control)', () => {
    const onNavPatch = renderInspector({ id: 'accounts', type: 'object', label: 'Accounts', objectName: 'account' }, 'zh');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Customers' } });

    expect(writtenLabel(onNavPatch)).toBe('Customers');
  });

  it('binding an object keeps a real map label as authored, and the item still parses', async () => {
    const onNavPatch = renderInspector({ id: 'accounts', type: 'object', label: ITEM_LABEL }, 'zh');
    // *Link object* is the shared `Select` since objectui#11865: pick through its list.
    // objectui#12455 — the inspector also offers an Icon picker (a combobox), so the object picker is addressed by its test id.
    fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Account (account)' }));

    expect(onNavPatch).toHaveBeenCalledTimes(1);
    const patched = (onNavPatch.mock.calls[0][0] as NavPatch).navigation[0];
    expect(patched.label).toEqual(ITEM_LABEL);
    // The wire shape: the patch clears stray keys by assigning `undefined`.
    const saved = JSON.parse(JSON.stringify(patched)) as Record<string, unknown>;
    expect(NavigationItemSchema.safeParse(saved).success).toBe(true);
  });
});
