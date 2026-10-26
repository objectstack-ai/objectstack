// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@object-ui/auth';
import { Button } from '@object-ui/components';
import { Maximize2 } from 'lucide-react';
import { useAgents } from '@object-ui/plugin-chatbot/core';
import { useChatConversation } from '../../hooks/useChatConversation.js';
import { chatConversationScope, chatProductOfAgent } from '../../hooks/chatScope.js';
import { resolveSurfaceAgent } from '../../hooks/surfaceAgent.js';
import { t } from '../metadata-admin/i18n.js';
import { ChatPane, resolveApiBase, type PendingFirstMessage } from '../../console/ai/AiChatPage.js';
import { AiUsageIndicator } from '../../layout/AiUsageIndicator.js';
import { rememberDockReturnLocation } from '../../layout/chatDockState.js';
import { usePlanApprovalPending } from '../../assistant/assistantBus.js';

/**
 * objectui#8219 — the display label of the artifact a pillar has open, tagged
 * with the identity it labels. Reported by pillars that know a label (today:
 * the Interfaces pillar's open leaf); the others report nothing.
 */
export interface StudioSurfaceLabel {
  type: string;
  name: string;
  label: string;
}

interface StudioCopilotConversationProps {
  /** The package the Studio surface is editing — scopes the build agent to it. */
  packageId: string;
  /** ADR-0037/P3c — the Live Canvas open/close seam, forwarded to ChatPane. */
  onCanvasOpenChange?: (open: boolean) => void;
  /**
   * objectui#8219 — the open artifact's display label, for the "discussing"
   * chip only. Passed to ChatPane as its own prop when it labels the SAME
   * artifact the URL names; it never enters `surfaceContext` (the agent's
   * `context.surface`). Absent → the chip reads `type · name`.
   */
  surfaceLabel?: StudioSurfaceLabel | null;
}

/**
 * The Studio copilot's chat body — the build agent scoped to the package being
 * designed, over the ADR-0057 P1 `(user, app, product)` conversation, hosted by
 * {@link StudioChatDock} in the surface's right slot. Renders nothing when the AI
 * catalog is empty (community edition / no seat) — callers that add chrome
 * around it must apply the same gate so no empty shell renders.
 */
export function StudioCopilotConversation({
  packageId,
  onCanvasOpenChange,
  surfaceLabel,
}: StudioCopilotConversationProps): React.ReactElement | null {
  // cloud#1610 — the URL is the single source of the surface context: the
  // pillar is the :tab route segment, the artifact is the `?surface=type:name`
  // deep-link every pillar already mirrors (useSurfaceDeepLink). Derived per
  // render; the ChatPane transport reads it per send, so each turn carries
  // what the user is looking at RIGHT NOW.
  const { tab } = useParams<{ tab?: string }>();
  const copilotLocation = useLocation();
  const surfaceContext = React.useMemo(() => {
    const raw = new URLSearchParams(copilotLocation.search).get('surface');
    let artifact: { type: string; name: string } | undefined;
    if (raw) {
      const idx = raw.indexOf(':');
      if (idx > 0 && idx < raw.length - 1) {
        artifact = { type: raw.slice(0, idx), name: raw.slice(idx + 1) };
      }
    }
    if (!tab && !artifact) return undefined;
    return { ...(tab ? { pillar: tab } : {}), ...(artifact ? { artifact } : {}) };
  }, [tab, copilotLocation.search]);
  // objectui#8219 — the chip's display label, read beside the context rather
  // than inside it. Shown only when it labels the artifact the URL names: the
  // URL stays the single source of WHAT is discussed, so a label that lags or
  // leads the `?surface=` mirror is dropped instead of naming the wrong item.
  const artifact = surfaceContext?.artifact;
  const surfaceArtifactLabel =
    artifact && surfaceLabel && surfaceLabel.type === artifact.type && surfaceLabel.name === artifact.name
      ? surfaceLabel.label || undefined
      : undefined;
  const { user } = useAuth();
  const userId = user?.id;
  const apiBase = React.useMemo(() => resolveApiBase(), []);

  const { agents, isLoading: agentsLoading, error: agentsError } = useAgents({ apiBase });

  // ADR-0057 P2: the Studio authoring surface resolves through the ONE
  // declarative resolver (`studio-build` → build, else platform default), not a
  // local `isBuildAgent` pick. Same result, single source of truth.
  const activeAgent = React.useMemo(
    () => resolveSurfaceAgent('studio-build', { agents }),
    [agents],
  );

  const chatApi = activeAgent
    ? `${apiBase}/agents/${encodeURIComponent(activeAgent)}/chat`
    : undefined;

  // One durable conversation per (user, app, product) — ADR-0057. Keyed on the
  // PACKAGE and PRODUCT, not on this surface, so reopening the same app's design
  // chat in the full-page `/ai/build?package=…` focus view resumes THIS thread
  // (no `studio:` fork). See {@link chatConversationScope}.
  const { conversationId, initialMessages } = useChatConversation({
    userId: activeAgent ? userId : undefined,
    scope: activeAgent
      ? chatConversationScope({ appId: packageId, product: chatProductOfAgent(activeAgent) })
      : undefined,
    apiBase,
    activeId: undefined,
    forceNew: false,
  });

  const pendingFirstMessageRef = React.useRef<PendingFirstMessage | null>(null);

  // No agent served (community edition / misconfigured) → no copilot, plain surface.
  if (!agentsLoading && agents.length === 0) return null;

  return (
    <ChatPane
      key={`${chatApi ?? 'local'}:${conversationId ?? 'pending'}`}
      agents={agents}
      agentsLoading={agentsLoading}
      agentsError={agentsError}
      activeAgent={activeAgent}
      chatApi={chatApi}
      apiBase={apiBase}
      conversationId={conversationId}
      editPackageId={packageId}
      surfaceContext={surfaceContext}
      surfaceArtifactLabel={surfaceArtifactLabel}
      initialMessages={initialMessages}
      pendingFirstMessageRef={pendingFirstMessageRef}
      onSent={() => {}}
      onShare={() => {}}
      showDebug={false}
      onCanvasOpenChange={onCanvasOpenChange}
    />
  );
}

