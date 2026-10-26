/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The REGISTERED path's fullscreen long-text dialog speaks the session locale —
 * objectui#3404.
 *
 * This is the second half of objectui#3272. That issue translated the built-in
 * branch (`FullscreenTextarea` in `components/src/renderers/form/form.tsx`,
 * pinned next door in `form-fullscreen-textarea-i18n.test.tsx`); the shared
 * `FullscreenFieldEditor` that `TextAreaField` and `RichTextField` render was
 * left with four English literals — the toggle's accessible name
 * (`Edit ${label} fullscreen`), the title fallback `Edit text`, `Cancel` and
 * `Done`.
 *
 * Nothing about the keys was missing: `form.fullscreen.*` and `common.cancel`
 * have shipped in all ten locale packs since #3272. This path simply never
 * consumed them, so the defect was visible INSIDE A SINGLE FORM: with
 * `ObjectFormSchema.mobile.fullscreenLongText` on, `ObjectForm` stamps
 * `mobile_fullscreen` onto every long-text field, and a zh session got
 * 「取消 / 完成」 from a built-in-rendered field and `Cancel / Done` from a
 * registered-widget one.
 *
 * ## What the cases assert, and why in this shape
 *
 * - **Both widgets.** `TextAreaField` (`field:textarea`) and `RichTextField`
 *   (`field:markdown` / `field:html`) are the two hosts, and the copy lives in
 *   the component they share. Covering one would leave a regression that broke
 *   only the other's props path (`label`, `testIdPrefix`) unreported.
 * - **`en` is a NO-OP pin, not a defect reproducer.** The four literals were
 *   byte-identical to the `en` pack, so the English cases below were green
 *   before this change too. They are here to prove the swap did not alter the
 *   English rendering — the direction that only a positive assertion can see.
 * - **Non-`en` positive AND English-literal negative, together.** A re-inlined
 *   literal rendered next to a translated sibling still satisfies a
 *   positive-only assertion. `ja` joins `zh` because the toggle's name is
 *   INTERPOLATED (`{{label}}` + a translated generic noun) and the two packs
 *   put the noun on opposite sides — a build that dropped the interpolation
 *   passes a zh-only check by luck.
 * - **Un-labelled fixtures for the generic copy.** `form.fullscreen.title` and
 *   `form.fullscreen.textFallback` are reachable only when the field has no
 *   `label` (a labelled field titles the dialog with its own label, in the
 *   author's language, on both paths). The labelled stack is pinned separately
 *   at the bottom, where what matters is that `{{label}}` is interpolated into
 *   translated surroundings rather than concatenated in English.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';

import { TextAreaField } from '../TextAreaField';
import { RichTextField } from '../RichTextField';
import type { FieldMetadata } from '@object-ui/types';

/**
 * No `label` — the one authoring stack the generic copy is written for. The
 * flag is spelled `mobile_fullscreen`, the single carrier `ObjectForm`
 * produces (#3233/#3301).
 */
const textareaField = (extra: Record<string, unknown> = {}) =>
  ({ name: 'notes', type: 'textarea', mobile_fullscreen: true, ...extra }) as unknown as FieldMetadata;

const markdownField = (extra: Record<string, unknown> = {}) =>
  ({ name: 'notes', type: 'markdown', mobile_fullscreen: true, ...extra }) as unknown as FieldMetadata;

function renderIn(language: string, element: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {element}
    </I18nProvider>,
  );
}

/** Open the dialog and hand back the trigger, so its name can be asserted too. */
function openFullscreen(prefix: 'textarea' | 'richtext') {
  const toggle = screen.getByTestId(`${prefix}-fullscreen-toggle`);
  fireEvent.click(toggle);
  return toggle;
}

