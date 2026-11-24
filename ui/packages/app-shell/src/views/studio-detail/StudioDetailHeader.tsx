// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioDetailHeader — the one header of every full-screen Studio detail
 * (objectstack#36892, epic objectstack#36890).
 *
 * A thin composition of `StudioItemHeader`'s slots, nothing more: × (back to
 * the list) in `leading`; the type and the source package as identity chips
 * after the label and the api name; the status as the header's status chip;
 * then, in `actions`, ‹ › with "index / total", the page's primary button and
 * a ⋯ menu. Every width rule is `StudioItemHeader`'s own: the identity chips
 * fold into the ⋯ menu first, then labelled actions (the position text here)
 * show without their label, and the title truncates last. This file adds no
 * measurement of its own.
 *
 * Settled by the epic: no switcher dropdown and no "open in app" button — to
 * change item the user closes back to the list, steps with ‹ ›, or uses ⌘K.
 *
 * ‹ › take the current list's names in order and the current name
 * ({@link detailSequence}); the page supplies the order (the list's filter
 * and sort carried in the detail address, or by name without a list).
 *
 * × and ‹ › leave the page, so each goes through the leave guard
 * (`confirmUnsavedLeave`): a page holding unsaved edits asks first. Browser
 * Back is not intercepted, the platform's convention under `BrowserRouter`
 * (`chrome/unsavedEdits.ts` says why).
 *
 * Esc triggers × unless something else answered it first: an open menu or
 * dialog dismisses on Esc and marks the event handled, and a key aimed at a
 * text field is left to the field.
 */

import * as React from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal, Package, X } from 'lucide-react';
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@object-ui/components';
import {
  StudioItemHeader,
  StudioItemHeaderFoldedItems,
  type StudioItemStatus,
} from '../studio-design/StudioItemHeader.js';
import { STUDIO_FOLD_LABEL, STUDIO_HEADER_ICON_BUTTON, STUDIO_KIND_CHIP } from '../studio-design/studio-tokens.js';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits.js';
import { t, tFormat } from '../metadata-admin/i18n.js';

/** Where the current item sits in the list ‹ › step through. */
export interface DetailSequence {
  /** 1-based position of the current name; `null` when the list does not hold it. */
  index: number | null;
  /** How many names the list holds. */
  total: number;
  /** The name ‹ opens; `null` on the first item or outside the list. */
  previous: string | null;
  /** The name › opens; `null` on the last item or outside the list. */
  next: string | null;
}

/**
 * The position of `current` in `names` and its neighbours. The ends do not
 * wrap: ‹ is off on the first item and › on the last. A name the list does
 * not hold (an item filtered out since, a direct address) has no position and
 * no neighbours.
 */
export function detailSequence(names: readonly string[], current: string): DetailSequence {
  const at = names.indexOf(current);
  if (at < 0) return { index: null, total: names.length, previous: null, next: null };
  return {
    index: at + 1,
    total: names.length,
    previous: at > 0 ? names[at - 1] : null,
    next: at < names.length - 1 ? names[at + 1] : null,
  };
}

/** A keydown aimed at something the user types into, which keeps its own Esc. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null;
}

export interface StudioDetailHeaderProps {
  /** The display locale for the header's own strings. */
  locale: string;
  /** The item type's icon. */
  icon?: React.ElementType;
  /** Set for an object: its tile in the object's palette colour (`StudioItemHeader.objectTile`). */
  objectTile?: { color?: string };
  /** The item's label. */
  label: React.ReactNode;
  /** The item's machine name. */
  apiName?: string;
  /** The item type, already translated ("Object", "Flow"). */
  typeLabel?: string;
  /** The package the item comes from, as its label. */
  packageLabel?: string;
  /** The item's status chip. */
  status?: StudioItemStatus;
  /** Muted meta text after the status. */
  meta?: React.ReactNode;
  /**
   * The list ‹ › step through: its names in order, and the current one.
   * Absent: no ‹ ›.
   */
  sequence?: { names: readonly string[]; current: string };
  /** Opens another item of the list (‹ ›), once the leave guard lets it. */
  onOpenItem?: (name: string) => void;
  /** Back to the list (× and Esc), once the leave guard lets it. */
  onClose: () => void;
  /** Esc triggers ×; on by default. */
  closeOnEscape?: boolean;
  /**
   * The page's primary button. A labelled button marks its label
   * `data-studio-fold-label` with `STUDIO_FOLD_LABEL`, so a narrow row shows
   * its icon alone, as the header's other labelled actions do.
   */
  primaryAction?: React.ReactNode;
  /** The ⋯ menu's own items (`DropdownMenuItem`s). The folded chips go above them. */
  menu?: React.ReactNode;
  /** The tab row (`StudioTab`s). */
  tabs?: React.ReactNode;
  /** One line under the title row. */
  note?: React.ReactNode;
  testId?: string;
  className?: string;
}