// (The legacy LEFT copilot panel that used to live here was removed by the
// final ADR-0057 cleanup. The cloud `aiSlot` seam in StudioDesignSurface still
// accepts an injected left panel.)

/** What the copilot reports up to the slot that hosts it (objectui#12725). */
export interface StudioCopilotStatus {
  available: boolean;
  planPending: boolean;
}

export interface StudioChatDockProps {
  /** The package the Studio surface is editing — scopes the build agent to it. */
  packageId: string;
  /** UI locale (from the Studio surface) for the copilot's own chrome. */
  locale?: string;
  /** objectui#8219 — the open artifact's display label, for the chat's
   * "discussing" chip; see {@link StudioCopilotConversation}. */
  surfaceLabel?: StudioSurfaceLabel | null;
  /**
   * objectui#12725 — what the right slot draws of the copilot around it:
   * `available`, whether the agent catalog serves one (true while it is still
   * being read, as the dock always rendered then), so no segment, strip or
   * empty body stands for a copilot that is not there; and `planPending`, the
   * objectui#11666 reading that a plan it proposed awaits approval. Reported on
   * every change, and as unavailable on unmount.
   */
  onStatusChange?: (status: StudioCopilotStatus) => void;
  /** ADR-0037 — the Live Canvas opened or closed; the slot widens while it is open. */
  onCanvasOpenChange?: (open: boolean) => void;
}

/**
 * The Studio copilot as the body of the surface's right slot (objectui#12725;
 * it was the ADR-0057 P3c right dock in the shared `ChatDockPanel` chrome
 * until then). Same conversation as before — the build agent over the P1
 * `(user, package, build)` scope — and the same open-in-full-page door; only
 * its host moved. The slot owns showing and hiding, its width and the small
 * screen; this renders the conversation and its toolbar.
 *
 *  - Maximize opens `/ai/build?package=…`, which resumes THIS thread (the
 *    scope is keyed on the package, not the surface).
 *  - The Live Canvas reports open/close up to the slot (ADR-0037 — the preview
 *    needs more width than the slot has).
 */
export function StudioChatDock({
  packageId,
  locale,
  surfaceLabel,
  onStatusChange,
  onCanvasOpenChange,
}: StudioChatDockProps): React.ReactElement | null {
  const navigate = useNavigate();
  const location = useLocation();
  const apiBase = React.useMemo(() => resolveApiBase(), []);

  // The catalog gate lives HERE: the slot asks it, and draws nothing of a
  // copilot the catalog does not serve (community edition / no seat).
  const { agents, isLoading: agentsLoading } = useAgents({ apiBase });
  const available = agentsLoading || agents.length > 0;
  // objectui#11666 — read off the assistant bus the chat publishes to.
  const planPending = usePlanApprovalPending();
  const onStatusChangeRef = React.useRef(onStatusChange);
  React.useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  });
  React.useEffect(() => {
    onStatusChangeRef.current?.({ available, planPending: available && planPending });
  }, [available, planPending]);
  React.useEffect(
    () => () => {
      onStatusChangeRef.current?.({ available: false, planPending: false });
    },
    [],
  );

  // Record where we maximized FROM so the `/ai` page's collapse-to-dock
  // returns to THIS Studio surface, not to some console page.
  const openFullPage = React.useCallback(() => {
    rememberDockReturnLocation(`${location.pathname}${location.search}`);
    navigate(`/ai/build?package=${encodeURIComponent(packageId)}`);
  }, [location.pathname, location.search, navigate, packageId]);

  if (!available) return null;

  const maximizeLabel = t('engine.studio.slot.openFullPage', locale);
  return (
    <>
      <div className="flex h-9 shrink-0 items-center justify-end gap-0.5 border-b px-2">
        {/* ADR-0057 #8 — proactive AI usage indicator (hides itself when the
            usage endpoint is absent / returns nothing to show). */}
        <AiUsageIndicator apiBase={apiBase} />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={openFullPage}
          aria-label={maximizeLabel}
          title={maximizeLabel}
          data-testid="studio-copilot-maximize"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {/* flex-col so the ChatPane child (its root is `flex min-h-0 flex-1`)
          gets a bounded flex-column parent and keeps its composer on screen. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <StudioCopilotConversation
          packageId={packageId}
          onCanvasOpenChange={onCanvasOpenChange}
          surfaceLabel={surfaceLabel}
        />
      </div>
    </>
  );
}
