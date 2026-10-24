// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12510 — the action editor's icon picker is named by its "Icon" label.
 *
 * The picker is a `combobox` button, a role that takes no name from its
 * content, and the label beside it was bound to nothing: the browser's tree on
 * the Studio's object actions read it as a combobox with no name. The label
 * now names it the way objectui#12531 named the object and app-nav icon fields:
 * one `React.useId()`, the `Label`'s `htmlFor`, the widget's `id`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { t } from '../i18n';

// The inspector loads the object catalog on mount; nothing below reads it.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { ActionDefaultInspector } from './ActionDefaultInspector';

afterEach(cleanup);

const ICON_LABEL = t('engine.inspector.action.icon', 'en-US');

function mount(readOnly: boolean) {
  render(
    <ActionDefaultInspector
      type="action"
      name="call"
      draft={{ name: 'call', label: 'Call', type: 'script', icon: 'phone' }}
      onPatch={() => {}}
      readOnly={readOnly}
      locale={'en-US' as never}
    />,
  );
}

describe('ActionDefaultInspector names its icon picker by the Icon label (objectui#12510)', () => {
  it.each([false, true])('the picker is the combobox named "Icon" (readOnly=%s)', (readOnly) => {
    mount(readOnly);
    const picker = screen.getByRole('combobox', { name: ICON_LABEL });
    expect(picker).toHaveAttribute('aria-haspopup', 'dialog');
    expect(picker).toHaveTextContent('phone');
  });
});
