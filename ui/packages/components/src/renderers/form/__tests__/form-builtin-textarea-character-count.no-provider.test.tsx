/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The built-in textarea's character counter with NO `I18nProvider` at all —
 * objectui#3439.
 *
 * ## Why this is its own file
 *
 * i18next is a MODULE SINGLETON. An `I18nProvider` mounted anywhere in a test
 * file leaves the language configured for every later case in that file, so a
 * "no provider" case sitting beside a `zh` one does not test what it says it
 * does — measured, it read the zh sentence. Only file-level module isolation
 * makes the claim honest. The fields side splits
 * `TextAreaField.characterCount.no-provider.test.tsx` off for the same reason.
 *
 * ## Why the claim matters here more than anywhere else
 *
 * This is the built-in branch's OWN audience. Standalone and embedded hosts are
 * exactly the ones that mount no provider — `useFieldTranslation` exists
 * because of them — and they are also the hosts that take this render path,
 * since they call no `registerAllFields()`. So the path with no counter until
 * now is the path most likely to have no provider either.
 *
 * The counter's copy moved packages in objectui#3439 (`@object-ui/fields` →
 * `@object-ui/components`, following `FullscreenEditor`'s hoist), and its
 * `createSafeTranslation` defaults moved with it. This file is the pin that the
 * move was byte-identical: with no translations configured a bare hook returns
 * the raw KEY and drops the interpolation entirely, so anything less than the
 * exact sentence below is a regression a provider-ful test cannot see.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

/** No provider anywhere in this file — that is the whole point of it. */
function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(<Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />);
}

const inlineTextarea = () => document.querySelectorAll('textarea')[0] as HTMLTextAreaElement;

/** Resolve the accessible DESCRIPTION the way an assistive technology does. */
const describedTextOf = (el: Element) => {
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
};

afterEach(() => cleanup());

describe('built-in textarea counter — no I18nProvider (objectui#3439)', () => {
  it('announces the cap in byte-identical English', () => {
    renderForm([{ name: 'notes', label: 'Notes', type: 'textarea', maxLength: 100 }]);
    expect(describedTextOf(inlineTextarea())).toBe('Character count: 0 of 100');
  });

  it('never leaks a raw translation key to the user', () => {
    renderForm([{ name: 'notes', label: 'Notes', type: 'textarea', maxLength: 100 }]);
    // The failure mode a bare `useObjectTranslation` produces here: the key
    // itself, with `{{count}}` / `{{max}}` never interpolated.
    const described = describedTextOf(inlineTextarea());
    expect(described).not.toContain('fields.textarea');
    expect(described).not.toContain('{{');
  });

  it('still renders the visible digits', () => {
    renderForm([{ name: 'notes', label: 'Notes', type: 'textarea', maxLength: 100 }]);
    expect(document.querySelector('[data-testid="form-textarea-character-count"]')).toHaveTextContent(
      '0/100',
    );
  });
});