export function StudioDetailHeader({
  locale,
  icon,
  objectTile,
  label,
  apiName,
  typeLabel,
  packageLabel,
  status,
  meta,
  sequence,
  onOpenItem,
  onClose,
  closeOnEscape = true,
  primaryAction,
  menu,
  tabs,
  note,
  testId,
  className,
}: StudioDetailHeaderProps): React.ReactElement {
  const close = () => confirmUnsavedLeave(onClose);
  const open = (name: string | null) => {
    if (name === null || !onOpenItem) return;
    confirmUnsavedLeave(() => onOpenItem(name));
  };

  // The latest close, for a listener installed once per enablement (keyed on
  // the flag, never on a callback's identity).
  const closeRef = React.useRef(close);
  React.useLayoutEffect(() => {
    closeRef.current = close;
  });
  React.useEffect(() => {
    if (!closeOnEscape) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target)) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeOnEscape]);

  const closeLabel = t('engine.studio.detailHeader.close', locale);
  const moreLabel = t('engine.studio.detailHeader.more', locale);
  const packageTitle = packageLabel ? tFormat('engine.studio.detailHeader.package', locale, { package: packageLabel }) : '';

  const chips =
    typeLabel || packageLabel ? (
      <>
        {typeLabel && (
          <span data-testid="studio-detail-type" className={STUDIO_KIND_CHIP}>
            {typeLabel}
          </span>
        )}
        {packageLabel && (
          <span
            data-testid="studio-detail-package"
            title={packageTitle}
            aria-label={packageTitle}
            className={cn(STUDIO_KIND_CHIP, 'gap-1')}
          >
            <Package className="h-3 w-3 shrink-0" aria-hidden="true" />
            {packageLabel}
          </span>
        )}
      </>
    ) : undefined;

  const position = sequence ? detailSequence(sequence.names, sequence.current) : null;
  const pager = position && (
    <div
      role="group"
      data-testid="studio-detail-pager"
      aria-label={
        position.index === null
          ? t('engine.studio.detailHeader.notInList', locale)
          : tFormat('engine.studio.detailHeader.position', locale, { index: position.index, total: position.total })
      }
      className="flex shrink-0 items-center gap-0.5"
    >
      <button
        type="button"
        data-testid="studio-detail-previous"
        aria-label={t('engine.studio.detailHeader.previous', locale)}
        title={t('engine.studio.detailHeader.previous', locale)}
        disabled={position.previous === null}
        onClick={() => open(position.previous)}
        className={cn(STUDIO_HEADER_ICON_BUTTON, 'disabled:pointer-events-none disabled:opacity-40')}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      {position.index !== null && (
        <span
          data-testid="studio-detail-position"
          data-studio-fold-label=""
          aria-hidden="true"
          className={cn(STUDIO_FOLD_LABEL, 'whitespace-nowrap px-1 text-xs tabular-nums text-muted-foreground')}
        >
          {position.index} / {position.total}
        </span>
      )}
      <button
        type="button"
        data-testid="studio-detail-next"
        aria-label={t('engine.studio.detailHeader.next', locale)}
        title={t('engine.studio.detailHeader.next', locale)}
        disabled={position.next === null}
        onClick={() => open(position.next)}
        className={cn(STUDIO_HEADER_ICON_BUTTON, 'disabled:pointer-events-none disabled:opacity-40')}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  // With items of its own the ⋯ is always there and takes the folded chips
  // too; without, the header draws a ⋯ only while something is folded.
  const moreMenu = menu ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="studio-detail-more"
          aria-label={moreLabel}
          title={moreLabel}
          className={STUDIO_HEADER_ICON_BUTTON}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <StudioItemHeaderFoldedItems />
        {menu}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <StudioItemHeader
      testId={testId}
      className={className}
      icon={icon}
      objectTile={objectTile}
      title={label}
      titleProps={{ 'data-testid': 'studio-detail-title' }}
      apiName={apiName}
      chips={chips}
      status={status}
      meta={meta}
      tabs={tabs}
      note={note}
      foldMenu={menu ? 'pillar' : { label: moreLabel, testId: 'studio-detail-more' }}
      leading={
        <button
          type="button"
          data-testid="studio-detail-close"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={close}
          className={STUDIO_HEADER_ICON_BUTTON}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      }
      actions={
        pager || primaryAction || moreMenu ? (
          <>
            {pager}
            {primaryAction}
            {moreMenu}
          </>
        ) : undefined
      }
    />
  );
}
