/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { FullscreenEditor, type FullscreenEditorProps } from '@object-ui/components';

/**
 * The fullscreen-edit affordance shared by every long-text widget in this
 * package (`field:textarea` → `TextAreaField`, `field:markdown` / `field:html`
 * → `RichTextField`).
 *
 * ## This is now a thin wrapper (objectui#3398)
 *
 * The affordance, the dialog, the draft/commit state machine and the
 * `readOnly` / `disabled` semantics all live in `FullscreenEditor`
 * (`@object-ui/components`). They used to live here AND, separately, in the
 * form renderer's built-in `textarea` branch — one form-level promise
 * (`ObjectFormSchema.mobile.fullscreenLongText`, projected onto every long-text
 * field as `mobile_fullscreen`) answered twice, on the two render paths.
 *
 * Two copies of a state machine drift, and these did: objectui#3400 measured a
 * read-only field editable through the built-in branch's dialog, objectui#3402
 * measured the same hole for `disabled` here, and #3393 (label in the dialog
 * title) and #3272 (i18n) each landed on one side before the other. The
 * maintainer's ruling of 2026-08-10 was one implementation hoisted to the
 * dependency-legal side — and the measured import graph allows exactly that
 * direction: this package depends on `@object-ui/components`, which declares no
 * dependency on `@object-ui/fields` in `dependencies` or `peerDependencies`.
 *
 * ## Why the wrapper survives the merge rather than being deleted
 *
 * It carries the one thing that is genuinely about THIS package: `readOnly` is
 * not part of the contract here. Both hosts early-return a read-only DISPLAY
 * before they compute the affordance (`TextAreaField.tsx`, `RichTextField.tsx`),
 * so a `readOnly` reaching this component would be a prop with no producer on
 * this path — the shape this package keeps deleting (objectui#3232/#3233). The
 * `Omit` below is that statement in the type system, and it is why the hoist did
 * not simply re-export the primitive. A future host that renders an editor for
 * read-only fields must widen this type AND pass the prop together; the
 * primitive already answers it (no affordance at all).
 *
 * Everything else — `value` / `onCommit` / `label` / `testIdPrefix` /
 * `disabled` / `error` / `children` / `footer` — passes straight through, so the
 * hosts and their pins are unchanged. `error` is REQUIRED by the primitive
 * (objectui#4824) and stays required here: both hosts already destructure it off
 * the widget props contract (objectui#3222), and it is what the primitive turns
 * into the dialog control's `aria-invalid` / `aria-errormessage` and into the
 * dialog-local message node. A host that omits it gets a dialog announcing
 * `aria-invalid="false"` for an invalid field, which is the defect #4824
 * measured — so the type system asks for it rather than trusting the next
 * author to remember. `testIdPrefix` still namespaces this package's ids
 * (`textarea-`, `richtext-`), distinct from the built-in branch's
 * `form-textarea-`, so a test can still say which render path it found.
 */
export type FullscreenFieldEditorProps = Omit<FullscreenEditorProps, 'readOnly'>;

export function FullscreenFieldEditor(props: FullscreenFieldEditorProps) {
  // `readOnly` is deliberately not forwarded — it is not in the props type, and
  // the primitive defaults it to false, which is the behaviour both hosts rely
  // on: they have already returned a read-only display before reaching here.
  return <FullscreenEditor {...props} />;
}
