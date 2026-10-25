import React, { useId } from 'react';
import type { TextareaFieldMetadata } from '@object-ui/types';
import { Textarea, EmptyValue, CharacterCount } from '@object-ui/components';
import { FullscreenFieldEditor } from './FullscreenFieldEditor.js';
import { FieldWidgetComponentProps } from './types.js';
import type { LongTextCarrierHandoff } from './longTextCarrierHandoff.js';
import { toDomProps } from './toDomProps.js';

/**
 * TextAreaField - Multi-line text input widget
 * Supports configurable row count and preserves whitespace in readonly mode.
 *
 * Mobile UX (round 3): when the FIELD METADATA carries `mobile_fullscreen:
 * true`, an "expand" affordance opens a fullscreen edit dialog — much easier
 * on phones than tapping a 4-row textarea trapped between other fields.
 *
 * That flag has exactly one producer: `ObjectForm` stamps it onto every
 * long-text field when `ObjectFormSchema.mobile.fullscreenLongText` is set
 * (`plugin-form/src/ObjectForm.tsx`). It reaches this widget on `field` — the
 * single metadata carrier since objectui#3233. A `SchemaRenderer`-hosted node
 * arrives there too: the registry adapter (`withFieldCarrier`) maps the SDUI
 * `schema` node onto `field` before the widget sees it.
 *
 * The affordance, the dialog and the draft/commit semantics live in the shared
 * `FullscreenFieldEditor` — the same producer stamps the same flag on
 * rich-text fields, and `RichTextField` renders it from there too
 * (objectui#3301). Only the EDITOR differs per widget; here it is a
 * full-height `Textarea`.
 *
 * There is deliberately NO widget-prop override. A `mobileFullscreen`
 * (camelCase) prop was read here and written by nobody in the repo, and the
 * snake_case `mobile_fullscreen` prop cannot arrive either: the form renderer
 * strips both `mobile_fullscreen` and `fullscreen` from the props it forwards
 * to registered widgets (`stripRegisteredFieldProps` in
 * `components/src/renderers/form/form.tsx`). Reading keys nobody produces
 * documented a contract that never held and invited the next author to pass a
 * silently-ignored prop, so the reads are gone (objectui#3232). If a host
 * override is ever genuinely needed, declare ONE key on
 * `FieldWidgetComponentProps`, stop stripping it, and have a host pass it.
 *
 * ## The character counter (objectui#3408, shared across surfaces in #3417)
 *
 * Both editing surfaces below — the inline `<Textarea>` and the fullscreen
 * dialog's — render the SAME `CharacterCount`. It lives in
 * `@object-ui/components` since objectui#3439, hoisted there so the form
 * renderer's built-in `textarea` branch renders that very component too rather
 * than growing a third copy; this widget's use of it is unchanged. It owns the
 * three-node
 * GOV.UK shape (decorative digits / accessible description / gated status
 * region) and the debounce and threshold behind it. Until #3417 the fullscreen
 * footer had its own hand-written copy that was digits and nothing else, which
 * is what a second copy of a UI always costs: it drifts, and nothing reports
 * the drift.
 *
 * This widget's remaining job is the part only it can do — mint the two
 * description ids and name each one in the `aria-describedby` of the control
 * it describes. The surfaces differ in exactly one behaviour, and it is
 * declared rather than implied: `announceNearLimit`. Inline announces
 * (unchanged since #3408); the fullscreen dialog does not.
 */

