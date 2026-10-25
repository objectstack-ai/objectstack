// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12531 — the icon picker warns, inline, on a stored name that matches
 * no icon in the catalog it offers.
 *
 * Every resolver that draws a stored icon name (`getLazyIcon`, which app-shell
 * re-exports as `getIcon`) degrades an unknown name to its fallback glyph
 * without a word, so the author of a misspelt name saw *an* icon and nothing
 * that said it was not theirs. The picker's trigger used to flag such a value
 * with the FIELD picker's copy, "(not in object)", which names the wrong
 * catalog. The warning lives INSIDE `IconPickerWidget`, so every mount reads the
 * same one: the object and app-nav inspectors (this card), the action
 * inspector, the Studio's nav inspector and `SchemaForm`'s `icon` widget.
 *
 *  - an unknown name shows the warning, naming the stored value, and the
 *    trigger points at it through `aria-describedby`;
 *  - a catalog name, the PascalCase spelling lucide exports, and an empty value
 *    show none (CONTROL);
 *  - the warning reads in the designer's locale (zh-CN), from one catalogue key;
 *  - CONTROL: the action inspector's icon field still shows and writes as it
 *    did, and now warns too;
 *  - the fallback the warning stands in for: an unknown name draws the SAME
 *    glyph as no name at all, which is what the Data pillar's rail row and item
 *    header draw for it (`getIcon(o.icon)`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { Database } from 'lucide-react';

// The action inspector calls `useObjectOptions()` / `useObjectFields()` on
// mount; stub the shared client so that fetch does not escape to the network.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('./useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { WIDGETS } from './widgets';
import { t, tFormat } from './i18n';
import { getIcon } from '../../utils/getIcon';
import { ActionDefaultInspector } from './inspectors/ActionDefaultInspector';

afterEach(cleanup);

const Icon = WIDGETS['icon'];
const WARNING_TEST_ID = 'icon-picker-unknown-name';

function mountIcon(value: string) {
  const onChange = vi.fn();
  render(<Icon value={value} onChange={onChange} schema={{ type: 'string' }} />);
  return { onChange, trigger: screen.getByRole('combobox') };
}

describe('objectui#12531 — the icon picker warns on a name that matches no icon', () => {
  it('the warning is a real row in both locales, carrying the stored name (non-vacuity)', () => {
    const en = t('engine.form.unknownIcon', 'en-US');
    const zh = t('engine.form.unknownIcon', 'zh-CN');
    expect(en, 'a missing en row echoes the key back').not.toBe('engine.form.unknownIcon');
    expect(zh, 'a missing zh row echoes the key back').not.toBe('engine.form.unknownIcon');
    expect(zh, 'the zh row must not be the English one').not.toBe(en);
    expect(en).toContain('{name}');
    expect(zh).toContain('{name}');
  });

  it('an unknown name shows the warning, naming the value, and the trigger is described by it', () => {
    const { trigger } = mountIcon('not-an-icon');
    const warning = screen.getByTestId(WARNING_TEST_ID);
    expect(warning).toHaveTextContent(tFormat('engine.form.unknownIcon', 'en-US', { name: 'not-an-icon' }));
    expect(warning.id).not.toBe('');
    expect(trigger).toHaveAttribute('aria-describedby', warning.id);
    // The value is still shown, and still kept, never dropped.
    expect(trigger).toHaveTextContent('not-an-icon');
    // The field picker's flag, which names the wrong catalog, is gone.
    expect(trigger).not.toHaveTextContent(t('engine.form.notInObject', 'en-US'));
  });

  it.each([
    ['a catalog name', 'building'],
    ['the PascalCase spelling lucide exports', 'Building2'],
    ['an empty value', ''],
  ])('CONTROL: %s shows no warning and describes nothing', (_case, value) => {
    const { trigger } = mountIcon(value);
    expect(screen.queryByTestId(WARNING_TEST_ID)).toBeNull();
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('the warning goes when a catalog icon is picked over the unknown name', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Icon value="not-an-icon" onChange={onChange} schema={{ type: 'string' }} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.change(screen.getByLabelText(t('engine.form.searchIcons', 'en-US')), { target: { value: 'build' } });
    const building = screen.getAllByRole('option').find((o) => o.getAttribute('title') === 'building');
    expect(building, 'searching "build" lists building').toBeDefined();
    fireEvent.click(building as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('building');
    rerender(<Icon value="building" onChange={onChange} schema={{ type: 'string' }} />);
    expect(screen.queryByTestId(WARNING_TEST_ID)).toBeNull();
  });

  it('reads in the designer locale (zh-CN)', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <Icon value="not-an-icon" onChange={() => {}} schema={{ type: 'string' }} />
      </I18nProvider>,
    );
    expect(screen.getByTestId(WARNING_TEST_ID)).toHaveTextContent(
      tFormat('engine.form.unknownIcon', 'zh-CN', { name: 'not-an-icon' }),
    );
  });
});

describe('objectui#12531 — CONTROL: the action inspector\'s icon field, the same widget', () => {
  function mountAction(icon: string, onPatch = vi.fn()) {
    render(
      <ActionDefaultInspector
        type="action"
        name="approve"
        draft={{ name: 'approve', label: 'Approve', type: 'script', icon }}
        onPatch={onPatch}
        readOnly={false}
        locale={'en-US' as never}
      />,
    );
    // The icon trigger is the one combobox that opens a dialog.
    const trigger = screen
      .getAllByRole('combobox')
      .find((el) => el.getAttribute('aria-haspopup') === 'dialog');
    expect(trigger, 'the action inspector mounts the icon picker').toBeDefined();
    return { onPatch, trigger: trigger as HTMLElement };
  }

  it('shows the stored name and writes a picked icon as before', () => {
    const { onPatch, trigger } = mountAction('check');
    expect(trigger).toHaveTextContent('check');
    expect(screen.queryByTestId(WARNING_TEST_ID)).toBeNull();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t('engine.form.searchIcons', 'en-US')), { target: { value: 'build' } });
    const building = within(dialog).getAllByRole('option').find((o) => o.getAttribute('title') === 'building');
    fireEvent.click(building as HTMLElement);
    expect(onPatch).toHaveBeenCalledWith({ icon: 'building' });
  });

  it('now warns on an unknown stored name too', () => {
    const { trigger } = mountAction('not-an-icon');
    const warning = screen.getByTestId(WARNING_TEST_ID);
    expect(trigger).toHaveAttribute('aria-describedby', warning.id);
  });
});

describe('objectui#12531 — the fallback the warning stands in for', () => {
  it('an unknown name draws the same glyph as no name: the generic Database glyph', () => {
    // The Data pillar's rail row and item header draw `getIcon(o.icon)`.
    expect(getIcon('not-an-icon')).toBe(getIcon(undefined));
    expect(getIcon(undefined)).toBe(Database);
    // CONTROL: a catalog name draws its own icon, not the fallback.
    expect(getIcon('building')).not.toBe(Database);
  });
});
