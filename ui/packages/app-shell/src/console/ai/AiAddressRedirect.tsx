// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34608 (ui ADR-0057 as amended) — the old full-page chat
 * addresses, `/ai`, `/ai/AGENT` and `/ai/AGENT/CONVERSATION` (with `?package=`
 * and `?new=`), open the console's chat drawer instead: a bookmark, a shared
 * link or an in-app link from a surface without a drawer (Studio) still lands
 * on the conversation it named.
 *
 * The address is parsed into the drawer's target and armed per tab, with the
 * drawer open and filling the window — the closest thing to the page the link
 * used to open — then the visit is replaced by the declared landing
 * (`useHomePath`), which hosts the drawer. While the app list is still loading
 * that answers the launcher (`/home`), which hosts the same drawer, so a cold
 * boot on an old link still opens the conversation. A Builder handoff carried as
 * navigation state (objectui#12493: never in the URL) is handed on the same
 * way, as navigation state of the landing.
 *
 * Deliberately light: it imports no chat code, so following an old link loads
 * the chat graph only when the drawer body renders.
 */

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHomePath } from '../../hooks/useHomePath.js';
import { writeStoredDockExpanded, DOCK_EXPANDED_STORAGE_KEY } from '../../layout/chatDockState.js';
import {
  parseAiAddress,
  readBuilderHandoffState,
  writeStoredDockFullWindow,
  writeStoredDockTarget,
  DOCK_HANDOFF_STATE_KEY,
} from '../../layout/chatDockTarget.js';

export function AiAddressRedirect() {
  const location = useLocation();
  const navigate = useNavigate();
  const homePath = useHomePath();
  useEffect(() => {
    writeStoredDockTarget(parseAiAddress(location.pathname, location.search));
    writeStoredDockExpanded(DOCK_EXPANDED_STORAGE_KEY, true);
    writeStoredDockFullWindow(true);
    const handoff = readBuilderHandoffState(location.state);
    const carries = Boolean(handoff.handoffPrompt || handoff.parentConversationId);
    navigate(homePath, { replace: true, state: carries ? { [DOCK_HANDOFF_STATE_KEY]: handoff } : null });
  }, [location.key, location.pathname, location.search, location.state, homePath, navigate]);
  return null;
}
