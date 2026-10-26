/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The invalid-submit toast joins the field names with a PER-LOCALE separator —
 * objectstack#5407.
 *
 * `announceFieldErrors` used to build the list with a hardcoded `、` (U+3001).
 * That is the CJK enumeration comma: correct for zh/ja by accident, wrong in
 * every Latin locale, and most visibly wrong in English, where the toast read
 *
 *     Please check the highlighted fields: Subject、Account、Status
 *
 * List punctuation is a property of the locale, not of the code, so the
 * separator is now its own bundle entry (`validation.formInvalidJoiner`) that
 * each pack declares. `Intl.ListFormat` was measured and rejected for this
 * call site: its `unit` styles emit an EMPTY separator for zh and ru, and its
 * `conjunction` styles splice in "and"/"和"/"y", which reads as a sentence
 * rather than as the truncated list this is ("A, B, C…").
 *
 * The two locales asserted here are the two SIDES of the bug: `en` is the one
 * that was visibly wrong, `zh` the one that was right by accident and must
 * stay right now that the value is declared rather than assumed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { toast } from '../../../ui/sonner';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

let toastErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'id' as any);
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Three required fields, so the joiner appears twice and truncation does not. */
const fields = [
  { name: 'subject', label: 'Subject', type: 'input', required: true },
  { name: 'account', label: 'Account', type: 'input', required: true },
  { name: 'status', label: 'Status', type: 'input', required: true },
];

function renderFormIn(language: string) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <Form
        schema={{
          type: 'form',
          mode: 'create',
          showSubmit: true,
          showCancel: false,
          submitLabel: 'Create',
          fields,
        }}
      />
    </I18nProvider>,
  );
}

async function toastTextAfterSubmit(language: string): Promise<string> {
  renderFormIn(language);
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  await waitFor(() => expect(toastErrorSpy).toHaveBeenCalled());
  return String(toastErrorSpy.mock.calls[0][0]);
}

describe('form renderer — invalid-submit toast list joiner (objectstack#5407)', () => {
  it('joins with a comma+space under an en session, never the CJK comma', async () => {
    const text = await toastTextAfterSubmit('en');

    expect(text).toContain('Subject, Account, Status');
    // The literal this replaced. Asserted negatively as well as positively so a
    // re-hardcoded joiner cannot pass by rendering both forms somewhere.
    expect(text).not.toContain('、');
  });

  it('still joins with the CJK comma under a zh session', async () => {
    const text = await toastTextAfterSubmit('zh');

    expect(text).toContain('Subject、Account、Status');
    // zh's sentence, to prove the joiner is being read from the zh pack and not
    // from an `en` fallback that happens to carry the same punctuation.
    expect(text).toContain('请检查表单中标记的字段');
  });
});
