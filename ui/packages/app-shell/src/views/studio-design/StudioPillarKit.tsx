// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The kit every Studio pillar shares: the held-edit report and notice, the
 * unsaved-work and taken-identifier checks, the "Show me" focus helpers, the
 * draft-saved announcement, the read-only link and the base-customization
 * shape, moved out of `StudioDesignSurface.tsx` unchanged by objectstack#29988
 * (slice 4 of the move-only split).
 */

import * as React from 'react';
import type { MetadataClient } from '@object-ui/data-objectstack';
import type { I18nLabel } from '@objectstack/spec/ui';
import { useStudioTabRowFold } from './StudioItemHeader.js';
import { cn } from '@object-ui/components';
import { Lock } from 'lucide-react';
import type { MetadataSelection } from '../metadata-admin/preview-registry.js';
import type { StudioHeld } from './metadataError.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { navItemLabelText } from '../metadata-admin/previews/navItemLabel.js';
import type { EnsuredCustomizationPackage } from './packages-io.js';
import type { PackageCustomizationsState } from './CustomizationMark.js';
import { toast } from 'sonner';

/**
 * objectui#11786 — tells the surface's Publish what edit a pillar holds unsent
 * (`StudioHeld.clause`, or `null`), and takes it back when the pillar unmounts,
 * so a pillar left behind never keeps Publish refusing — nor, since
 * objectstack#26705, keeps the surface's departure guard asking.
 *
 * Keyed on the clause, a string, never on the view model's identity (AGENTS.md
 * #10); the reporter is read through a ref, so an unmemoised one cannot re-fire it.
 */
export function useHeldEditReport(report: ((clause: string | null) => void) | undefined, clause: string | null): void {
  const reportRef = React.useRef(report);
  React.useLayoutEffect(() => {
    reportRef.current = report;
  });
  React.useEffect(() => {
    reportRef.current?.(clause);
  }, [clause]);
  React.useEffect(() => () => reportRef.current?.(null), []);
}

/**
 * objectstack#26705 — the one question Studio asks before a departure drops
 * unsaved work: a dirty pillar's edits (objectui#2600) or an edit a pillar's
 * autosave holds unsent (objectui#11786). The surface asks it before the header
 * leaves the pillar; a pillar asks it before its rail opens another item, which
 * reloads the one buffer the work lives in. `true` when nothing would be lost
 * or the author agrees to lose it.
 */
export function confirmDropUnsavedWork(unsaved: boolean, locale: string): boolean {
  return !unsaved || window.confirm(t('engine.edit.unsavedLeaveConfirm', locale));
}

/**
 * objectstack#26836, objectstack#26917 — the item of `type` that already holds
 * `name`, published or as a draft, in this package or any other; `null` when
 * the identifier is free. Every Studio create reads it before its save and
 * refuses a taken identifier, writing nothing.
 *
 * The create's first-write pin (`ifNoneMatch: '*'` with `mode: 'draft'`)
 * asserts "no DRAFT row" only — the spec's `parentVersion: null` is
 * lifecycle-scoped — so over a PUBLISHED item it would write the blank
 * skeleton as that item's pending draft, and publishing the package would
 * replace the live item with it. The pin stays on the save for a draft that
 * lands between this read and the write; an item published in that window is
 * not refused by it.
 */
export async function findTakenIdentifier(
  client: Pick<MetadataClient, 'list' | 'listDrafts'>,
  type: string,
  name: string,
  locale: string,
): Promise<{ name: string; label: string } | null> {
  const [published, drafts] = await Promise.all([
    client.list<Record<string, unknown>>(type),
    client.listDrafts({ type }) as Promise<Array<{ name?: string; label?: I18nLabel | null }>>,
  ]);
  const publishedRow = (published ?? []).find((row) => row?.name === name);
  const draftRow = (drafts ?? []).find((row) => row?.name === name);
  if (!publishedRow && !draftRow) return null;
  const label = navItemLabelText((publishedRow?.label as I18nLabel | undefined) ?? draftRow?.label ?? undefined, locale);
  return { name, label: label.trim() || name };
}

/**
 * A create refused over a taken identifier (`findTakenIdentifier`), in the
 * create dialog: the sentence naming the item that holds it and, when that item
 * is on the pillar's own rail, a way to open it instead.
 */
export function CreateTakenNotice({
  scope,
  sentence,
  openLabel,
  onOpen,
}: {
  /** The pillar's test-id prefix: `${scope}-create-taken`. */
  scope: string;
  sentence: string;
  openLabel?: string;
  onOpen?: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-2" data-testid={`${scope}-create-taken`}>
      <p className="text-sm text-destructive">{sentence}</p>
      {onOpen && openLabel && (
        <button
          type="button"
          data-testid={`${scope}-create-open-existing`}
          onClick={onOpen}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {openLabel}
        </button>
      )}
    </div>
  );
}

