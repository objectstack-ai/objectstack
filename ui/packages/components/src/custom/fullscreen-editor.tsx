/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useId, useState } from 'react';
import { cn } from '../lib/utils';
import { DIALOG_VIEWPORT_GUTTER } from './dialog-viewport-gutter';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Maximize2, Check, X } from 'lucide-react';
import { createSafeTranslation } from '@object-ui/i18n';

/**
 * The fullscreen-edit affordance shared by every long-text editing surface: the
 * "expand" button plus the full-height dialog it opens, and the draft/commit
 * state machine behind them.
 *
 * ## Why this lives in `components` (objectui#3398)
 *
 * There were two hand-written copies of this state machine — `FullscreenTextarea`
 * in `renderers/form/form.tsx` (the form renderer's built-in, unregistered
 * `textarea` branch) and `FullscreenFieldEditor` in `@object-ui/fields` (the
 * registered `TextAreaField` / `RichTextField` widgets). They exist because ONE
 * form-level promise — `ObjectFormSchema.mobile.fullscreenLongText`, projected
 * onto every long-text field as `mobile_fullscreen` — is honoured on two render
 * paths, and each path grew its own answer.
 *
 * They drifted, exactly as two copies of a state machine do: objectui#3400
 * measured a read-only long-text field that was editable through the built-in
 * branch's dialog, and objectui#3402 measured the same hole for `disabled` on
 * the registered path. Each was fixed on its own side, which is the repair that
 * does not scale — #3393 (the dialog title needs the field label) and #3272
 * (the copy needs i18n) had each already landed on one side first.
 *
 * The merge direction is the maintainer's ruling of 2026-08-10 and follows the
 * measured import graph rather than fighting it: `@object-ui/fields` depends on
 * `@object-ui/components`, and `components` declares no dependency on `fields`
 * in either `dependencies` or `peerDependencies`. So the shared primitive lands
 * HERE, where both render paths may reach it, and `FullscreenFieldEditor`
 * becomes a thin wrapper over it.
 *
 * This is a deliberate, bounded exception to this package's "Pure UI, no
 * business logic" charter (AGENTS.md §3). What it owns is interaction state — a
 * draft string, an open flag, and when a value may leave — not business logic:
 * no metadata is read, no data layer is touched, and nothing from `fields` is
 * imported. Anything widget-specific stays in the caller: the EDITOR itself is
 * injected through `children`, so "fullscreen" is a size change rather than a
 * second, poorer editing surface.
 *
 * ## Draft semantics
 *
 * The dialog edits a LOCAL draft seeded from `value` at open time and commits
 * once, on "Done". It deliberately does not stream every keystroke to the host:
 * these editors sit in a react-hook-form field, and a per-keystroke `onCommit`
 * during a modal edit would mark the form dirty (and fire validation) for an
 * edit the user may still cancel. "Cancel" therefore needs no undo — nothing was
 * written.
 *
 * ## `readOnly` and `disabled` are DEFINED here, not inherited by accident
 *
 * This is the load-bearing half of the merge. Neither copy defined both: the
 * built-in one grew them under objectui#3400, while the fields one declared
 * only `disabled` and was shielded from `readonly` by its hosts' early return.
 * A single implementation cannot be shielded by one caller's control flow, so
 * both states are answered here and both call paths inherit the same answers:
 *
 *  - `readOnly` → NO affordance at all. Not a disabled button: `readonly` means
 *    "shown plainly, not editable", so advertising an expand button the user
 *    cannot use is worse than showing none. This matches what the registered
 *    path already did by early-returning a read-only display before it computed
 *    the affordance, and what objectui#3400 fixed the built-in path to do.
 *  - `disabled` → the toggle STAYS but is inert, because `disabled` means "not
 *    interactive, muted" rather than "shown plainly".
 *
 * Neither state relies on the toggle alone, and that is not belt-and-braces:
 * `disabled` also carries the form's `isSubmitting`, which flips to true while
 * the dialog may ALREADY be open — at that moment the toggle is not reachable
 * but the dialog is. So `openFullscreen` refuses independently of the
 * attribute (a programmatic dispatch and a lost `pointer-events` rule both get
 * past it), the injected editor is told (third `children` argument) so the host
 * can render its own control inert, "Done" is disabled, and `onCommit` is gated
 * — the last of those being THE gate, since it is the single point where a
 * value leaves this component for host state and nothing native guards a click
 * handler on a different control reading React state.
 *
 * "Cancel" and `Esc` stay live in every state — a dialog that goes disabled
 * mid-edit must still be closable, or a submit in flight traps the user in it.
 *
 * A `readOnly` that flips true mid-edit (it is resolvable at runtime from a
 * `readonlyWhen` CEL rule) unmounts the dialog and discards the draft. That is
 * the safe direction — nothing is written — and it follows from `readOnly`
 * meaning there is no editing surface at all.
 *
 * ## Validation state and the accessible name are answered HERE (objectui#4824 / #4832)
 *
 * The editor injected through `children` is built from scratch by the host, and
 * for three surfaces in a row that meant it was built without any of the
 * accessibility wiring the INLINE control gets for free from the form renderer.
 * Measured on all three (`TextAreaField`, `RichTextField`, the form renderer's
 * built-in `textarea` branch): the dialog control had no accessible name at all,
 * and its validation state was either missing or — worse — actively wrong
 * (`RichTextEditorSurface` computed `aria-invalid={!!error}` from an `error`
 * prop the dialog rendering never received, so the dialog announced
 * `aria-invalid="false"` for a field whose inline control was announcing
 * `true` at the same moment).
 *
 * Neither is something a host can be trusted to re-answer once per surface —
 * that is the shape that produced three identical holes. So this primitive owns
 * both, and hands the result to `children` as a required fourth argument the
 * host spreads onto whatever control it renders (the #3417 required-parameter
 * shape). The host never learns an id, so it cannot name the wrong node.
 *
 *  - **Name** — `aria-labelledby` points at the dialog title's own text node.
 *    The visible title is already the field label (#3393), so this reuses the
 *    one naming channel rather than minting a second author for the name
 *    (#3978). The id sits on a `<span>` INSIDE `<DialogTitle>` rather than on
 *    the title element: Radix renders `<h2 id={context.titleId} {...props}>`, so
 *    an `id` passed to `DialogTitle` would replace the id `DialogContent`'s own
 *    `aria-labelledby` names and cost the DIALOG its accessible name.
 *  - **Validation** — `aria-invalid` from `error`, plus `aria-errormessage`
 *    naming a dialog-LOCAL node that renders the message text.
 *
 * ## Why the message text is rendered here at all
 *
 * objectui#3222 ruled that a widget drives `aria-invalid` and leaves the TEXT to
 * `<FormMessage/>`, to keep one copy of it in the accessibility tree. The
 * maintainer's ruling of 2026-08-16 restates that rule as what it was always
 * protecting — "only one copy of the error text is in the accessibility tree at
 * any moment" — which this node satisfies: it exists only while the dialog is
 * open, and for exactly that window Radix `aria-hidden`s everything outside the
 * modal, `<FormMessage/>` included. There is no window in which both are
 * readable.
 *
 * ⛔ The shortcut this replaces is forbidden: pointing the dialog control's
 * `aria-describedby` / `aria-errormessage` at the host's `<FormMessage>` id.
 * That target is outside the modal and `aria-hidden` for the whole time the
 * reference is live — an ARIA MUST violation that no jsdom/happy-dom test can
 * see, because the id resolves and the node has text.
 *
 * `aria-errormessage` carries a SINGLE id (this repo's toolchain rejects a list
 * there) and is emitted only alongside `aria-invalid="true"`, which is the
 * condition under which it is exposed at all. It is deliberately not folded
 * into the host's `aria-describedby` chain.
 *
 * ## Copy
 *
 * Every string goes through `createSafeTranslation` on the SAME
 * `form.fullscreen.*` / `common.cancel` keys both copies already consumed
 * (objectui#3272 on the built-in path, objectui#3404 on the registered one), so
 * the ten locale packs need no new entries and the two paths cannot drift into
 * two wordings. The safe hook — not bare `useObjectTranslation` — because this
 * primitive is rendered without an `I18nProvider` by standalone/embedded hosts
 * and by many bare-render tests; measured with no provider, the bare hook
 * returns the raw KEY for every one of these strings and drops the `{{label}}`
 * interpolation entirely. The English defaults below are byte-identical to the
 * literals both copies shipped, so provider-less rendering is unchanged.
 *
 * Focus management, `Esc`, the overlay and the close button are Radix's, via
 * this package's `Dialog` — deliberately not re-answered here.
 */
