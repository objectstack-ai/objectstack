/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The fullscreen long-text editor speaks the session locale — objectui#3272.
 *
 * `FullscreenTextarea` is a whole dialog (title, sr-only description, footer
 * buttons) plus the trigger's accessible name, and NONE of it went through
 * `t()`: a zh/ja/ar session opened a dialog that read "Edit text" / "Cancel" /
 * "Done" while every other sentence in the same form was translated.
 *
 * The fixture spells the flag `mobile_fullscreen` — the one carrier
 * `ObjectForm` actually produces (#3245/#3300). The built-in branch also reads
 * an aliased `fullscreen`, but that alias has no producer and is #3303's to
 * remove; pinning the canonical spelling keeps this suite green either way.
 *
 * Every locale case asserts the English literal is GONE as well as that the
 * translation is present: a re-inlined literal alongside a translated sibling
 * would still satisfy a positive-only assertion.
 *
 * The copy fixtures are deliberately LABEL-LESS since objectui#3393. The
 * subject of this suite is the two GENERIC strings — `form.fullscreen.title`
 * ("Edit text") and `form.fullscreen.textFallback` ("text", interpolated into
 * `form.fullscreen.toggle`) — which are reachable only when the field has no
 * label. When these cases were written the field was labelled `Notes` and the
 * generic copy still appeared, because the renderer never forwarded `label`;
 * that was the bug #3393 fixed, and re-pointing the fixtures at the stack the
 * fallback actually serves is what keeps these ten packs covered rather than
 * re-asserting the fixed defect. The labelled stack is pinned next door, in
 * `form-fullscreen-textarea-label.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Registered at module scope, NOT in a `beforeAll` — there the cold transform
// is billed to `hookTimeout` (objectui#3010/#3021).
import '../../../renderers';

/** No `label` — the one authoring stack the generic copy is written for. */
const unlabelledFields = [
  { name: 'notes', type: 'textarea', mobile_fullscreen: true },
];

const labelledFields = [
  { name: 'notes', label: 'Notes', type: 'textarea', mobile_fullscreen: true },
];

function renderFormIn(language: string, fields: any[] = unlabelledFields) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <Form
        schema={{ type: 'form', showSubmit: false, showCancel: false, fields }}
      />
    </I18nProvider>,
  );
}

/** Open the dialog and hand back the trigger, so its name can be asserted too. */
function openFullscreen() {
  const toggle = screen.getByTestId('form-textarea-fullscreen-toggle');
  fireEvent.click(toggle);
  return toggle;
}

describe('form renderer — fullscreen textarea dialog is translated (objectui#3272)', () => {
  it('renders the English copy under an en provider', () => {
    renderFormIn('en');
    const toggle = openFullscreen();

    // Byte-identical to the literals this replaced, so `en` is a no-op change.
    expect(toggle).toHaveAttribute('aria-label', 'Edit text fullscreen');
    expect(screen.getByText('Edit text')).toBeInTheDocument();
    expect(
      screen.getByText('Edit the full text value, then save or cancel your changes.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('renders the whole dialog in Chinese under a zh provider', () => {
    renderFormIn('zh');
    const toggle = openFullscreen();

    expect(toggle).toHaveAttribute('aria-label', '全屏编辑文本');
    expect(screen.getByText('编辑文本')).toBeInTheDocument();
    expect(screen.getByText('编辑完整的文本内容，然后保存或取消更改。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();

    // The four literals, asserted absent. `Edit text` is matched loosely
    // because it was BOTH the dialog title and part of the trigger's name.
    expect(screen.queryByText(/edit text/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/save or cancel your changes/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(toggle.getAttribute('aria-label')).not.toMatch(/fullscreen/i);
  });

  it('renders the whole dialog in Japanese under a ja provider', () => {
    // A second non-en pack because the trigger's name is INTERPOLATED
    // (`{{label}}` + a translated generic noun): ja puts the noun first
    // ("テキストを全画面で編集"), en last. A pack that dropped the
    // interpolation would still pass a zh-only assertion by accident.
    renderFormIn('ja');
    const toggle = openFullscreen();

    expect(toggle).toHaveAttribute('aria-label', 'テキストを全画面で編集');
    expect(screen.getByText('テキストを編集')).toBeInTheDocument();
    expect(
      screen.getByText('テキスト全体を編集してから、変更を保存またはキャンセルしてください。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完了' })).toBeInTheDocument();

    expect(screen.queryByText(/edit text/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('still commits the draft — translating the footer did not unwire it', () => {
    // The `Done` button lost its literal child; this pins that the click
    // handler still rides on the translated button rather than on some other
    // node that happened to carry the old text.
    // Labelled here, so the committed value can be found through the field's
    // own `<FormLabel>` association — this case asserts wiring, not copy.
    renderFormIn('zh', labelledFields);
    openFullscreen();

    fireEvent.change(screen.getByTestId('form-textarea-fullscreen-input'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    expect(screen.queryByTestId('form-textarea-fullscreen-dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue('hello');
  });
});