/**
 * objectui#11786 — the line a pillar shows, in place of a refusal, while its
 * autosave holds an incomplete-but-normal edit: what the edit still needs, that
 * it is kept and not yet saved, and a "Show me" that opens the input when it is
 * not the one already open. Neutral on purpose: nothing was refused, and the
 * author has not finished.
 *
 * Exported for its pins; `index.ts` does not re-export it.
 */
export function StudioHeldNotice<Target extends MetadataSelection | null = MetadataSelection>({
  held,
  locale,
  onShow,
  className,
}: {
  held: StudioHeld<Target>;
  locale: string;
  /** Opens the held input; omitted while that input is the one open. */
  onShow?: (target: Target) => void;
  /** Spacing and type size, which differ by pillar. */
  className?: string;
}): React.ReactElement {
  return (
    <div
      data-testid="studio-held"
      role="status"
      className={cn('flex items-start gap-2 rounded-md border bg-muted/40 text-muted-foreground', className)}
    >
      <p data-testid="studio-held-message" className="min-w-0 flex-1">
        {tFormat('engine.studio.held.line', locale, { clause: held.clause })}
      </p>
      {onShow && (
        <button
          type="button"
          onClick={() => onShow(held.target)}
          className="shrink-0 rounded border px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
        >
          {t('engine.studio.refusal.show', locale)}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// objectstack#26730 — "Show me" ends ON the input a refusal names.
//
// A strip's "Show me" used to select its target and stop there: the inspector
// opened, and the focus stayed on the button, so the author still had to find
// the input. The pillar now asks for that input once the selection is open:
// the control the inspector labels with the refusal's `input` (the label the
// sentence names), or, when the refusal names none, the inspector's first.
// ---------------------------------------------------------------------------

/** A control the author types into or picks from. */
const SHOW_FORM_CONTROL = 'input:not([type="hidden"]), textarea, select, [role="combobox"]';

/** How long a request waits for the inspector to draw the input it names. */
const SHOW_FOCUS_WAIT_MS = 3000;

/** The first enabled match of `selector` in `scope`, outside anything hidden from the author. */
function enabledControlIn(scope: Element, selector: string): HTMLElement | null {
  for (const el of scope.querySelectorAll<HTMLElement>(selector)) {
    if ((el as HTMLInputElement).disabled || el.closest('[aria-hidden="true"]')) continue;
    return el;
  }
  return null;
}

/** A label's text as the author reads it: without the visual-only required marker. */
function readLabelText(label: Element): string {
  const copy = label.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return (copy.textContent ?? '').trim();
}

/**
 * The control `input` names in `root`: the one its label is for, else the
 * first control of the nearest block around the label (an editor whose label
 * heads a list of rows, or whose only control adds the first row). With no
 * `input`, the root's first control. `null` while the inspector has not drawn it.
 */
function showTargetControl(root: Element, input: string | undefined): HTMLElement | null {
  const first = (scope: Element) => enabledControlIn(scope, SHOW_FORM_CONTROL) ?? enabledControlIn(scope, 'button');
  if (input === undefined) return first(root);
  for (const label of root.querySelectorAll('label')) {
    if (readLabelText(label) !== input) continue;
    const own = (label as HTMLLabelElement).control;
    if (own instanceof HTMLElement && !(own as HTMLInputElement).disabled) return own;
    for (let block = label.parentElement; block && root.contains(block); block = block.parentElement) {
      const found = first(block);
      if (found) return found;
    }
  }
  return null;
}

/**
 * objectstack#26730 — the focus half of a pillar's "Show me". The returned
 * function asks for the input inside `rootRef`'s element (the pillar's
 * inspector); call it beside the selection that opens the target. The request
 * is answered after that commit, or as soon as the inspector draws the input
 * (a registered inspector settling), and dropped after
 * {@link SHOW_FOCUS_WAIT_MS}: an input the inspector never draws for this
 * target is left unfocused, never swapped for another.
 */
export function useShowInputFocus(rootRef: React.RefObject<HTMLElement | null>): (input: string | undefined) => void {
  const [request, setRequest] = React.useState<{ id: number; input: string | undefined } | null>(null);
  React.useEffect(() => {
    if (!request) return;
    const attempt = (): boolean => {
      const root = rootRef.current;
      const control = root ? showTargetControl(root, request.input) : null;
      if (!control) return false;
      control.focus();
      return true;
    };
    if (attempt()) return;
    const observer = new MutationObserver(() => {
      if (attempt()) stop();
    });
    const timer = window.setTimeout(() => stop(), SHOW_FOCUS_WAIT_MS);
    function stop(): void {
      observer.disconnect();
      window.clearTimeout(timer);
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    return stop;
  }, [request, rootRef]);
  return React.useCallback((input: string | undefined) => {
    setRequest((prev) => ({ id: (prev?.id ?? 0) + 1, input }));
  }, []);
}

/** The draft a pillar's save wrote, as it reports it to `onDraftSaved`. */
export interface StudioSavedDraft {
  type: string;
  name: string;
}

/**
 * objectstack#28984 — a landed draft AUTOSAVE says what it saved, by the
 * item's label, as Studio's other writes do (publish names what went live,
 * discard says "Draft discarded: LABEL"). The top bar's "Saved HH:MM" stays,
 * but it names nothing, and only feedback that names the item counts as write
 * feedback (ruling 6545938831 ② on #28345).
 *
 * The autosave lands after every editing pause, so the toast carries one
 * sonner id per item: a later save of the same item UPDATES the toast already
 * on screen instead of stacking another (the `PACKAGE_LIST_TOAST_ID` pattern
 * above). Typing a label is one live toast, not one per pause; another item
 * saved meanwhile gets its own. Called only once the save has landed: a
 * refused save keeps its refusal strip and says nothing about saving, and a
 * conflict the author settled by reloading saved nothing.
 */
export function announceDraftSaved(saved: StudioSavedDraft, label: string, locale: string): void {
  toast.success(tFormat('engine.studio.draftSaved', locale, { item: label || saved.name }), {
    id: draftSavedToastId(saved),
  });
}

/** The one sonner id a draft save of this item announces under. */
function draftSavedToastId(saved: StudioSavedDraft): string {
  return `studio-draft-saved:${saved.type}:${saved.name}`;
}

/**
 * objectui#12453 — a read-only package says so twice: the lock in the app
 * chip, and this mark at the right of the open item's header, in every
 * pillar. The pillar's read-only sentence (objectui#11781) is its title.
 *
 * objectstack#28576 (ADR-0146 D11) — a plain "Read-only" mark that links
 * nowhere, for every item of a read-only package. It used to link an item of
 * an `allowEnvironmentOverlay` type to its overlay page (Setup's item page,
 * later that page in Studio's "All metadata" area), whose save names no
 * package; the server refuses that write onto a packaged item now, and a customization lives in the base's paired
 * `.custom` package instead (Studio customizes a view, dashboard or report
 * there itself, objectstack#28562). So the mark offers no overlay, whatever
 * the type's registry flag says. `item` stays in the props the pillars pass.
 *
 * objectui#12707 — at a tab row's end, the mark folds to its glyph when the
 * row cannot hold it whole (`useStudioTabRowFold`), rather than being cut
 * mid-word at the row's edge. Folded, its text stays as its accessible name
 * and its title stays its tooltip.
 */
export function StudioReadOnlyLink({
  title,
  locale,
}: {
  /** The open item, or `null` when the header has none open. */
  item: { type: string; name: string } | null;
  title: string;
  locale: string;
}): React.ReactElement {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const label = t('engine.studio.pkg.readonly', locale);
  const folded = useStudioTabRowFold(ref, label);
  const className = cn(
    'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-amber-400/15 text-xs font-medium text-amber-700 dark:text-amber-300',
    folded ? 'w-7 justify-center' : 'px-2.5',
  );
  return (
    <span
      ref={ref}
      title={title}
      data-testid="studio-readonly-link"
      data-folded={folded || undefined}
      className={className}
    >
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className={folded ? 'sr-only' : undefined}>{label}</span>
    </span>
  );
}

/**
 * objectstack#28562 (ADR-0146 D2, D3) — what the Interfaces pillar customizes
 * a read-only base with, from the Studio surface: passed only on a read-only
 * base, once the package list has answered for it.
 */
export interface StudioBaseCustomization {
  /** The read-only base package. */
  base: string;
  /** Its display name, as the top bar shows it. */
  baseLabel: string;
  /** The version its listed manifest declares: an override's `basedOn`. `null` when the list states none. */
  basedOn: string | null;
  /** The ensure door refuses this caller (`customizeDoorWalled`). */
  walled: boolean;
  /** The base's pair, for READS (its drafts); `null` while it has none. */
  pairId: string | null;
  /** The ensure door: resolves the pair's id from its answer, which every write names; rejects with its refusal. */
  ensure: () => Promise<string>;
  /**
   * objectstack#28572 — the ensure door's whole answer: a New on the base
   * creates its item in `packageId`, and a new object takes `namespace`.
   */
  ensurePackage: () => Promise<EnsuredCustomizationPackage>;
  /** objectstack#28572 — the base's served customization read (N-15), which the rails mark rows from. */
  marks: PackageCustomizationsState;
}
