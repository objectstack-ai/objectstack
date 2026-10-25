import React, { useId } from 'react';
import type { HtmlFieldMetadata, MarkdownFieldMetadata } from '@object-ui/types';
import { cn, Textarea, EmptyValue, CharacterCount, type FullscreenEditorAria } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/react';
import { FullscreenFieldEditor } from './FullscreenFieldEditor.js';
import { FieldWidgetComponentProps } from './types.js';
import type { LongTextCarrierHandoff } from './longTextCarrierHandoff.js';
import { toDomProps, type FieldDomProps } from './toDomProps.js';
import { richTextCellRenderer } from './richTextDisplay.js';

/**
 * The rich-text editing surface, rendered by `RichTextField` in BOTH positions:
 * inline in the form, and inside the fullscreen dialog.
 *
 * Sharing it is the point of objectui#3301's acceptance criterion "the dialog
 * holds the real editor". Had the dialog inlined a bare `<Textarea>` instead,
 * the two surfaces would already disagree (no placeholder, no native
 * `maxLength` stop) and would keep disagreeing every time this widget gains an
 * affordance — whatever the editor grows into (a toolbar, a TipTap/Lexical
 * instance, a preview toggle), both positions get it at once because there is
 * only one of them.
 *
 * `fullHeight` is the only difference between the two renderings: inline the
 * textarea is `rows`-sized, in the dialog it fills the available height.
 *
 * The `<Textarea>` below is this widget's ONE focusable control, so it is where
 * the host's DOM pass-through has to land (objectui#4810) — see `domProps`.
 *
 * It draws no header row. It used to, on every surface: "Format: markdown" and
 * "Rich text editor (basic)" above the textarea, which an anonymous visitor on
 * a public form read as editor chrome (objectui#12110, ruled B). Authored
 * guidance reaches the person through the field's own help text and
 * `placeholder`; the widget has no page to tell apart, so the lines went
 * everywhere rather than behind a per-surface switch.
 */
