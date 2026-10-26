/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4767 — the modal-target refusal is ONE message, built once.
 *
 * PR #4764 retired the object fallback (`type: 'modal'` targets a page, only)
 * and rewrote `useActionModal.modalHandler`'s diagnostic to name the refused
 * target and point at `type: 'form'`. The two copies a console user actually
 * reaches — `useConsoleActionRuntime.modalActionHandler` and
 * `RecordDetailView.modalActionHandler` — were hand-written duplicates and kept
 * the pre-retirement text: "names no page or object to open", pointing only at
 * `type: 'script'`. The "or object" half described a limb that no longer
 * existed, and the replacement capability was never mentioned.
 *
 * These pin the CONTENT contract of the shared constructor; the two runtime
 * call sites are pinned in `useConsoleActionRuntime.test.tsx` and
 * `RecordDetailView.modalDispatch.test.tsx`, and `modalHandler`'s in
 * `useActionModal.resolve.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { modalTargetRefusalMessage } from '../modalTargetDiagnostics';

describe('modalTargetRefusalMessage — every variant carries the same contract', () => {
  // The bare-target form is what `useActionModal.modalHandler` emits. Asserted
  // as an EXACT string because PR #4764 settled this wording and objectui#4767
  // is a de-duplication, not a rewording: if extracting the constructor changed
  // even a byte of what #4764 shipped, that is a regression, not a cleanup.
  it('reproduces PR #4764\'s modalHandler message byte for byte', () => {
    expect(modalTargetRefusalMessage({ target: 'contact' })).toBe(
      'Modal target "contact" names no page — a modal action\'s `target` names a PAGE, only. ' +
        "To open an object's form, use `type: 'form'` with an `<object>.<view>` target.",
    );
  });

  it('names the ACTION as well as the target when the caller knows it', () => {
    const msg = modalTargetRefusalMessage({ actionName: 'log_call', target: 'schedule_followup' });
    expect(msg).toContain('Action "log_call"');
    expect(msg).toContain('"schedule_followup"');
    expect(msg).toContain('names no page');
  });

  // The three facts objectui#4767 found missing from the console copies. Every
  // variant that has a target to talk about must carry all three.
  it.each([
    ['bare target', { target: 'schedule_followup' }],
    ['with action name', { actionName: 'log_call', target: 'schedule_followup' }],
    ['console variant', { actionName: 'log_call', target: 'schedule_followup', serverHandlerHint: true }],
  ])('%s: names the target, points at type: form, and never says "or object"', (_label, options) => {
    const msg = modalTargetRefusalMessage(options);
    expect(msg).toContain('schedule_followup');
    expect(msg).toContain("type: 'form'");
    expect(msg).not.toMatch(/or object/);
    // The retired limb, in every spelling the old copies used.
    expect(msg).not.toMatch(/no page or object/);
  });

  // The console runtimes keep the second way out — collect input, then run a
  // handler — because a target that names nothing at all is just as likely an
  // author who wanted a scripted dialog as one who wanted a form. It rides
  // ALONGSIDE the form pointer now instead of replacing it.
  it('appends the server-handler hint only when asked', () => {
    const withHint = modalTargetRefusalMessage({ target: 'x', serverHandlerHint: true });
    const without = modalTargetRefusalMessage({ target: 'x' });

    expect(withHint).toContain("type: 'script'");
    expect(withHint).toContain("type: 'form'");
    expect(without).not.toContain("type: 'script'");
    // The hint is additive: everything the plain form says, the console form
    // says too. This is what keeps "unified" true as the contract changes.
    expect(withHint.startsWith(without)).toBe(true);
  });

  // A missing target is a DIFFERENT authoring mistake ("declare one") from a
  // target that resolves to nothing ("declare a different one"), so it gets no
  // contract sentence to hang a name on. PR #4764 pinned this exact string.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
  ])('reports a missing target (%s) distinctly, with no contract tail', (_label, target) => {
    expect(modalTargetRefusalMessage({ target })).toBe('Modal action has no target to open.');
    expect(modalTargetRefusalMessage({ target, actionName: 'log_call' })).toBe(
      'Action "log_call" is type:\'modal\' but has no target to open.',
    );
    expect(modalTargetRefusalMessage({ target, serverHandlerHint: true })).not.toContain('script');
  });

  it('defaults to the missing-target message when called with nothing', () => {
    expect(modalTargetRefusalMessage()).toBe('Modal action has no target to open.');
  });

  // The console call sites pass `action.modal ?? action.target ?? …` straight
  // through, which can be an inline descriptor OBJECT. The pre-extraction code
  // stringified it the same way; preserved so a non-string target still names
  // something rather than crashing or silently becoming the missing-target case.
  it('stringifies a non-string target rather than treating it as absent', () => {
    const msg = modalTargetRefusalMessage({ target: { objectName: 'contact' }, actionName: 'a' });
    expect(msg).toContain('[object Object]');
    expect(msg).toContain('names no page');
  });
});
