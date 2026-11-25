// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37142 — the console's in-app assistant, as a `type: 'ask_ai'`
 * action reaches it (ADR-0160 D7).
 *
 * The answer is a handler for `<ActionProvider onAskAi>`, or `undefined` where
 * the console cannot serve the click — and `undefined` is what makes every
 * `ask_ai` action under that provider absent rather than disabled. It is
 * defined exactly where the assistant's pin control is drawn:
 *
 * - the assistant surface is on: a layout that hosts the drawer hands its
 *   handle (`useChatDockControl`) only while `useAiSurfaceEnabled` answers
 *   `enabled`, so the handle's presence IS that gate, read without a second
 *   catalog fetch where there is no drawer;
 * - the AI service advertises that it honours a focus (`capabilities.focus`
 *   on a catalog row, objectstack#36999).
 *
 * The handler does what the pin control does: it pins the record through the
 * one setter (`setChatFocus`), then opens the drawer on whatever it shows. It
 * sends no message and makes no server call. A drawer that is closed has no
 * chat host yet; the setter holds the focus for the host that opening it
 * mounts.
 */

import { useMemo } from 'react';
import { useAgents } from '@object-ui/plugin-chatbot/core';
import type { AssistantFocusHandler } from '@object-ui/core';
import { useChatDockControl } from '../layout/chatDockControl.js';
import { setChatFocus } from '../layout/chatFocus.js';
import { resolveAiApiBase } from './useAiSurface.js';
import { catalogServesFocus } from './surfaceAgent.js';

export function useAskAiHandler(): AssistantFocusHandler | undefined {
  const dock = useChatDockControl();
  // No drawer, no fetch: the catalog is read only where the surface is on.
  const { agents } = useAgents({ apiBase: resolveAiApiBase(), enabled: dock !== null });
  const focusServed = catalogServesFocus(agents);
  const open = dock?.open;
  return useMemo<AssistantFocusHandler | undefined>(
    () =>
      open && focusServed
        ? (focus) => {
            setChatFocus({ object: focus.object, id: focus.id });
            open();
          }
        : undefined,
    [open, focusServed],
  );
}
