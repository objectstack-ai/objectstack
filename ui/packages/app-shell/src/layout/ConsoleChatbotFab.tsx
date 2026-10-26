/**
 * ConsoleChatbotFab
 *
 * The console AI assistant's launcher — a small, zero-dependency floating
 * button that opens the ChatDock (ADR-0057: the dock is the canonical chat
 * presentation; this button is its collapsed affordance, the familiar
 * bottom-right entry point that survived the P3 reflow).
 *
 * History: this used to be a lazy proxy that armed a ~20MB floating-overlay
 * chat (`ConsoleFloatingChatbot`) on click. P3b re-pointed it at the dock
 * behind the `chatDock` flag; the final ADR-0057 cleanup removed the overlay
 * path (and the flag) entirely — the dock loads the chat graph on demand, so
 * the FAB stays dependency-free.
 *
 * objectui#11666 — while a proposed plan awaits the user's approval, the FAB
 * carries a small marker, so a user who closed the chat still sees that the
 * assistant is waiting on them. The reading comes off the assistant bus (the
 * chat publishes it; see `usePlanApprovalPending`), never from chat code here,
 * and only a change of the plan's state clears it — opening the chat does not.
 *
 * objectui#12248 — the FAB yields its corner. It is `fixed` over the bottom-right
 * of every page, and that corner is where a record page puts two controls a
 * user cannot do without: the inline-edit bar's Save (sticky at the scroller's
 * bottom edge, right-aligned) and, when the attachments panel is the page's
 * last content, its last row's Download / Delete. Measured on a hosted console
 * at 1440×900 and 1440×1400: a click on Save opened the assistant instead, and
 * one tester lost an inline save that way. So while any element carrying
 * `data-fab-yield` overlaps the FAB's own box, the FAB is hidden and not
 * hit-testable (`invisible`), and it comes back the moment the corner is free.
 * The assistant stays reachable through the top bar and ⌘/Ctrl+Shift+I.
 *
 * Positional, not presence: an occupant that is on the page but not under the
 * button (the save bar under `sm`, where the FAB sits higher; an attachment row
 * scrolled elsewhere) leaves the FAB alone. Opt-in, not "any control": a list
 * scrolling row actions through the corner would otherwise blink the FAB on
 * every page; an occupant declares itself with the attribute instead.
 *
 * @module
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { useAssistant, usePlanApprovalPending } from '../assistant/assistantBus.js';
import { useObjectTranslation } from '@object-ui/i18n';

/**
 * The DOM marker of a control the FAB must not cover (objectui#12248). Written
 * by `InlineEditSaveBar` (`@object-ui/plugin-detail`) on its bar and by
 * `RecordAttachmentsPanel` on its row actions. A DOM attribute rather than a
 * shared export, so no package grows a published name for it.
 */
const FAB_YIELD_SELECTOR = '[data-fab-yield]';

/** Two boxes share area. A zero-size box (a `display: none` element) shares none. */
function overlaps(a: DOMRect, b: DOMRect): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Whether a `data-fab-yield` element overlaps `button`'s box right now.
 * Re-measured at most once per frame, on any scroll (captured, so the record
 * page's own scroller counts), on resize, and when nodes are added or removed
 * (the save bar mounting, a tab or a list row arriving). The button keeps its
 * geometry while hidden, so the measurement reads the same box either way.
 */
function useCornerOccupied(button: React.RefObject<HTMLButtonElement | null>): boolean {
  const [occupied, setOccupied] = useState(false);
  useEffect(() => {
    const own = button.current;
    if (!own || typeof document === 'undefined') return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = own.getBoundingClientRect();
      const occupants = document.querySelectorAll(FAB_YIELD_SELECTOR);
      let hit = false;
      for (let i = 0; i < occupants.length && !hit; i++) {
        hit = overlaps(box, occupants[i].getBoundingClientRect());
      }
      setOccupied(hit);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    observer?.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [button]);
  return occupied;
}

export interface ConsoleChatbotFabProps {
  /** Product/app label for the accessible name. */
  appLabel: string;
  /** Open the ChatDock (rail on desktop, bottom sheet under `md`). */
  onOpenDock: () => void;
}

export function ConsoleChatbotFab({ appLabel, onOpenDock }: ConsoleChatbotFabProps) {
  const { t } = useObjectTranslation();

  // A designer surface can ask the assistant to open (e.g. an "Ask AI"
  // button) via the assistant bus — same effect as clicking the FAB.
  const { openSeq } = useAssistant();
  const seenOpenSeq = useRef(openSeq);
  useEffect(() => {
    if (openSeq !== seenOpenSeq.current) {
      seenOpenSeq.current = openSeq;
      onOpenDock();
    }
  }, [openSeq, onOpenDock]);

  const planPending = usePlanApprovalPending();
  const markerId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cornerOccupied = useCornerOccupied(buttonRef);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={t('topbar.openAssistant', { defaultValue: 'Open {{name}} assistant', name: appLabel })}
      aria-describedby={planPending ? markerId : undefined}
      onClick={onOpenDock}
      className={`fixed bottom-20 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-primary/20 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:bottom-6${cornerOccupied ? ' invisible' : ''}`}
      data-testid="console-chatbot-fab"
    >
      {/* Inline SVG — no lucide-react import here, FAB stays dependency-free. */}
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="M5.6 5.6l2.1 2.1" />
        <path d="M16.3 16.3l2.1 2.1" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
        <path d="M5.6 18.4l2.1-2.1" />
        <path d="M16.3 7.7l2.1-2.1" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      {planPending ? (
        <span
          className="absolute right-1 top-1 flex size-3.5"
          data-testid="console-chatbot-fab-plan-pending"
        >
          <span aria-hidden="true" className="size-3.5 rounded-full bg-amber-500 ring-2 ring-background" />
          <span id={markerId} className="sr-only">
            {t('console.ai.dock.planAwaitingApproval')}
          </span>
        </span>
      ) : null}
    </button>
  );
}