describe('TextAreaField fullscreen dialog is translated (objectui#3404)', () => {
  it('renders the English copy under an en provider', () => {
    renderIn('en', <TextAreaField value="hello" onChange={vi.fn()} field={textareaField()} />);
    const toggle = openFullscreen('textarea');

    // Byte-identical to the literals this replaced, so `en` is a no-op change.
    expect(toggle).toHaveAttribute('aria-label', 'Edit text fullscreen');
    expect(screen.getByText('Edit text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('renders the whole dialog in Chinese under a zh provider', () => {
    renderIn('zh', <TextAreaField value="hello" onChange={vi.fn()} field={textareaField()} />);
    const toggle = openFullscreen('textarea');

    expect(toggle).toHaveAttribute('aria-label', '全屏编辑文本');
    expect(screen.getByText('编辑文本')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();

    // The four literals, asserted absent. `Edit text` is matched loosely
    // because it was BOTH the dialog title and part of the trigger's name.
    expect(screen.queryByText(/edit text/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(toggle.getAttribute('aria-label')).not.toMatch(/fullscreen/i);
  });

  it('renders the whole dialog in Japanese under a ja provider', () => {
    renderIn('ja', <TextAreaField value="hello" onChange={vi.fn()} field={textareaField()} />);
    const toggle = openFullscreen('textarea');

    expect(toggle).toHaveAttribute('aria-label', 'テキストを全画面で編集');
    expect(screen.getByText('テキストを編集')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完了' })).toBeInTheDocument();

    expect(screen.queryByText(/edit text/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });
});

describe('RichTextField fullscreen dialog is translated (objectui#3404)', () => {
  // The second host of the SAME component. The copy is shared, the props path
  // into it (`label`, `testIdPrefix`) is not.
  it('renders the English copy under an en provider', () => {
    renderIn('en', <RichTextField value="# hello" onChange={vi.fn()} field={markdownField()} />);
    const toggle = openFullscreen('richtext');

    expect(toggle).toHaveAttribute('aria-label', 'Edit text fullscreen');
    expect(screen.getByText('Edit text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('renders the whole dialog in Chinese under a zh provider', () => {
    renderIn('zh', <RichTextField value="# hello" onChange={vi.fn()} field={markdownField()} />);
    const toggle = openFullscreen('richtext');

    expect(toggle).toHaveAttribute('aria-label', '全屏编辑文本');
    expect(screen.getByText('编辑文本')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();

    expect(screen.queryByText(/edit text/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(toggle.getAttribute('aria-label')).not.toMatch(/fullscreen/i);
  });
});

describe('fullscreen dialog copy — the field label is interpolated, not concatenated (objectui#3404)', () => {
  it("titles the dialog with the author's label and interpolates it into the trigger name", () => {
    // A labelled field keeps its own label as the title on both paths — what
    // must be translated around it is the trigger's sentence. `Edit Notes
    // fullscreen` was the literal; zh wraps the label instead of prefixing it.
    renderIn(
      'zh',
      <TextAreaField value="hello" onChange={vi.fn()} field={textareaField({ label: 'Notes' })} />,
    );
    const toggle = openFullscreen('textarea');

    expect(toggle).toHaveAttribute('aria-label', '全屏编辑Notes');
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(toggle.getAttribute('aria-label')).not.toMatch(/^Edit /);
  });

  it('still commits the draft — translating the footer did not unwire it', () => {
    // "Done" lost its literal child. This pins that the click handler still
    // rides on the translated button and not on some node that merely used to
    // carry the old text.
    const onChange = vi.fn();
    renderIn('zh', <TextAreaField value="hello" onChange={onChange} field={textareaField()} />);
    openFullscreen('textarea');

    fireEvent.change(screen.getByTestId('textarea-fullscreen-input'), {
      target: { value: 'hello from fullscreen' },
    });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    expect(onChange).toHaveBeenCalledWith('hello from fullscreen');
    expect(screen.queryByTestId('textarea-fullscreen-dialog')).not.toBeInTheDocument();
  });

  it('still discards the draft on the translated Cancel', () => {
    const onChange = vi.fn();
    renderIn('zh', <TextAreaField value="hello" onChange={onChange} field={textareaField()} />);
    openFullscreen('textarea');

    fireEvent.change(screen.getByTestId('textarea-fullscreen-input'), {
      target: { value: 'discarded' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('textarea-fullscreen-dialog')).not.toBeInTheDocument();
  });
});

describe('fullscreen dialog has an accessible description (objectui#3404)', () => {
  /**
   * The issue listed this as an unverified aside. What was measured: Radix
   * only sets `aria-describedby` when a `Dialog.Description` is present
   * (`descriptionPresent ? descriptionId : undefined`), so before this change
   * the registered path's dialog had NO accessible description while the
   * byte-identical built-in one did, and `form.fullscreen.description` was a
   * key with no consumer on this path.
   *
   * Explicitly NOT justified by a console warning: `@radix-ui/react-dialog`
   * 1.1.23 (the pinned version) contains no `console.*` call at all — the
   * missing-Description warning older versions emitted is gone upstream, and
   * no warning fired in the baseline run.
   */
  it('wires aria-describedby to the translated sr-only description', () => {
    renderIn('zh', <TextAreaField value="hello" onChange={vi.fn()} field={textareaField()} />);
    openFullscreen('textarea');

    const dialog = screen.getByTestId('textarea-fullscreen-dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const description = document.getElementById(describedBy!);
    expect(description).not.toBeNull();
    expect(description).toHaveTextContent('编辑完整的文本内容，然后保存或取消更改。');
  });

  it('renders the English description under an en provider', () => {
    renderIn('en', <TextAreaField value="hello" onChange={vi.fn()} field={textareaField()} />);
    openFullscreen('textarea');

    expect(
      screen.getByText('Edit the full text value, then save or cancel your changes.'),
    ).toBeInTheDocument();
  });
});

// The provider-LESS leg lives in `FullscreenFieldEditor.no-provider.test.tsx`.
// It cannot share this file: mounting `I18nProvider` installs its instance as
// react-i18next's GLOBAL default, so after any case above there is no
// "no provider" state left in this module graph to observe. See that file's
// header — it was measured, not assumed.
