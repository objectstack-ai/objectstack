/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5577 — the dock's DEFAULT body under a PARTIAL runtime-config
 * snapshot.
 *
 * `ChatDockConversation` (the body `ChatDockPanel` / `ChatDockMobileSheet` mount
 * when no `children` override is supplied — i.e. what `ConsoleLayout` renders)
 * feeds the AI-authoring flag into the ONE surface-agent resolver. It used to
 * read that flag inline and UN-CHAINED — `getRuntimeConfig().features.aiStudio`
 * — while `HomePage` read the same flag one file away as `features?.aiStudio`.
 * One doctrine, two spellings, and only the chained one survives a snapshot
 * whose `features` is absent: PR #5575 measured the un-chained shape crashing 29
 * tests across 4 suites before it was corrected.
 *
 * These cases pin the corrected shape at the dock. The stand-in is deliberately
 * NARROW: `importOriginal()` keeps the REAL `isAiStudioEnabled()`, and only
 * `getRuntimeConfig` is replaced — with the exact partial snapshot four sibling
 * Home suites already install (`() => ({ branding })`). So a regression to any
 * inline `getRuntimeConfig().features…` read here turns these red, while the
 * accessor — which reads the module's own always-complete singleton — stays
 * green. The assertion is on the VALUE the resolver receives, not merely on
 * "did not throw": a body that silently stopped mounting would satisfy the
 * weaker claim while measuring nothing.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ChatDockPanel, ChatDockMobileSheet, type ChatDockState } from '../ChatDock';
import { resolveSurfaceAgent } from '../../hooks/surfaceAgent';

// PARTIAL — `@object-ui/components`' dialog primitive (which the mobile sheet
// pulls in) calls `createSafeTranslation` at module scope, so a total stand-in
// here fails the whole file at import time rather than at any assertion.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

// The partial snapshot under test — `features` genuinely absent, exactly as the
// four Home suites' stand-in supplies it. Everything else stays REAL: the spy
// below DELEGATES to the shipped `isAiStudioEnabled()`, so the value these cases
// assert is the accessor's own answer and only the call is observed.
const aiStudioSpy = vi.hoisted(() => vi.fn<() => boolean>());
vi.mock('../../runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../runtime-config')>();
  aiStudioSpy.mockImplementation(actual.isAiStudioEnabled);
  return {
    ...actual,
    getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
    isAiStudioEnabled: aiStudioSpy,
  };
});

// Spy on the resolver so the flag's VALUE at the seam is observable. The dock
// computes it in a render-phase `useMemo`, which runs before the empty-catalog
// early return — so an empty catalog still exercises the read.
vi.mock('../../hooks/surfaceAgent', () => ({
  resolveSurfaceAgent: vi.fn(() => undefined),
}));

// The rest of the chat graph is irrelevant to the flag under test.
vi.mock('../../console/ai/AiChatPage', () => ({
  ChatPane: () => null,
  resolveApiBase: (explicit?: string) => explicit ?? '/api/v1/ai',
}));
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [], isLoading: false, error: undefined }),
}));
vi.mock('../../hooks', () => ({
  useChatConversation: () => ({ conversationId: undefined, initialMessages: [] }),
}));
vi.mock('../AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));

const resolverMock = vi.mocked(resolveSurfaceAgent);

function dockState(overrides: Partial<ChatDockState> = {}): ChatDockState {
  return {
    expanded: true,
    width: 420,
    dragging: false,
    maximized: false,
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    maximize: vi.fn(),
    restore: vi.fn(),
    onResizePointerDown: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  resolverMock.mockClear();
  aiStudioSpy.mockClear(); // keeps the delegating implementation
});

describe('ChatDock default body on a partial runtime-config snapshot (objectui#5577)', () => {
  it('mounts the desktop rail and fails OPEN when `features` is absent', async () => {
    render(<ChatDockPanel dock={dockState()} />);

    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();
    // The default body is loaded on first render (objectui#13410).
    await waitFor(() => expect(resolverMock).toHaveBeenCalled());
    expect(resolverMock.mock.calls[0][1]).toMatchObject({ aiStudioEnabled: true });
  });

  it('mounts the mobile sheet and fails OPEN when `features` is absent', async () => {
    render(<ChatDockMobileSheet open onOpenChange={vi.fn()} />);

    await waitFor(() => expect(resolverMock).toHaveBeenCalled());
    expect(resolverMock.mock.calls[0][1]).toMatchObject({ aiStudioEnabled: true });
  });

  it('still passes the flag through the `default` surface, not a bare call', async () => {
    // The dock is the console's ambient assistant; the flag only means anything
    // paired with the surface the resolver is bounded on.
    render(<ChatDockPanel dock={dockState()} />);

    await waitFor(() => expect(resolverMock).toHaveBeenCalled());
    expect(resolverMock.mock.calls[0][0]).toBe('default');
  });

  it('asks the ACCESSOR rather than re-spelling the read inline', async () => {
    // Scoped deliberately tighter than the two cases above. Those pin the
    // crash-closure and stay green for ANY optional-chained inline read
    // (measured: reverting this call site to `features?.aiStudio !== false`
    // leaves them passing) — so on their own they say nothing about where the
    // doctrine lives. This one fails for every inline spelling, chained or not,
    // which is the actual subject of objectui#5577: ONE doctrine, ONE spelling.
    render(<ChatDockPanel dock={dockState()} />);

    await waitFor(() => expect(aiStudioSpy).toHaveBeenCalled());
  });
});