function RichTextEditorSurface({
  value,
  onChange,
  placeholder,
  rows,
  disabled,
  error,
  className,
  fullHeight,
  autoFocus,
  textareaTestId,
  overlay,
  counter,
  maxLength,
  describedBy,
  domProps,
  editorAria,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  error?: string;
  className?: string;
  fullHeight?: boolean;
  autoFocus?: boolean;
  textareaTestId?: string;
  /** Absolutely-positioned children over the textarea (the expand affordance). */
  overlay?: React.ReactNode;
  /**
   * The character counter for THIS surface, already constructed by the caller.
   *
   * Passed in rather than built here because the two surfaces differ in
   * exactly one declared behaviour (`announceNearLimit`), and the difference
   * belongs at the one place that
   * knows which surface it is rendering. Positioned inside the `relative`
   * wrapper below, over the textarea, exactly like {@link overlay}.
   */
  counter?: React.ReactNode;
  /**
   * The authored ceiling, forwarded to the `<Textarea>` as the native
   * `maxLength` stop (objectui#8438).
   *
   * ⚠️ It is NOT reachable through {@link domProps}: `maxLength` is not on the
   * `toDomProps` whitelist, and this widget read the key nowhere else — so
   * before objectui#8438 a ceiling authored on ANY of the three registry keys
   * this widget serves reached no element at all, while the sibling
   * `TextAreaField` had honoured it since framework#1878 §3.
   */
  maxLength?: number;
  /**
   * The composed `aria-describedby` for this surface's textarea.
   *
   * Composed by the CALLER and assigned after the `domProps` spread, because
   * the two surfaces compose it from different sources: the inline one appends
   * the counter's description id to the ids `<FormControl>` handed down, and
   * the dialog's names only its own — the host's ids sit outside the modal,
   * which Radix `aria-hidden`s while it is open.
   */
  describedBy?: string;
  /**
   * The host's DOM pass-through (objectui#4810), already filtered through the
   * `toDomProps` whitelist by the caller — the field's `id`, the
   * `aria-describedby` `<FormControl>`'s Slot minted, `name`, `tabIndex`, the
   * focus handlers.
   *
   * Given to the INLINE surface only, and that is a statement about the dialog
   * rather than an omission: the host id is unique per form item, so handing it
   * to a second `<Textarea>` mounted at the same time would put two elements
   * under one id and make the visible label's `for` ambiguous, and the ids the
   * host's `aria-describedby` names sit OUTSIDE the dialog, which Radix
   * `aria-hidden`s while the modal is open. Exactly the split `TextAreaField`
   * makes for the same pair of surfaces.
   */
  domProps?: FieldDomProps<FieldWidgetComponentProps<string>>;
  /**
   * The accessibility set `FullscreenFieldEditor` computes for the control it
   * hosts — accessible name and validation state (objectui#4824 / #4832).
   *
   * The mirror image of `domProps`: given to the DIALOG rendering only, because
   * only the dialog rendering has a name and a message node to be pointed at
   * from inside the modal. The inline surface takes both from the host, through
   * `domProps` and its own `error`.
   *
   * It is the dialog copy's SINGLE author of `aria-invalid`, which is why the
   * dialog rendering below passes no `error`: this surface used to compute
   * `aria-invalid={!!error}` from an `error` prop the dialog rendering never
   * received, so it announced a literal `aria-invalid="false"` for a field the
   * inline surface was announcing `true` for at the same moment — the sharper
   * half of objectui#4824.
   */
  editorAria?: FullscreenEditorAria;
}) {
  return (
    <div className={cn(fullHeight && 'flex flex-col h-full')}>
      <div className={cn('relative', fullHeight && 'flex-1 min-h-0')}>
        <Textarea
          // BEFORE the spread, both of them, so a host that supplies either key
          // wins and one that supplies neither still gets this surface's own
          // value. After the spread they would be re-assigned `undefined` on
          // the inline surface — which is how a pass-through silently drops a
          // key it was handed.
          autoFocus={autoFocus}
          data-testid={textareaTestId}
          {...domProps}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={fullHeight ? undefined : rows}
          maxLength={maxLength}
          // `text-base` in the dialog for the same reason `TextAreaField` uses
          // it there: sub-16px inputs make iOS Safari zoom on focus, which is
          // exactly wrong for a surface the user opened to get more room.
          //
          // After the spread because it COMPOSES the host's `className` (which
          // reaches this component as the `className` prop) with the surface's
          // own classes, rather than letting the raw host value replace them.
          className={cn(
            'font-mono',
            fullHeight ? 'text-base h-full min-h-full resize-none' : 'text-sm',
            className,
          )}
          // After the spread, deliberately: `toDomProps` forwards the whole
          // `aria-` family, so `<FormControl>`'s own `aria-invalid` arrives in
          // `domProps` too. This widget reading `error` itself is one of
          // objectui#3318's 17 PASS entries — keeping the read last is what
          // keeps that entry passing instead of handing the state back to a
          // host that may not have one.
          aria-invalid={!!error}
          // After the spread so the COMPOSED value wins over the raw
          // `aria-describedby` `toDomProps` forwarded — appended, never
          // assigned, on the inline surface (see `describedBy`'s caller).
          // Overwriting the host's ids would trade "no cap announced" for "no
          // error announced", which is strictly worse and silent.
          aria-describedby={describedBy}
          // LAST, and only ever non-empty on the dialog rendering: inside the
          // modal the primitive is the authority on both the name and the
          // validation state, and its `aria-invalid` must win over the `!!error`
          // above (which is the INLINE channel and is `false` there by
          // construction). On the inline surface this spreads nothing.
          {...editorAria}
        />
        {counter}
        {overlay}
      </div>
    </div>
  );
}

/**
 * THE discriminator for the three registry keys this ONE widget serves —
 * `markdown`, `html` and `richtext` (`4bb940b6e`).
 *
 * It is `field.type`, and establishing that was the load-bearing half of the
 * card, because the obvious candidate is wrong in a way that fails silently:
 *
 *  - `field.format` is NOT a discriminator. It is declared on `date`,
 *    `datetime`, `time`, `phone` and `auto_number` and on no rich-content
 *    type, so `richField?.format` read `undefined` for every real field and
 *    the old `|| 'markdown'` tail answered `markdown` for all three. Branching
 *    on it would have routed `html` and `richtext` — whose values are entirely
 *    HTML — through the markdown pipeline, which drops raw HTML and renders a
 *    populated value as NOTHING (the objectui#5452 failure, reintroduced on the
 *    form). The editor header that once labelled an `html` field "Format:
 *    markdown" was the same phantom read, made visible (that header is gone
 *    since objectui#12110).
 *  - the RESOLVED WIDGET KEY (`widget || field.widget || type`, the form
 *    renderer's `resolveWidgetType`) is not visible from inside a widget, and
 *    keying off it would be wrong anyway: every other read surface dispatches
 *    `getCellRenderer` on the field TYPE, so `type` is what keeps this form
 *    branch agreeing with the grid, the detail page and the rest.
 *
 * The `field:` prefix is stripped for the same reason the form renderer's own
 * `normalizeFieldType` strips it: the object-schema path emits the prefixed id
 * and hand-written form schemas the bare one, and they name the same kind.
 *
 * A type with no entry in {@link richTextCellRenderer} — a foreign type
 * force-routed here by a `widget:` override, or a host that passed no metadata
 * at all — is answered by the caller as PLAIN TEXT, which is what
 * `getCellRenderer` answers for it too. Not by a guessed rich-content default.
 */