export function TextAreaField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  // `useId` sits above the `readonly` early return because a hook may not sit
  // behind a conditional return: the readonly branch renders no counter, so
  // the ids go unused there, but moving the call down would desync hook order
  // the moment a field toggles readonly. `maxLength` is derived here for the
  // same reason the ids are — proximity to the hook, not because the readonly
  // branch wants it.
  // The declared metadata face — every authored key this widget reads off the
  // carrier (`rows`, `maxLength`, `placeholder`, `label`) is a
  // `TextareaFieldMetadata` member, so the reads below are compiler-checked
  // (objectui#6140's de-cast sweep; the sibling `RichTextField` got the same
  // treatment when its types gained `rows`). `mobile_fullscreen` is the one
  // host-written key, typed on `LongTextCarrierHandoff` since objectui#12242.
  const textareaField = field as TextareaFieldMetadata & LongTextCarrierHandoff;
  // The spec's `maxLength` (`FieldSchema.maxLength`, which
  // `TextareaFieldMetadata` declares by reference) is the one spelling read:
  // it gives the textarea its native stop and the counter its ceiling. The
  // snake_case `max_length` this widget also read until objectui#11070 is
  // retired — the spec refuses it by name, and no reader reads it.
  const maxLength = textareaField?.maxLength;

  /**
   * Two description ids off one `useId()` — one per editing surface.
   *
   * They cannot be a single id. The dialog edits a LOCAL draft (see
   * `FullscreenFieldEditor`), so the moment the user types in it the two
   * surfaces are counting different strings; one shared id would point both
   * textareas at whichever sentence rendered last. Both derive from the widget
   * instance, so two textareas on one form never collide either.
   */
  const instanceId = useId();
  const descriptionId = `${instanceId}-charcount`;
  const fullscreenDescriptionId = `${instanceId}-fullscreen-charcount`;

  if (readonly) {
    return (
      <div className="text-sm whitespace-pre-wrap">
        {value || <EmptyValue />}
      </div>
    );
  }

  const rows = textareaField?.rows || 4;
  // Mobile fullscreen opt-in travels on the field metadata and nowhere else.
  // That metadata has exactly one carrier (`field`, objectui#3233), so this is
  // a single read — a misspelled flag has no read path to quietly catch it.
  const showFullscreenButton = Boolean(textareaField?.mobile_fullscreen);

  const domProps = toDomProps(props);
  // Resolved once and given to BOTH editing surfaces (objectui#3402). It used
  // to reach the inline `<Textarea>` alone, so a disabled field greyed out
  // correctly while its expand button stayed live and the dialog wrote the edit
  // straight back through `onCommit`. `disabled` also carries the form's
  // `isSubmitting`, so that hole was open for the duration of every submit.
  const disabled = Boolean(domProps.disabled);

  // APPENDED, never assigned (objectui#3408). `<FormControl>` is a Radix Slot
  // and already hands the control an `aria-describedby` naming the field's
  // description and error message; it arrives here through `toDomProps`'
  // `aria-*` pass-through. Overwriting it would trade "no cap announced" for
  // "no error announced" — a strictly worse bug, and a silent one.
  const describedBy =
    [domProps['aria-describedby'], maxLength ? descriptionId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="relative">
      <Textarea
        {...domProps}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={textareaField?.placeholder}
        disabled={readonly || disabled}
        rows={rows}
        maxLength={maxLength}
        aria-invalid={!!error}
        // After the spread so the composed value wins over the raw host one.
        aria-describedby={describedBy}
        className={domProps.className}
      />
      {maxLength && (
        /*
          The INLINE surface's counter. `announceNearLimit` because this is the
          surface the user types into with the rest of the form around them —
          the near-limit warning is the one thing worth interrupting for, and
          it is threshold-gated and debounced so it interrupts about five times
          over a run that fills a 500-character cap rather than 52.
        */
        <CharacterCount
          length={(value || '').length}
          maxLength={maxLength}
          descriptionId={descriptionId}
          announceNearLimit
          className="absolute bottom-2 right-2 text-xs text-gray-400"
          testId="textarea-character-count"
        />
      )}

      {showFullscreenButton && (
        <FullscreenFieldEditor
          value={value ?? ''}
          onCommit={onChange}
          label={textareaField?.label}
          testIdPrefix="textarea"
          disabled={disabled}
          /*
            The same `error` the inline control turns into `aria-invalid`
            (objectui#3222), handed to the dialog so its control can say the
            same thing (objectui#4824). Before this the dialog's textarea
            carried no `aria-invalid` at all: the field was invalid, the inline
            control said so, and the surface the user was actually typing into
            said nothing. The primitive — not this widget — decides what the
            dialog does with it, so both long-text widgets and the built-in
            branch cannot answer it three different ways again.
          */
          error={error}
          /*
            The FULLSCREEN surface's counter (objectui#3417). This slot used to
            render a bare `{n}/{max}` span: no accessible name, no association
            with the dialog's textarea, nothing `aria-live`. A screen reader
            heard "5 slash 500" if browse mode happened to sweep it and not one
            word while the input had focus — the same field, the same cap, and
            the inline surface three nodes richer since objectui#3408.

            `announceNearLimit={false}` is the ruling on #3417, and it is a
            choice about this SURFACE rather than a saving on effort: a
            fullscreen modal is opened deliberately to write at length, the
            description below already delivers the cap on focus, and the
            dialog's textarea carries the same native `maxLength` stop. Adding
            a second live region inside a modal would also put two of them in
            one document, since the inline one stays mounted behind the overlay.
          */
          footer={(draft) =>
            maxLength ? (
              <CharacterCount
                length={draft.length}
                maxLength={maxLength}
                descriptionId={fullscreenDescriptionId}
                announceNearLimit={false}
                className="text-xs text-muted-foreground self-center"
                testId="textarea-fullscreen-character-count"
              />
            ) : null
          }
        >
          {(draft, setDraft, editorDisabled, editorAria) => (
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={editorDisabled}
              maxLength={maxLength}
              placeholder={textareaField?.placeholder}
              /*
                Name + validation state, computed by `FullscreenFieldEditor` and
                spread whole (objectui#4824 / #4832). Spread rather than
                unpacked: this widget is not told which ids it names, so it
                cannot name a node outside the dialog — the ⛔ shortcut of
                pointing at the host's `<FormMessage>`, which Radix
                `aria-hidden`s for the entire time the dialog is open.

                It carries no `aria-describedby`, so it composes with — rather
                than overwrites — the character-count description assigned
                below.
              */
              {...editorAria}
              /*
                Assigned, not appended — and that is a statement about THIS
                element, not a relaxation of the rule above. The inline control
                composes because `<FormControl>` hands it an `aria-describedby`
                through `domProps`; this one is constructed here from scratch,
                `domProps` never reaches it, and the ids the host would have
                supplied name nodes OUTSIDE the dialog, which Radix `aria-hidden`s
                while the modal is open. There is nothing to preserve. Should
                this editor ever be given host-supplied ids, compose them the
                way `describedBy` above does rather than adding a second
                assignment.
              */
              aria-describedby={maxLength ? fullscreenDescriptionId : undefined}
              className="h-full min-h-full resize-none text-base"
              data-testid="textarea-fullscreen-input"
            />
          )}
        </FullscreenFieldEditor>
      )}
    </div>
  );
}
