# @object-ui/plugin-chatbot

Chatbot interface plugin for Object UI with full AI SDUI support, built on
[Vercel AI Elements](https://elements.ai-sdk.dev) (MIT) and
[shadcn/ui](https://ui.shadcn.com) (MIT).

> Why AI Elements? They give us a production-grade, shadcn-style chat
> surface — conversation, message bubbles, streaming reasoning, tool calls,
> sources, code blocks, suggestions — that already matches our Tailwind 4
> design tokens. We vendor them into `src/elements/` so we can ship without a
> network dep, and we wrap them inside `ChatbotEnhanced` to keep the public
> ObjectUI prop API stable. See [Architecture](#architecture) below.

## Installation

```bash
npm install @object-ui/plugin-chatbot
```

## Usage

### Basic (Local/Demo Mode)

`ChatbotEnhancedMessage` is this package's runtime message contract, and `role` on it is
the closed union `'user' | 'assistant' | 'system'`. Annotate the state with it:
an unannotated array literal widens `role` to `string`, which `<Chatbot>` then
refuses.

```tsx
import { useState } from 'react';
import { Chatbot, type ChatbotEnhancedMessage } from '@object-ui/plugin-chatbot';

function App() {
  const [messages, setMessages] = useState<ChatbotEnhancedMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! How can I help you today?'
    }
  ]);

  const handleSend = (content: string) => {
    const newMessage: ChatbotEnhancedMessage = {
      id: Date.now().toString(),
      role: 'user',
      content
    };
    setMessages([...messages, newMessage]);
  };

  return (
    <Chatbot
      messages={messages}
      onSendMessage={handleSend}
      placeholder="Type your message..."
    />
  );
}
```

### AI Streaming Mode (service-ai)

When `api` is set in the schema, the chatbot connects to a backend SSE endpoint
using `@ai-sdk/react` v4 (Vercel UI Message Stream protocol) for streaming,
tool-calling, and production-grade chat:

```tsx
import '@object-ui/plugin-chatbot';

const schema = {
  type: 'chatbot',
  api: '/api/v1/ai/chat',
  model: 'gpt-4o',
  systemPrompt: 'You are a helpful assistant.',
  streamingEnabled: true,
  conversationId: 'conv-123',
  messages: [
    { id: '1', role: 'assistant', content: 'Hello! Ask me anything.' }
  ],
  placeholder: 'Type your message...',
};
```

### Using the `useObjectChat` Hook

For custom integrations, you can use the `useObjectChat` hook directly:

```tsx
import { useObjectChat } from '@object-ui/plugin-chatbot';

function MyChat() {
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    stop,
    reload,
    clear,
    isApiMode,
  } = useObjectChat({
    api: '/api/v1/ai/chat',
    model: 'gpt-4o',
    systemPrompt: 'You are helpful.',
  });

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>{msg.content}</div>
      ))}
      {isLoading && <button onClick={stop}>Stop</button>}
      {error && <button onClick={reload}>Retry</button>}
    </div>
  );
}
```

#### What `messages` actually contains

`messages` — and the `onSend(content, messages)` callback fed from it — is
typed `ObjectChatMessage[]`, exported from this package. It is deliberately
neither of the two message contracts nearby, because neither is true of both
modes (objectui#4424):

- **Not `@object-ui/types`' authoring `ChatMessage`.** In API mode the values
  come from the runtime mapper and carry `buildProgress`, `blueprintProgress`,
  `charts`, and `pendingActionId` / `draftReview` / `proposedPlan` /
  `proposedChanges` / `builderHandoff` on each tool invocation — the approval
  card, the "Review N changes" affordance, the plan card, the build panel and
  the inline charts. The authoring contract declares none of them, so rebuilding
  a message field-by-field from it deletes all of them, and the compiler agrees.
  API mode also produces the AI SDK's three approval states
  (`'approval-requested'` / `'approval-responded'` / `'output-denied'`), which
  the authoring contract refuses — they are runtime-only (objectui#10018).
- **Not this package's runtime `ChatbotEnhancedMessage` either.** In local mode an authored
  `'tool'` role and the legacy `'partial-call'` / `'call'` / `'result'` tool
  states pass through untouched; they are folded only at the render seam
  (`toRuntimeMessages`, `chatMessageAdapter.ts`).

`ObjectChatMessage` is **not** a subtype of the authoring `ChatMessage`
(objectui#10018): its tool invocations can carry those three runtime-only
approval states. So an `onSend` callback that declares its parameter as the
authoring `ChatMessage[]` does not type-check — declare `ObjectChatMessage[]`,
which is also what lets you *read* the keys above. `timestamp` is always a
`string` here: both modes absorb an authored `Date` before emitting.

## Schema-Driven Usage

### Discovering Backend Agents

Use `useAgents` to fetch the list of agents exposed by `@objectstack/service-ai`
at `GET {apiBase}/agents`. This is what the global console FAB uses to populate
its in-header agent picker:

```tsx
import { useAgents } from '@object-ui/plugin-chatbot';

function AgentPicker() {
  const { agents, isLoading, error } = useAgents({
    apiBase: 'http://localhost:3000/api/v1/ai',
    // Optional fallback list shown when the backend is unreachable
    fallback: [{ name: 'data_chat', label: 'Data Chat' }],
  });

  if (isLoading) return <span>Loading agents…</span>;
  if (error) return <span>Backend unreachable</span>;

  return (
    <select>
      {agents.map(a => (
        <option key={a.name} value={a.name}>{a.label}</option>
      ))}
    </select>
  );
}
```

Each agent's chat endpoint is `POST {apiBase}/agents/{name}/chat` — pass that
URL as the `api` option to `useObjectChat` to talk to it.

### Console Integration

The console (`@object-ui/app-shell`) auto-mounts a global floating chatbot
when `useDiscovery().isAiEnabled` is true. Configure the backend in your
console `.env`:

```bash
# AI service endpoint (defaults to ${VITE_SERVER_URL}/api/v1/ai when unset)
VITE_AI_BASE_URL=http://localhost:3000/api/v1/ai
# Default agent to select on first open (must match an agent name returned
# by GET ${VITE_AI_BASE_URL}/agents)
VITE_AI_DEFAULT_AGENT=sales_copilot
```

The picker lets the user switch agents at runtime; switching transparently
remounts the chat hook against the new agent's `/chat` endpoint.

The floating panel is responsive by default. On desktop it uses the configured
`panelWidth` / `panelHeight`; on narrow browser viewports it expands between
safe side gutters, stays above the mobile bottom navigation area, and hides the
FAB while open so the close button in the panel header is the only active
dismiss control.

A host that wants to signal a waiting approval outside the chat can pass
`ChatbotEnhanced` the optional `onPlanApprovalPendingChange` callback. It is
called with `true` while the thread's newest proposed plan still offers
"Build it", and with `false` otherwise: no plan, the user approved it, or its
build ran. It fires once on mount and again on every change. The console uses
it to put a marker on its chat launchers while the chat is closed
(objectui#11666).

During a conversation, the chat surface renders an inline assistant responding
indicator while the backend is streaming, keeps message actions quiet until
hover/focus, and summarizes backend failures into a compact retryable notice
with optional technical details. The prompt submit control also becomes a
dedicated stop button while a response is in progress.

This plugin automatically registers with ObjectUI's component registry when imported:

```tsx
import '@object-ui/plugin-chatbot';

// Local/demo mode
const demoSchema = {
  type: 'chatbot',
  messages: [
    { id: '1', role: 'assistant', content: 'Hello!' }
  ],
  placeholder: 'Type your message...',
  autoResponse: true,
};

// AI streaming mode
const aiSchema = {
  type: 'chatbot',
  api: '/api/v1/ai/chat',
  model: 'gpt-4o',
  systemPrompt: 'You are a helpful assistant.',
  streamingEnabled: true,
  messages: [],
  placeholder: 'Ask the AI...',
};
```

## Two Operating Modes

| Feature | Local/Demo Mode | AI Streaming Mode |
|---------|----------------|-------------------|
| `api` | Not set | Set to SSE endpoint |
| Responses | Auto-response (configurable) | Real AI streaming via SSE |
| Streaming | Simulated | Full SSE streaming |
| Tool calling | N/A | Supported via vercel/ai |
| Stop/Reload | Stop cancels timer | Stop interrupts stream |
| Backend | None required | service-ai (IAIService) |

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-chatbot)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-chatbot)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## Architecture

Internally the chatbot is composed from three layers:

```
┌─────────────────────────────────────────────────────┐
│  ChatbotEnhanced (public surface, stable props)     │
│  ├─ Conversation / Message  (AI Elements)           │
│  ├─ PromptInput  (AI Elements)                      │
│  └─ Suggestion / Reasoning / Tool  (AI Elements)    │
├─────────────────────────────────────────────────────┤
│  src/elements/                                      │
│  Vendored Vercel AI Elements + missing shadcn       │
│  primitives (button-group, input-group). Rewritten  │
│  to import from `@object-ui/components`. Do NOT     │
│  edit — re-sync from registry.ai-sdk.dev.           │
├─────────────────────────────────────────────────────┤
│  @object-ui/components (shadcn + Tailwind 4)        │
└─────────────────────────────────────────────────────┘
```

The vendored components are also re-exported under a namespace for advanced
users who want to compose their own chat surface:

```tsx
import { AIElements } from '@object-ui/plugin-chatbot';

<AIElements.Conversation>
  <AIElements.ConversationContent>
    <AIElements.Message from="assistant">
      <AIElements.MessageContent>Hello.</AIElements.MessageContent>
    </AIElements.Message>
  </AIElements.ConversationContent>
</AIElements.Conversation>;
```

### The `ChatbotEnhancedMessage` type

`ChatbotEnhancedMessage` is this package's one message contract — the shape
`<ChatbotEnhanced>` renders and the mappers below produce. On top of the core
`id` / `role` / `content` / `timestamp` / `avatar` / `avatarFallback` fields it
carries the streaming and agent-process keys (`streaming`, `toolInvocations`,
`reasoning`, `sources`, `traceId`, `buildProgress`, `blueprintProgress`,
`charts`), all optional.

```tsx
import type { ChatbotEnhancedMessage } from '@object-ui/plugin-chatbot';
```

Its tool invocations are `ChatbotEnhancedToolInvocation`, also exported here.

`ChatMessage` is **not** exported from this package. That name belongs to
`@object-ui/types`, where it is the **JSON/SDUI schema** type
(`ChatbotSchema['messages']`, `role` includes `'tool'`, `timestamp` may be a
`Date`) — the authoring contract, not the React runtime one. Import the schema
type from `@object-ui/types` and the runtime type from this package.

> Migrating: this package used to publish the runtime shape as `ChatMessage`
> too, with `ChatbotEnhancedMessage` a deprecated alias of it (objectui#4383).
> One name for two contracts across the two packages let an auto-import pick
> the wrong one, so the runtime name is now `ChatbotEnhancedMessage` alone
> (objectui#6349). Replace `import { type ChatMessage } from
> '@object-ui/plugin-chatbot'` with `ChatbotEnhancedMessage` — the shape is
> unchanged.

### Authoring → runtime: `toRuntimeMessages`

The two contracts are both deliberate, so they drift — and the conversion
between them is a real decision, not a formality. If you hold **authored**
messages (`@object-ui/types`) and want to render them with the components in
this package, convert them; do not cast:

```tsx
import type { ChatMessage as AuthoredChatMessage } from '@object-ui/types';
import { ChatbotEnhanced, toRuntimeMessages } from '@object-ui/plugin-chatbot';

function MyAuthoredChat({ messages }: { messages: AuthoredChatMessage[] }) {
  return <ChatbotEnhanced messages={toRuntimeMessages(messages)} />;
}
```

| key | authoring (`@object-ui/types`) | runtime (this package) | what the adapter decides |
|---|---|---|---|
| `role` | `'user' \| 'assistant' \| 'system' \| 'tool'` | `'user' \| 'assistant' \| 'system'` | a `'tool'` message **is an assistant message**: it renders as an assistant bubble with its content shown. `'system'` keeps its own role (`<Chatbot>` renders it as a centred pill). |
| `timestamp` | `string \| Date` | `string` | a `Date` becomes its ISO 8601 string. The runtime renders the timestamp straight into a React child, where an object throws. |
| `toolInvocations[].state` | AI SDK v6 states **except** the three approval states, **+ legacy** `'partial-call' \| 'call' \| 'result'` | v6 states only | the legacy spellings map to `'input-streaming'` / `'input-available'` / `'output-available'` — the mapping the authoring type's own docs declare. `'approval-requested'` / `'approval-responded'` / `'output-denied'` are runtime-only and not authorable (objectui#10018); the adapter's input still admits them, because API-mode values carry them. |
| everything else | — | — | passed through untouched, including keys the runtime contract does not declare. |

The three registered SDUI renderers (`chatbot`, `chatbot-enhanced`,
`chatbot-floating`) use this adapter; they used to use `messages as any`, which
compiled away the intentional drift and any accidental drift with it
(objectui#4399). `authoredToRuntimeMessage` is the single-message variant, and
`toRuntimeRole` / `toRuntimeTimestamp` / `toRuntimeToolState` are the individual
decisions if you need one on its own.

### Message mapping helpers

If you wire `@ai-sdk/react`'s `useChat()` directly and want to render its
`UIMessage[]` with `<ChatbotEnhanced>`, use the exported mappers instead
of writing your own — they handle `parts: [{ type: 'text' | 'reasoning'
| 'tool-*' | 'source-*' }]`, the streaming-cursor flag, and the legacy
`msg.toolInvocations` fallback:

```tsx
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  ChatbotEnhanced,
  uiMessagesToChatMessages,
  type ChatbotEnhancedProps,
} from '@object-ui/plugin-chatbot';

declare const handleSend: ChatbotEnhancedProps['onSendMessage'];

function MyChat() {
  const { messages, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const isStreaming = status === 'streaming' || status === 'submitted';
  return (
    <ChatbotEnhanced
      messages={uiMessagesToChatMessages(messages, { isStreaming })}
      onSendMessage={handleSend}
    />
  );
}
```

`uiMessageToChatMessage(msg, { streaming })` is the single-message
variant. Both are also used internally by `useObjectChat`, so the
mapping logic stays consistent across direct and managed usage.

### Surface chrome

`ChatbotEnhanced` defaults to `surface="card"`, which keeps the bordered panel
chrome suitable for dashboards, sidebars, and floating chat windows. Full-page
chat routes can use `surface="plain"` to remove the outer panel border and let
messages, controls, and the prompt input sit in a continuous workspace:

```tsx
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '@object-ui/plugin-chatbot';

declare const messages: ChatbotEnhancedMessage[];

<ChatbotEnhanced
  messages={messages}
  surface="plain"
  hideClearBar
/>;
```

A host can add its own row to the prompt area with `promptHeaderSlot`. The row
is laid out in flow directly above the prompt input (and outside its form), so
the conversation gives up the room and the row never covers the input or the
last message. Content that renders nothing takes no space. Use it for standing
affordances such as an "unpublished changes" bar; `promptOverlaySlot` stays the
absolute-positioned overlay for slash-command palettes.

```tsx
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '@object-ui/plugin-chatbot';

declare const messages: ChatbotEnhancedMessage[];
declare const pendingChanges: number;

<ChatbotEnhanced
  messages={messages}
  surface="plain"
  promptHeaderSlot={pendingChanges > 0 ? <div>{pendingChanges} changes are not published yet</div> : null}
/>;
```

### Agent process visibility

`ChatbotEnhanced` defaults to an end-user friendly agent process view. Tool
calls are grouped into a compact activity summary, repeated calls collapse into
one row, raw tool names are hidden, and reasoning text is not rendered. This
keeps the final answer as the primary reading target while still showing that
the assistant is doing work.

Use `processVisibility="debug"` for developer or admin trace surfaces that need
the full reasoning panel, raw tool names, tool parameters, and tool results:

```tsx
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '@object-ui/plugin-chatbot';

declare const messages: ChatbotEnhancedMessage[];

<ChatbotEnhanced
  messages={messages}
  processVisibility="debug"
/>;
```

Use `processVisibility="hidden"` when a host wants to suppress non-interactive
agent activity entirely. Human-in-the-loop approvals and draft review actions
remain visible so users can still complete required decisions.

Console hosts also keep a sanitized browser-side display cache for the active
conversation. If the backend conversation record is available but returns no
message rows on refresh, the UI can restore user/assistant text plus grouped
tool names and states. The cache intentionally omits reasoning, tool
parameters, and raw tool results.

## Bundle considerations

This package depends on `streamdown`, `shiki`, `mermaid`, and `katex`
for code/markdown rendering. Together they weigh ~20 MB minified.

In host apps that don't always show the chat panel (e.g. Console's
opt-in AI sidebar), import this package via `React.lazy` so the heavy
chunks only download when the panel actually opens. See
`packages/app-shell/src/layout/ConsoleFloatingChatbot.tsx` for the
reference lazy-load pattern, and `apps/console/vite.config.ts` for the
`manualChunks` rules that keep the chat-only deps in dedicated,
lazy-loadable chunks.

## License

MIT © ObjectStack Inc.

Third-party code shipped under `src/elements/`:
- **Vercel AI Elements** — MIT © Vercel, Inc.
- **shadcn/ui** primitives (`button-group`, `input-group`) — MIT © shadcn.