function resolveRichTextFieldType(field: unknown): string {
  const raw = (field as { type?: unknown } | null | undefined)?.type;
  const type = typeof raw === 'string' ? raw : '';
  return type.startsWith('field:') ? type.slice('field:'.length) : type;
}

/**
 * Rich text field with markdown/HTML support
 * For now, this is a simple textarea. A full implementation would use
 * a rich text editor like TipTap, Lexical, or Slate.
 *
 * Reached by forms as `field:markdown` and `field:html`; both resolve here.
 *
 * ## Fullscreen editing (objectui#3301)
 *
 * `ObjectForm` stamps `mobile_fullscreen` onto the metadata of every long-text
 * field — textarea AND rich-text — when `ObjectFormSchema.mobile
 * .fullscreenLongText` is set, and `ObjectFormSchema.mobile`'s own JSDoc has
 * always promised "textarea/rich-text get an expand button". This widget never
 * read the flag, so for `field:markdown` / `field:html` that promise did
 * nothing at all: the producer stamped, and no consumer existed.
 *
 * The flag is read off `field` and nowhere else — the single metadata carrier
 * since objectui#3233 — matching `TextAreaField` read for read, so a
 * misspelled flag stays inert in both widgets rather than being caught by a
 * tolerant fallback in one of them. The affordance and dialog themselves come
 * from the shared `FullscreenFieldEditor`, so one form-level setting keeps
 * producing one behaviour across both widgets.
 *
 * ## Readonly display (`4bb940b6e`)
 *
 * The readonly early return used to render `{value}` as a React TEXT CHILD,
 * so a readonly field of any of the three types showed the user the markup
 * SOURCE of their own content — a `markdown` field's asterisks and hashes, a
 * `richtext` field's tags. The `prose` classes on that wrapper were the tell:
 * they exist to style RENDERED rich content and there was none to style. Every
 * other read surface — grid, kanban card, gallery, related list, dashboard
 * record panel, record detail read mode — dispatches through `getCellRenderer`
 * and renders the same stored bytes FORMATTED, so one field disagreed with
 * itself depending on which surface it was read on, and this branch was the
 * one disagreeing with the platform.
 *
 * It now renders through {@link richTextCellRenderer} — literally the same
 * components `getCellRenderer` resolves, one table shared by both (see
 * `./richTextDisplay.tsx`), so the html/richtext path carries that renderer's
 * sanitizing trust boundary rather than a second hand-rolled escape, and a
 * future change to either pipeline moves both surfaces at once.
 *
 * ## Host plumbing (objectui#4810)
 *
 * The editable branch had no `toDomProps` at all, so everything
 * `<FormControl>`'s Radix `Slot` hands down — the field's `id`, the
 * `aria-describedby` naming its `<FormDescription>` and `<FormMessage>` —
 * arrived as props and landed on no element. Measured on a real form: the
 * visible label's `for` pointed at an id nothing carried (`for=DANGLING`) and
 * the rendered description had zero consumers, for all three registry keys
 * (`markdown` / `html` / `richtext`) since they are this one widget.
 *
 * The fix is objectui#3318's standing recipe — `toDomProps(props)` spread onto
 * the REAL focusable control, which here is the `<Textarea>` inside
 * `RichTextEditorSurface`, never the wrapper `<div>`s (a non-focusable wrapper
 * carrying the id would satisfy `document.getElementById` and still leave the
 * label inert). Only the inline surface receives it; see `domProps` there for
 * why the dialog's copy must not.
 */
