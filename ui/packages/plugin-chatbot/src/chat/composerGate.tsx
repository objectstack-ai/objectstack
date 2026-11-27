/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';

export interface ComposerGateProps {
  /**
   * What takes the composer's place while `open` (the question card today).
   * Rendered whenever given, hidden while closed, so a holder keeps its own
   * state across a close and a reopen (a send that fails reopens the card
   * with the choice still made).
   */
  holder?: React.ReactNode;
  /** The holder has the composer's place. */
  open: boolean;
  /** The composer. */
  children: React.ReactNode;
}

/**
 * The composer's place, held by one thing at a time: the composer, or a
 * holder that replaces it (a question card; later an approval card).
 *
 * The composer is never unmounted: while the holder is open it is hidden and
 * `inert`, so its draft, its attachments and its uncontrolled textarea all
 * survive, and keyboard focus that was in it goes back to it once the holder
 * closes. The holder never takes focus itself.
 */
export function ComposerGate({ holder, open, children }: ComposerGateProps) {
  const composerRef = React.useRef<HTMLDivElement>(null);
  const holderRef = React.useRef<HTMLDivElement>(null);
  const focusedBeforeOpen = React.useRef<HTMLElement | null>(null);
  const held = open && holder != null;

  // A layout effect runs after the commit and before the browser's focus
  // fix-up, so the element that had focus is still `activeElement` here.
  React.useLayoutEffect(() => {
    if (held) {
      const active = document.activeElement;
      focusedBeforeOpen.current =
        active instanceof HTMLElement && composerRef.current?.contains(active) ? active : null;
      return;
    }
    const target = focusedBeforeOpen.current;
    focusedBeforeOpen.current = null;
    if (!target || !target.isConnected) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || Boolean(holderRef.current?.contains(active));
    if (lost) target.focus();
  }, [held]);

  return (
    <>
      {holder != null ? (
        <div ref={holderRef} data-testid="composer-gate-holder" hidden={!held}>
          {holder}
        </div>
      ) : null}
      <div
        ref={composerRef}
        data-testid="composer-gate-composer"
        hidden={held}
        inert={held}
      >
        {children}
      </div>
    </>
  );
}
