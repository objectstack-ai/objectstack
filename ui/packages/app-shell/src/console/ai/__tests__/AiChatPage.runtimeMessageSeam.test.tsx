// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4437 — `AiChatPage` narrows the chat hook's messages through the
 * exported `toRuntimeMessages` adapter, not through five casts.
 *
 * `useObjectChat` returns `ObjectChatMessage[]` (objectui#4424 / PR #4436): the
 * shape BOTH of its modes really produce, which is wide where local mode is
 * wide — it keeps the authored `'tool'` role and the legacy
 * `'partial-call'`/`'call'`/`'result'` tool states. This page wants the runtime
 * shape, and used to say so with `messages as ChatMessage[]` at five sites. A
 * cast erases the whole difference rather than the intentional part of it, so
 * nothing recorded WHICH narrowing was meant and nothing could go red when it
 * changed.
 *
 * Why these pins are worth their weight even though the page cannot produce a
 * `'tool'` role today (hydration yields `HydratedUIMessage['role']`, and API
 * mode's values come from `mapMessages` with v6 states): the difference between
 * "the cast happens to erase this" and "the adapter decides this" is invisible
 * until something reaches the page carrying one. These drive the REAL page and
 * assert the adapter's named decisions at the two boundaries that consume the
 * result — what `<ChatbotEnhanced>` renders, and what the reload cache keeps.
 *
 * The fold-sensitivity measurement itself is pinned in the second describe: the
 * two compute sites that are fold-INSENSITIVE must stay that way, or the
 * decision to route them through the one conversion stops being justified.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';

import { toRuntimeMessages, type ObjectChatMessage } from '@object-ui/plugin-chatbot';
import { isConversationZh } from '../conversationLanguage';

/** What the faked hook hands the page — the honest, UNFOLDED shape. */
let hookMessages: ObjectChatMessage[] = [];
/** The `messages` prop the page passes down to `<ChatbotEnhanced>`. */
let renderedMessages: Array<Record<string, unknown>> = [];
/** The `messages` option the page passes to `useHitlInChat`. */
let hitlMessages: Array<Record<string, unknown>> = [];

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: (opts: { messages: Array<Record<string, unknown>> }) => {
      hitlMessages = opts.messages;
      return { decide: vi.fn(), decisions: {} };
    },
    // The honest hook: it hands out exactly what the real one declares —
    // including a role and tool states the runtime type does not have.
    useObjectChat: () => ({
      messages: hookMessages,
      isLoading: false,
      error: undefined,
      sendMessage: vi.fn(),
      stop: vi.fn(),
      reload: vi.fn(),
      clear: vi.fn(),
      setMessages: vi.fn(),
    }),
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      renderedMessages = (props.messages ?? []) as Array<Record<string, unknown>>;
      return <div data-testid="pane" />;
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'metadata_assistant', label: 'Build', capabilities: ['build'] }],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ user: { id: 'u1' } }) };
});
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: [] }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});
vi.mock('../ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));
vi.mock('../LiveCanvas', () => ({ LiveCanvas: () => <div data-testid="live-canvas" /> }));

import { AiChatPage, deriveBoundPackageId } from '../AiChatPage';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const CACHE_KEY = 'objectstack:ai-chat-messages:conv-seam';

/**
 * A thread carrying BOTH things the honest type keeps and the runtime type
 * folds: a `'tool'`-role message, and a legacy `'result'` tool state on it.
 */
const TOOL_ROLE_THREAD: ObjectChatMessage[] = [
  { id: 'u1', role: 'user', content: 'build me a CRM' },
  {
    id: 'tool-turn',
    role: 'tool',
    content: 'apply_blueprint finished',
    toolInvocations: [
      {
        toolCallId: 't1',
        toolName: 'apply_blueprint',
        state: 'result',
        draftReview: { items: [{ type: 'object', name: 'lead' }], packageId: 'app.crm' },
        pendingActionId: 'pa-1',
      },
    ],
  },
];

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // `useChatConversation` has to RESOLVE the id before the page caches
      // anything under it — `writeConversationMessagesCache` is a no-op without
      // a conversation.
      if (/\/conversations\/conv-seam$/.test(url)) {
        return new Response(JSON.stringify({ id: 'conv-seam', messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/ai/build/conv-seam']}>
      <Routes>
        <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
        <Route path="/ai/:agent" element={<AiChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument());
}

describe("AiChatPage routes the hook's messages through toRuntimeMessages (#4437)", () => {
  beforeEach(() => {
    hookMessages = TOOL_ROLE_THREAD;
    renderedMessages = [];
    hitlMessages = [];
    localStorage.clear();
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a 'tool' message as an assistant bubble, with its legacy tool state folded", async () => {
    await renderPage();

    // The adapter's named decision (`toRuntimeRole`): an authored `'tool'`
    // message IS an assistant message by the time it reaches the components.
    // Under the old cast the role arrived at `<ChatbotEnhanced>` as `'tool'`
    // and only `formatMessageProps`' not-'user' fallthrough made it LOOK right.
    expect(renderedMessages.map((m) => m.role)).toEqual(['user', 'assistant']);

    // `toRuntimeToolState`: the legacy spelling never reaches the components.
    const tools = (renderedMessages[1]?.toolInvocations ?? []) as Array<Record<string, unknown>>;
    expect(tools[0]?.state).toBe('output-available');

    // The pass-through is what keeps the render-only keys alive across the
    // conversion — the affordances would silently vanish if it rebuilt.
    expect(tools[0]?.draftReview).toEqual({
      items: [{ type: 'object', name: 'lead' }],
      packageId: 'app.crm',
    });
    expect(tools[0]?.pendingActionId).toBe('pa-1');
  });

  it('hands useHitlInChat the same converted array (it reads a runtime-only key)', async () => {
    await renderPage();

    expect(hitlMessages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const tools = (hitlMessages[1]?.toolInvocations ?? []) as Array<Record<string, unknown>>;
    expect(tools[0]?.pendingActionId).toBe('pa-1');
  });

  it('caches the tool turn as an assistant message, tool part included (the measured change)', async () => {
    await renderPage();

    await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).not.toBeNull());
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) as string) as Array<{
      id: string;
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;

    const toolTurn = cached.find((m) => m.id === 'tool-turn');
    expect(toolTurn).toBeDefined();

    // Cached as `'tool'` (what the cast let through), this entry is written and
    // then DROPPED by `readMessageCache`'s own role validator on the way back
    // in — the message disappears on a cache-fallback reload.
    expect(toolTurn?.role).toBe('assistant');

    // `sanitizeChatMessagesForCache` gates tool serialization on
    // `role === 'assistant'`, so pre-fold this turn cached its text and nothing
    // else: the re-serialized draft envelope behind "Review N changes /
    // Publish" never made it into the cache at all.
    const toolPart = toolTurn?.parts.find((p) => p.type === 'tool-apply_blueprint');
    expect(toolPart).toBeDefined();
    expect(toolPart?.state).toBe('output-available');
    expect(toolPart?.output).toMatchObject({
      status: 'drafted',
      packageId: 'app.crm',
      drafted: [{ type: 'object', name: 'lead' }],
    });
  });
});

/**
 * The measurement that decided the placement, kept executable.
 *
 * Both sites below are reached through the ONE conversion in the page, which is
 * only defensible while folding cannot change what they compute. If a future
 * adapter decision makes either of them fold-sensitive, this goes red and the
 * placement has to be re-argued rather than silently drifting.
 */
describe('#4437 fold-sensitivity: the two insensitive compute sites stay insensitive', () => {
  const zhLastUserTurn: ObjectChatMessage[] = [
    ...TOOL_ROLE_THREAD,
    { id: 'u2', role: 'user', content: '继续' },
  ];
  // The sharp case: Chinese present ONLY on the message whose role the fold
  // rewrites. A folded `'tool'` becomes `'assistant'`, never `'user'`, so it
  // can never start being read as the conversation's language.
  const zhOnlyOnToolTurn: ObjectChatMessage[] = [
    { id: 'u1', role: 'user', content: 'go ahead' },
    { id: 'tool-turn', role: 'tool', content: '这是中文的工具输出' },
  ];

  it('isConversationZh: same verdict before and after the fold', () => {
    expect(isConversationZh(zhLastUserTurn)).toBe(true);
    expect(isConversationZh(toRuntimeMessages(zhLastUserTurn))).toBe(true);

    expect(isConversationZh(TOOL_ROLE_THREAD)).toBe(false);
    expect(isConversationZh(toRuntimeMessages(TOOL_ROLE_THREAD))).toBe(false);

    expect(isConversationZh(zhOnlyOnToolTurn)).toBe(false);
    expect(isConversationZh(toRuntimeMessages(zhOnlyOnToolTurn))).toBe(false);
  });

  it('deriveBoundPackageId: same package before and after the fold', () => {
    // Newest-wins, and the packageId here rides the message whose role the fold
    // rewrites — so a role-dependence would show up as it appearing or
    // disappearing from the answer.
    expect(deriveBoundPackageId(TOOL_ROLE_THREAD, undefined)).toBe('app.crm');
    expect(deriveBoundPackageId(toRuntimeMessages(TOOL_ROLE_THREAD), undefined)).toBe('app.crm');
  });
});

/**
 * The source net — the half of this card the behavioural pins above CANNOT
 * cover, and the reason it is here rather than assumed.
 *
 * Of the five cast sites, only two are observable: the `<ChatbotEnhanced>` prop
 * and the cache write both change what they produce when the fold is skipped,
 * so restoring their cast reds a test above. The other three cannot red by
 * construction — `isConversationZh` and `deriveBoundPackageId` are
 * fold-INSENSITIVE (that is the measurement, pinned just above), and
 * `useHitlInChat` reads a key the pass-through preserves either way. A cast
 * coming back at any of those three is invisible to every runtime assertion in
 * this file AND to `tsc`, because a cast is precisely the instruction to stop
 * checking. This net is what makes them non-silent.
 *
 * Follows PR #4436's precedent, including the refinement it needed: comment
 * lines are stripped first, because the page NAMES the deleted expression in
 * the comment explaining why it is gone (as does this test). Prose about a cast
 * is not a cast.
 */
describe('#4437 source net: the five casts do not come back', () => {
  const PAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'AiChatPage.tsx');
  const source = readFileSync(PAGE, 'utf8');
  const codeOnly = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');

  it('finds the page it is guarding', () => {
    // If the file moves or is renamed, fail here rather than pass vacuously.
    expect(source).toContain('export function AiChatPage(');
  });

  it("casts the chat hook's `messages` nowhere", () => {
    const casts = codeOnly.match(/\bmessages\s+as\s+\w/g) ?? [];
    expect(
      casts,
      "packages/app-shell/src/console/ai/AiChatPage.tsx narrows the chat hook's " +
        '`messages` with a cast again. The honest -> runtime seam is ' +
        '`toRuntimeMessages` (objectui#4399 / PR #4416); a cast here erases every ' +
        'narrowing decision it records, at a site where two of the five consumers ' +
        'cannot show the difference at runtime (objectui#4437).',
    ).toEqual([]);
  });

  it('converts exactly once, memoized on the hook output', () => {
    // "One conversion where the values enter the page's runtime-typed world" is
    // the card's shape, not a stylistic preference: a second conversion is a
    // second array identity for the same thread, and these values feed effects
    // and memos keyed on it.
    expect(codeOnly.match(/toRuntimeMessages\(/g) ?? []).toHaveLength(1);
    expect(codeOnly).toContain(
      'const runtimeMessages = useMemo(() => toRuntimeMessages(messages), [messages]);',
    );
  });
});