export function RichTextField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  const { t } = useObjectTranslation();

  /**
   * Two description ids off one `useId()` — one per editing surface, minted
   * ABOVE the readonly early return because a hook may not sit behind a
   * conditional return. The readonly branch renders no counter, so they go
   * unused there; moving the call down would desync hook order the moment a
   * field toggles readonly. Identical to `TextAreaField`, and for the same
   * reason: the dialog edits a LOCAL draft, so the moment the user types in it
   * the two surfaces are counting different strings and one shared id would
   * point both textareas at whichever sentence rendered last.
   */
  const instanceId = useId();
  const descriptionId = `${instanceId}-charcount`;
  const fullscreenDescriptionId = `${instanceId}-fullscreen-charcount`;

  if (readonly) {
    // The type is the display's pipeline key (`4bb940b6e`), and the readonly
    // display is its only reader: the editable surface names no syntax since
    // its format header went (objectui#12110).
    const fieldType = resolveRichTextFieldType(field);
    const Display = richTextCellRenderer(fieldType);
    // Not a rich-content type: nothing to render as markup, and `prose` would
    // be styling content that does not exist. Plain text is also what every
    // other read surface shows for it, which is the invariant this branch is
    // being aligned to.
    if (!Display) {
      return <div className="text-sm whitespace-pre-wrap break-words">{value || <EmptyValue />}</div>;
    }
    // The `react-hooks/static-components` disable at the bottom of this block is
    // MEASURED, not waved through. `Display` is one of two MODULE-SCOPE function
    // declarations,
    // looked up out of the module-scope `RICH_TEXT_CELL_RENDERERS` table by field
    // type; `richTextCellRenderer` is a pure index with no allocation, so the
    // reference is `===` across renders and nothing is created during render.
    // Identity moves only when `fieldType` moves, and remounting THEN is correct:
    // a different type is a different pipeline. The rule cannot see through the
    // table lookup — the same dispatch lints clean in `DetailSection` only
    // because it sits inside an IIFE there — and this repo already carries the
    // same scoped disable for the same shape (`NotificationAlerts`/
    // `NotificationSnackbar`'s module-cached icon lookup, `page.tsx`'s template
    // registry).
    //
    // What would INVALIDATE this and make the rule right: constructing the
    // component on the way to this JSX — a `(props) => <X …/>` wrapper, a
    // `React.memo(…)`/`useMemo` computed here, anything closing over render
    // state. That is objectui#5348's remount class, which shipped three times
    // because this rule family bails out silently on large components. So the
    // claim is not left to this comment: `readonly-richtext-display-5498.test
    // .tsx` pins both halves of it — the lookup's reference identity, and the
    // rendered DOM node surviving a re-render.
    // eslint-disable-next-line react-hooks/static-components -- see above
    return <Display value={value} field={field} />;
  }

  // The declared metadata face for this widget's registry keys. All three of
  // them have an exported type: `markdown` and `html` always did, and the third
  // key, `richtext`, gained `RichtextFieldMetadata` in objectui#7083 — which is
  // what retired the deliberate `as unknown as MarkdownFieldMetadata` its pin
  // test needed for as long as the union had no branch to write it against.
  // The cast below names two of the three because it does not have to
  // discriminate: every authored key this widget consumes (`rows`,
  // `maxLength`, `placeholder`, `label`) is DECLARED on all three, so the two
  // named already admit every read below — `rows` since the objectui#6140 Option A ruling
  // (which is what retired the `as any` that used to launder this carrier).
  // `mobile_fullscreen` is the one host-written key, typed on
  // `LongTextCarrierHandoff` since objectui#12242.
  const richField = field as (MarkdownFieldMetadata | HtmlFieldMetadata) & LongTextCarrierHandoff;
  const rows = richField?.rows || 8;
  /**
   * The authored ceiling — the spec's `maxLength`, the same single read
   * `TextAreaField` makes. It is declared on all three of this widget's
   * metadata faces (`MarkdownFieldMetadata`, `HtmlFieldMetadata`,
   * `RichtextFieldMetadata`) by reference to `FieldSchema.maxLength`, so the
   * cast above already admits it. The snake_case `max_length` this widget also
   * read until objectui#11070 is retired: the spec refuses it by name, and no
   * reader reads it.
   *
   * ## Why this read did not exist until objectui#8438
   *
   * It was believed to be somebody else's job, in two places that measurement
   * says were never doing it:
   *
   *  - `ObjectForm` sets `formField.maxLength` for a hand-written list of
   *    types. For an object-schema-derived field that assignment lands on the
   *    FORM FIELD, while the metadata carrier registered widgets read is
   *    `formField.field` — a different object — so no registered widget has
   *    ever seen it. Ablating the assignment entirely changes no rendered
   *    attribute on either the registered or the builtin path.
   *  - `EmbeddableForm`'s `DEFAULT_MAX_LENGTH` caps `markdown` and `html` at
   *    5000. There the form field IS the carrier, so the value did arrive —
   *    and then died here, unread.
   *
   * ⇒ The cap was invisible for ALL THREE registry keys, not just `richtext`:
   * no native stop, no counter, and nothing named in `aria-describedby`, while
   * `buildValidationRules` (which has no field-type gate) rejected the same
   * text at SUBMIT. That is the worst ordering of the three possible ones —
   * the person is told after writing — and it is what this read ends.
   */
  const maxLength = richField?.maxLength;
  // Same single read as `TextAreaField`: the field metadata is the only
  // carrier, and this widget is the second consumer the flag always had.
  const showFullscreenButton = Boolean(richField?.mobile_fullscreen);

  // The host plumbing, filtered by the declared whitelist (objectui#3291) so
  // renderer-only props and authored field-config keys cannot become DOM
  // attributes. Read the semantic props below off it rather than off `props`
  // for the same reason `TextAreaField` does: one source, no chance of the
  // spread and the read disagreeing.
  const domProps = toDomProps(props);
  // Resolved once and given to BOTH renderings of the editor (objectui#3402) —
  // exactly like `placeholder` below, and for the same reason. Landing it on
  // the inline surface alone left a disabled rich-text field greyed out next
  // to a live expand button whose dialog committed any edit through
  // `onCommit`. `disabled` also carries the form's `isSubmitting`.
  const disabled = Boolean(domProps.disabled);

  /**
   * APPENDED, never assigned. `<FormControl>` is a Radix Slot and has already
   * handed this control an `aria-describedby` naming the field's description
   * and error message; it arrives through `toDomProps`' `aria-*` pass-through.
   * Overwriting it would trade "no cap announced" for "no error announced".
   */
  const describedBy =
    [domProps['aria-describedby'], maxLength ? descriptionId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  // Resolved once and handed to BOTH renderings of the editor, so the dialog
  // cannot drift into showing different copy than the inline surface.
  const placeholder =
    richField?.placeholder ||
    t('fields.richText.placeholder', { defaultValue: 'Enter text…' });

  return (
    <RichTextEditorSurface
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      disabled={readonly || disabled}
      error={error}
      className={domProps.className}
      maxLength={maxLength}
      describedBy={describedBy}
      domProps={domProps}
      counter={
        maxLength ? (
          /*
            The INLINE surface's counter — `announceNearLimit`, exactly as
            `TextAreaField`'s is: this is the surface the user types into with
            the rest of the form around them, so the near-limit warning is the
            one thing worth interrupting for, and `CharacterCount` gates and
            debounces it.
          */
          <CharacterCount
            length={(value || '').length}
            maxLength={maxLength}
            descriptionId={descriptionId}
            announceNearLimit
            className="absolute bottom-2 right-2 text-xs text-gray-400"
            testId="richtext-character-count"
          />
        ) : null
      }
      overlay={
        showFullscreenButton && (
          <FullscreenFieldEditor
            value={value ?? ''}
            onCommit={onChange}
            label={richField?.label}
            testIdPrefix="richtext"
            disabled={disabled}
            /*
              The validation channel the dialog rendering never had
              (objectui#4824). It is handed to the PRIMITIVE, not down to the
              second `RichTextEditorSurface`, because the primitive is what
              renders the message node the control points at — a node that must
              live inside the modal, since the host's `<FormMessage>` is
              `aria-hidden` for as long as this dialog is open.
            */
            error={error}
            /*
              The FULLSCREEN surface's counter, with `announceNearLimit={false}`
              — objectui#3417's ruling, adopted here unchanged rather than
              re-decided: a fullscreen modal is opened deliberately to write at
              length, the description already delivers the cap on focus, and
              the dialog's textarea carries the same native stop. A second live
              region would also put two of them in one document, since the
              inline surface stays mounted behind the overlay.
            */
            footer={(draft) =>
              maxLength ? (
                <CharacterCount
                  length={draft.length}
                  maxLength={maxLength}
                  descriptionId={fullscreenDescriptionId}
                  announceNearLimit={false}
                  className="text-xs text-muted-foreground self-center"
                  testId="richtext-fullscreen-character-count"
                />
              ) : null
            }
          >
            {(draft, setDraft, editorDisabled, editorAria) => (
              <RichTextEditorSurface
                value={draft}
                onChange={setDraft}
                placeholder={placeholder}
                disabled={editorDisabled}
                autoFocus
                fullHeight
                maxLength={maxLength}
                /*
                  ASSIGNED here, not appended — and that is a statement about
                  this element rather than a relaxation of the inline rule.
                  `domProps` never reaches the dialog copy (see `domProps`), and
                  the ids the host would have supplied name nodes OUTSIDE the
                  modal, which Radix `aria-hidden`s while it is open. There is
                  nothing to preserve.
                */
                describedBy={maxLength ? fullscreenDescriptionId : undefined}
                textareaTestId="richtext-fullscreen-input"
                editorAria={editorAria}
              />
            )}
          </FullscreenFieldEditor>
        )
      }
    />
  );
}