const useSafeFullscreenTranslation = createSafeTranslation(
  {
    'common.cancel': 'Cancel',
    'form.fullscreen.title': 'Edit text',
    'form.fullscreen.description':
      'Edit the full text value, then save or cancel your changes.',
    'form.fullscreen.done': 'Done',
    // ONE interpolated sentence with a TRANSLATED generic noun standing in for
    // a missing label, keeping the original literal's shape
    // (`Edit ${label ?? 'text'} fullscreen`). A second, label-less sentence key
    // would need ten new pack entries to say the same thing.
    'form.fullscreen.toggle': 'Edit {{label}} fullscreen',
    'form.fullscreen.textFallback': 'text',
  },
  // Probe key: one this primitive itself consumes, so it cannot rot into
  // pointing at a key no caller reads. With no translations configured
  // `t('common.cancel')` returns the key itself, which is the signal to serve
  // the English defaults above.
  'common.cancel',
);

/**
 * The accessibility attributes the dialog's injected editor MUST carry, handed
 * to `children` as its required fourth argument (objectui#4824 / #4832).
 *
 * Shaped as a spreadable set of real DOM attributes rather than the ids behind
 * them, on purpose: `{...aria}` is the whole integration, so a host cannot get
 * the composition subtly wrong, cannot name a node outside the dialog, and
 * cannot compute its own `aria-invalid` from a prop it forgot to plumb — the
 * three ways every one of the three surfaces got this wrong before.
 */
export interface FullscreenEditorAria {
  /**
   * The dialog title's text node — the field label (#3393) reused as the
   * control's accessible name rather than a second, string-valued author for it.
   */
  'aria-labelledby': string;
  /** Mirrors `error`, so the dialog cannot disagree with the inline control. */
  'aria-invalid': boolean;
  /**
   * The dialog-local message node. A SINGLE id, present only when `error` is —
   * `aria-errormessage` is exposed only alongside `aria-invalid="true"`, and
   * this repo's toolchain does not accept an id list here.
   */
  'aria-errormessage'?: string;
}

export interface FullscreenEditorProps {
  /**
   * The committed value. Seeds the draft each time the dialog opens — read at
   * open time, not held, so a value that changes underneath while the dialog is
   * closed is picked up on the next open.
   */
  value: string;
  /** Called once with the draft when the user confirms. Gated — see above. */
  onCommit: (next: string) => void;
  /** Field label — the dialog title and part of the toggle's accessible name. */
  label?: string;
  /**
   * Namespace for this surface's fullscreen test ids:
   * `<prefix>-fullscreen-toggle` / `-dialog` / `-save`. One form can contain a
   * textarea AND a markdown field, so a single shared id would leave a test
   * unable to say which surface it had found. The injected editor's own test id
   * belongs to `children` for the same reason.
   */
  testIdPrefix: string;
  /**
   * The host field is shown plainly and is not editable. Renders NO affordance
   * at all — see the `readOnly` / `disabled` section above for why this is not
   * a disabled toggle.
   *
   * **Producers**: the form renderer's built-in `textarea` branch, which
   * resolves it from the field's static `readonly` and from a `readonlyWhen`
   * CEL rule. The registered widgets early-return a read-only display before
   * they render this component, so they never pass it.
   */
  readOnly?: boolean;
  /**
   * The host field is not interactive. Disables the toggle, the "Done" button
   * and the write-back, and is handed to `children` so the host's own editor
   * renders inert too.
   *
   * **Producer**: the form renderer computes `disabled || fieldDisabled ||
   * isSubmitting || optionGroupGated` and both forwards it to registered
   * widgets and applies it on the built-in branch.
   */
  disabled?: boolean;
  /**
   * The field's validation message, or `undefined` when the field is valid.
   *
   * **Required, not optional** (objectui#4824). Every consumer already has it —
   * the registered widgets take `error` off the widget props contract
   * (objectui#3222), the built-in branch reads `fieldState.error?.message` — and
   * an omitted `error` reproduces this issue exactly: a dialog that announces
   * `aria-invalid="false"` while the same field's inline control announces
   * `true`. A key the type system makes every call site answer cannot be
   * forgotten by the next surface; an optional one was, three times.
   *
   * **Producers**: `TextAreaField`, `RichTextField`, and the form renderer's
   * built-in `textarea` branch (which reads it off the PRE-strip props, exactly
   * like `label` — `stripRendererOnlyProps` discards `error` for the DOM).
   */
  error: string | undefined;
  /**
   * The editor itself, rendered inside the dialog body against the draft. The
   * host passes the SAME editor it renders inline.
   *
   * The third argument is this component's `disabled`, and the host is expected
   * to put it on the control it renders: only the host knows which element its
   * editor's disabled state belongs on. Ignoring it is not a write-back hole —
   * `onCommit` is gated here regardless — but it does leave a control that looks
   * editable while the field is not, so every in-repo host applies it.
   *
   * The fourth argument is the accessibility set this component owns — name and
   * validation state — and it is spread onto the control the host renders. See
   * `FullscreenEditorAria` and the section above for why it is computed here
   * rather than by each host.
   */
  children: (
    draft: string,
    setDraft: (next: string) => void,
    disabled: boolean,
    aria: FullscreenEditorAria,
  ) => React.ReactNode;
  /** Optional footer status for the draft (e.g. a character counter). */
  footer?: (draft: string) => React.ReactNode;
}

export function FullscreenEditor({
  value,
  onCommit,
  label,
  testIdPrefix,
  readOnly = false,
  disabled = false,
  error,
  children,
  footer,
}: FullscreenEditorProps) {
  const { t } = useSafeFullscreenTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  // Two ids off one `useId()`, both naming nodes this component renders INSIDE
  // the dialog. The host never sees them — it receives the finished attributes —
  // which is what makes "the reference names a node in this dialog" a property
  // of the primitive rather than a rule each host has to remember.
  const instanceId = useId();
  const titleTextId = `${instanceId}-fullscreen-title`;
  const errorId = `${instanceId}-fullscreen-error`;

  const editorAria: FullscreenEditorAria = {
    'aria-labelledby': titleTextId,
    'aria-invalid': Boolean(error),
    // Spread conditionally: absent, not `undefined`. `aria-errormessage` is only
    // exposed alongside `aria-invalid="true"`, and a valid field renders no node
    // for it to name.
    ...(error ? { 'aria-errormessage': errorId } : null),
  };

  const openFullscreen = () => {
    if (disabled || readOnly) return;
    setDraft(value ?? '');
    setOpen(true);
  };
  const cancelFullscreen = () => setOpen(false);
  const commitFullscreen = () => {
    // THE gate: the one point where a value leaves this component for host
    // state. `disabled` can flip to true while the dialog is open (it carries
    // the form's `isSubmitting`), so it is checked here and not only on the way
    // in. Closing is unconditional — see "Cancel and Esc stay live" above.
    if (!disabled && !readOnly) onCommit(draft);
    setOpen(false);
  };

  // No affordance for a read-only field, so there is nothing to render at all —
  // not the toggle, and not the dialog the toggle is the only entry point to.
  if (readOnly) return null;

  return (
    <>
      <button
        type="button"
        onClick={openFullscreen}
        disabled={disabled}
        className={cn(
          'absolute top-1.5 right-1.5 inline-flex items-center justify-center size-7 rounded-md bg-background/80 text-muted-foreground hover:text-foreground hover:bg-background border shadow-sm transition-colors',
          'disabled:opacity-50 disabled:pointer-events-none',
        )}
        aria-label={t('form.fullscreen.toggle', {
          label: label ?? t('form.fullscreen.textFallback'),
        })}
        data-testid={`${testIdPrefix}-fullscreen-toggle`}
      >
        <Maximize2 className="size-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={`sm:max-w-3xl ${DIALOG_VIEWPORT_GUTTER} h-[100dvh] sm:h-[80vh] max-h-[100dvh] sm:max-h-[80vh] flex flex-col p-0 gap-0`}
          data-testid={`${testIdPrefix}-fullscreen-dialog`}
        >
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="text-base">
              {/*
                The id sits on this span, not on `<DialogTitle>`: Radix renders
                `<h2 id={context.titleId} {...titleProps}>`, so an `id` prop
                would REPLACE the id `DialogContent`'s `aria-labelledby` names
                and leave the dialog itself unnamed. The span carries the same
                visible text, so the control's name and the dialog's name are
                one string with one author.
              */}
              <span id={titleTextId}>{label ?? t('form.fullscreen.title')}</span>
            </DialogTitle>
            {/*
              Without this line Radix reports no `descriptionPresent` and omits
              `aria-describedby` altogether, so the dialog would have no
              accessible description. (The missing-Description console warning
              older Radix versions emitted is NOT why: @radix-ui/react-dialog
              1.1.23 contains no `console.*` call at all.)
            */}
            <DialogDescription className="sr-only">
              {t('form.fullscreen.description')}
            </DialogDescription>
            {error ? (
              /*
                The dialog-local error node. Rendered only while the dialog is
                open (Radix unmounts the content when it closes), which is
                exactly the window in which the host's own `<FormMessage>` is
                `aria-hidden` behind the modal — so the accessibility tree holds
                one copy of this text, never two (the 2026-08-16 restatement of
                objectui#3222).

                Same classes as `<FormMessage>` so the two readings of the same
                failure look alike; the text itself is the host's, never
                re-worded here.
              */
              <p
                id={errorId}
                className="text-sm font-medium text-destructive"
                data-testid={`${testIdPrefix}-fullscreen-error`}
              >
                {error}
              </p>
            ) : null}
          </DialogHeader>
          <div className="flex-1 min-h-0 p-4">
            {children(draft, setDraft, disabled, editorAria)}
          </div>
          <DialogFooter className="p-3 border-t flex-row justify-between sm:justify-end gap-2">
            {footer?.(draft)}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="ghost" onClick={cancelFullscreen}>
                <X className="size-4 mr-1" /> {t('common.cancel')}
              </Button>
              <Button
                type="button"
                onClick={commitFullscreen}
                disabled={disabled}
                data-testid={`${testIdPrefix}-fullscreen-save`}
              >
                <Check className="size-4 mr-1" /> {t('form.fullscreen.done')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
