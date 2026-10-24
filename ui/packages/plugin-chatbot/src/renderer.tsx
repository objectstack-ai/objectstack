/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import { ComponentRegistry, toDomProps } from '@object-ui/core';
import type { ChatbotSchema, ChatbotEnhancedSchema, ChatbotFloatingSchema } from '@object-ui/types';
import { Chatbot } from './index';
import { ChatbotEnhanced } from './ChatbotEnhanced';
import { FloatingChatbot } from './FloatingChatbot';
import { useObjectChat } from './useObjectChat';
import { toRuntimeMessages } from './chatMessageAdapter';

/**
 * Chatbot component for Object UI
 * 
 * @remarks
 * This component supports two modes:
 * 
 * **API Mode** (when `api` is set):
 * - Uses @ai-sdk/react for SSE streaming, tool-calling, and production-grade chat
 * - Connects to service-ai backend (e.g., /api/v1/ai/chat)
 * - Supports streaming, stop, reload, clear actions
 * - Schema fields: api, conversationId, systemPrompt, model, streamingEnabled, headers, requestBody
 * 
 * **Legacy Mode** (when `api` is not set):
 * - Local auto-response for demo/playground use
 * - Schema fields: autoResponse, autoResponseText, autoResponseDelay
 * 
 * Both modes support the `onSend` callback:
 * - Signature: `onSend(content: string, messages: ObjectChatMessage[]): void`
 *   — the hook's own message shape (objectui#4424). The schema's slot,
 *   `ChatbotSchema.onSend`, types its parameter as the authoring message
 *   widened by the three runtime-only approval states, so let a host
 *   callback's parameter be inferred from that slot. A callback that declares
 *   `@object-ui/types`' authoring `ChatMessage[]` no longer type-checks
 *   (objectui#10018): the messages it receives can carry approval states that
 *   contract refuses. `ObjectChatMessage[]` is the parameter type that fits
 *   `useObjectChat`'s own `onSend` slot, and naming it is what lets a callback
 *   read the render-only keys.
 *
 * ## What reaches the host element (objectui#4431)
 *
 * These registrations receive far more than they author: `SchemaRenderer` hands
 * a registered component the node's own keys, the contents of its `props`
 * container, the ARIA it resolved, the evaluated `disabled` verdict, and the
 * host's trailing props — including the injected data-source ADAPTER. Both
 * registrations below used to destructure `schema` and `className` and forward
 * ALL of the rest into `<Chatbot>` / `<ChatbotEnhanced>`, whose props extend
 * `HTMLAttributes<HTMLDivElement>` and spread the leftovers onto their root
 * `<div>`. Measured: 14 non-DOM attributes each, `datasource="[object Object]"`
 * and a meaningless camelCase `arialabel` among them.
 *
 * Per objectui#4425 phase 2, the fix is the whitelist, not another deny-list:
 * everything is CONSUMED (read by name — the config off `schema`, the evaluated
 * `disabled` off the injected props) or WHITELISTED (`toDomProps`, which keeps
 * `id` / `className` / `role` / `tabIndex` / `aria-*` / `data-*` and drops the
 * rest, including the adapter). `chatbot-floating` below is untouched: its
 * content mounts through a portal and its root does not spread onto a host
 * element, which the sweep gate measured as clean.
 */
ComponentRegistry.register('chatbot',
  // The eleven keys this destructure's parameter type used to carry as an
  // anonymous inline intersection now live on `ChatbotSchema` itself
  // (objectui#6169, the #6172 family ruling: every component node has
  // exactly one named, importable authoring-face type) — each was
  // read-site-censused first; none were dead, so none took the ADR-0049
  // route. `schema` is that one type, referenceable and documentable from
  // outside this file for the first time. `disabled` here is the sibling,
  // host-EVALUATED prop (`SchemaRenderer`'s verdict on `schema.disabled` /
  // `schema.disabledOn`, forwarded as `hostDisabled`) — a different carrier
  // from the authored `schema.disabled` it is derived from; see the comment
  // on `disabled={hostDisabled || isLoading}` below.
  ({ schema, className, disabled: hostDisabled, ...props }: { schema: ChatbotSchema; className?: string; disabled?: boolean; [key: string]: any }) => {
    const {
      messages,
      isLoading,
      sendMessage,
    } = useObjectChat({
      api: schema.api,
      initialMessages: schema.messages,
      conversationId: schema.conversationId,
      systemPrompt: schema.systemPrompt,
      model: schema.model,
      streamingEnabled: schema.streamingEnabled,
      headers: schema.headers,
      body: schema.requestBody,
      onError: schema.onError,
      showTimestamp: schema.showTimestamp,
      autoResponse: schema.autoResponse,
      autoResponseText: schema.autoResponseText,
      autoResponseDelay: schema.autoResponseDelay,
      onSend: schema.onSend,
    });

    const handleSendMessage = (content: string) => {
      sendMessage(content);
    };

    // The authoring -> runtime message seam (objectui#4399). `useObjectChat`
    // speaks the `@object-ui/types` (authoring) contract; `<Chatbot>` renders
    // the plugin's own. `toRuntimeMessages` names every narrowing decision
    // between them — see `chatMessageAdapter.ts`. This used to be `as any`,
    // which erased the intentional drift and the accidental drift alike.
    // Memoized so the runtime array's identity is exactly as stable as the
    // hook's own output (local mode holds `messages` in state).
    const runtimeMessages = useMemo(() => toRuntimeMessages(messages), [messages]);

    return (
      <Chatbot
        {...toDomProps(props)}
        messages={runtimeMessages}
        placeholder={schema.placeholder}
        onSendMessage={handleSendMessage}
        // `hostDisabled` is `SchemaRenderer`'s EVALUATED verdict on the node's
        // `disabled` / `disabledOn` (its `_disabled` flag, forwarded as a real
        // `disabled` prop). Consuming it — rather than re-reading the raw
        // `schema.disabled` beside it — keeps one carrier for one question
        // (AGENTS.md #0.1): the raw value may be an expression STRING, which is
        // truthy however it evaluates.
        disabled={hostDisabled || isLoading}
        showTimestamp={schema.showTimestamp}
        userAvatarUrl={schema.userAvatarUrl}
        userAvatarFallback={schema.userAvatarFallback}
        assistantAvatarUrl={schema.assistantAvatarUrl}
        assistantAvatarFallback={schema.assistantAvatarFallback}
        maxHeight={schema.maxHeight}
        className={className}
      />
    );
  },
  {
    namespace: 'plugin-chatbot',
    label: 'Chatbot',
    inputs: [
      { 
        name: 'messages', 
        type: 'array', 
        description: 'Array of message objects with id, role, content, and optional timestamp'
      },
      { 
        name: 'placeholder', 
        type: 'string'      },
      { 
        name: 'showTimestamp', 
        type: 'boolean'      },
      { 
        name: 'disabled', 
        type: 'boolean'      },
      { 
        name: 'userAvatarUrl', 
        type: 'string', 
        
        description: 'URL of the user avatar image'
      },
      { 
        name: 'userAvatarFallback', 
        type: 'string', 
        
        
        description: 'Fallback text shown when user avatar image is not available'
      },
      { 
        name: 'assistantAvatarUrl', 
        type: 'string', 
        
        description: 'URL of the assistant avatar image'
      },
      { 
        name: 'assistantAvatarFallback', 
        type: 'string', 
        
        
        description: 'Fallback text shown when assistant avatar image is not available'
      },
      { 
        name: 'maxHeight', 
        type: 'string'      },
      {
        name: 'api',
        type: 'string',
        description: 'Backend SSE endpoint (e.g., /api/v1/ai/chat). When set, enables streaming AI mode.'
      },
      {
        name: 'conversationId',
        type: 'string',
        description: 'Multi-turn conversation identifier'
      },
      {
        name: 'systemPrompt',
        type: 'string',
        description: 'System prompt to configure assistant behavior'
      },
      {
        name: 'model',
        type: 'string',
        description: 'AI model identifier (e.g., gpt-4o)'
      },
      {
        name: 'streamingEnabled',
        type: 'boolean'      },
      { 
        name: 'autoResponse', 
        type: 'boolean', 
        
        
        description: 'Automatically send a response after user message (for demo purposes, ignored when API is set)'
      },
      { 
        name: 'autoResponseText', 
        type: 'string'      },
      { 
        name: 'autoResponseDelay', 
        type: 'number'      },
      { 
        name: 'className', 
        type: 'string'      }
    ],
    defaultProps: {
      messages: [
        {
          id: 'welcome',
          role: 'assistant',
          content: 'Hello! How can I help you today?',
        }
      ],
      placeholder: 'Type your message...',
      showTimestamp: false,
      disabled: false,
      userAvatarFallback: 'You',
      assistantAvatarFallback: 'AI',
      maxHeight: '500px',
      autoResponse: true,
      autoResponseText: 'Thank you for your message! This is an automated response.',
      autoResponseDelay: 1000,
      className: 'w-full max-w-2xl'
    }
  }
);

// Register Enhanced Chatbot
ComponentRegistry.register('chatbot-enhanced',
  // `schema` is the published authoring face of THIS registration
  // (objectui#7655, the #6169 / #6172 family ruling: every component node has
  // exactly one named, importable authoring-face type). It used to be an
  // anonymous `ChatbotSchema & { ... }` intersection local to this file;
  // every key that intersection carried was read-site-censused before being
  // declared on `ChatbotEnhancedSchema`, and the two `ChatbotSchema` keys this
  // registration never read (`floatingConfig`, and `displayMode` — since
  // retired as a `?: never` tombstone on both faces, objectui#7654) are not on
  // it.
  // `surface` (objectui#6687, maintainer ruling 2026-08-29) is declared there
  // too; the plugin's own `ChatbotSurface` alias is pinned equal to it in
  // `__tests__`, so the union has one contract, not two dialects
  // (AGENTS.md #0.1). `disabled` is the host-EVALUATED verdict, as on
  // `chatbot` above.
  ({ schema, className, disabled: hostDisabled, ...props }: { schema: ChatbotEnhancedSchema; className?: string; disabled?: boolean; [key: string]: any }) => {
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
      api: schema.api,
      initialMessages: schema.messages,
      conversationId: schema.conversationId,
      systemPrompt: schema.systemPrompt,
      model: schema.model,
      streamingEnabled: schema.streamingEnabled,
      headers: schema.headers,
      body: schema.requestBody,
      onError: schema.onError,
      showTimestamp: schema.showTimestamp,
      autoResponse: schema.autoResponse,
      autoResponseText: schema.autoResponseText,
      autoResponseDelay: schema.autoResponseDelay,
      onSend: schema.onSend,
    });

    const handleSendMessage = (content: string, files?: File[]) => {
      sendMessage(content, files);
    };

    const handleClear = () => {
      clear();
      schema.onClear?.();
    };

    // See the `chatbot` renderer above — one seam, one adapter (objectui#4399).
    const runtimeMessages = useMemo(() => toRuntimeMessages(messages), [messages]);

    return (
      <ChatbotEnhanced
        {...toDomProps(props)}
        messages={runtimeMessages}
        placeholder={schema.placeholder}
        onSendMessage={handleSendMessage}
        onClear={handleClear}
        onStop={isApiMode && isLoading ? stop : undefined}
        onReload={isApiMode ? reload : undefined}
        // The evaluated verdict, not the raw schema value — see the `chatbot`
        // registration above. `isLoading` travels on its own prop here.
        disabled={hostDisabled}
        isLoading={isLoading}
        error={error}
        showTimestamp={schema.showTimestamp}
        userAvatarUrl={schema.userAvatarUrl}
        userAvatarFallback={schema.userAvatarFallback}
        assistantAvatarUrl={schema.assistantAvatarUrl}
        assistantAvatarFallback={schema.assistantAvatarFallback}
        maxHeight={schema.maxHeight}
        enableMarkdown={schema.enableMarkdown ?? true}
        enableFileUpload={schema.enableFileUpload ?? false}
        processVisibility={schema.processVisibility}
        // Passed through undefined when unauthored, so `<ChatbotEnhanced>`'s own
        // `surface = 'card'` default keeps applying — the absent case is
        // unchanged by this wiring (objectui#6687).
        surface={schema.surface}
        className={className}
      />
    );
  },
  {
    namespace: 'plugin-chatbot',
    label: 'Chatbot (Enhanced)',
    inputs: [
      { name: 'messages', type: 'array' },
      { name: 'placeholder', type: 'string' },
      { name: 'showTimestamp', type: 'boolean' },
      { name: 'disabled', type: 'boolean' },
      { name: 'enableMarkdown', type: 'boolean' },
      { name: 'enableFileUpload', type: 'boolean' },
      { name: 'processVisibility', type: 'enum' },
      { name: 'surface', type: 'enum', description: "'card' bordered panel, or 'plain' frameless full-page workspace" },
      { name: 'userAvatarUrl', type: 'string' },
      { name: 'userAvatarFallback', type: 'string' },
      { name: 'assistantAvatarUrl', type: 'string' },
      { name: 'assistantAvatarFallback', type: 'string' },
      { name: 'maxHeight', type: 'string' },
      { name: 'api', type: 'string', description: 'Backend SSE endpoint for streaming AI mode' },
      { name: 'conversationId', type: 'string' },
      { name: 'systemPrompt', type: 'string' },
      { name: 'model', type: 'string' },
      { name: 'streamingEnabled', type: 'boolean' },
      { name: 'autoResponse', type: 'boolean' },
      { name: 'autoResponseText', type: 'string' },
      { name: 'autoResponseDelay', type: 'number' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      messages: [
        {
          id: 'welcome',
          role: 'assistant',
          content: 'Hello! How can I help you today?',
        }
      ],
      placeholder: 'Type your message...',
      showTimestamp: false,
      disabled: false,
      enableMarkdown: true,
      enableFileUpload: false,
      userAvatarFallback: 'You',
      assistantAvatarFallback: 'AI',
      maxHeight: '500px',
      autoResponse: true,
      autoResponseText: 'Thank you for your message! This is an automated response.',
      autoResponseDelay: 1000,
      className: 'w-full max-w-2xl'
    }
  }
);

// Register Floating Chatbot (FAB widget)
ComponentRegistry.register('chatbot-floating',
  // `schema` is the published authoring face of THIS registration
  // (objectui#7655) — see the `chatbot-enhanced` note above. `disabled` is
  // the host-EVALUATED verdict `SchemaRenderer` forwards for every node type,
  // destructured under the name its two sibling registrations use. The raw
  // `schema.disabled` read that used to sit on the `disabled` prop below was
  // already dead: `SchemaRenderer` spreads `disabled: verdict || undefined`
  // LAST into the props it hands a registration, and `{...props}` below is
  // spread after that prop, so the verdict overrode the raw value on every
  // render. Naming it changes no outcome; it keeps one carrier for one
  // question (AGENTS.md #0.1) and lets the published face inherit
  // `BaseSchema.disabled` (`boolean | string`) unnarrowed (`c93b4d5f3`) —
  // a raw forward of that union into the panel's `boolean` prop would not
  // type-check, and narrowing the face to make it fit is the shape `c93b4d5f3`
  // retired.
  ({ schema, className, disabled: hostDisabled, ...props }: { schema: ChatbotFloatingSchema; className?: string; disabled?: boolean; [key: string]: any }) => {
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
      api: schema.api,
      initialMessages: schema.messages,
      conversationId: schema.conversationId,
      systemPrompt: schema.systemPrompt,
      model: schema.model,
      streamingEnabled: schema.streamingEnabled,
      headers: schema.headers,
      body: schema.requestBody,
      onError: schema.onError,
      showTimestamp: schema.showTimestamp,
      autoResponse: schema.autoResponse,
      autoResponseText: schema.autoResponseText,
      autoResponseDelay: schema.autoResponseDelay,
      onSend: schema.onSend,
    });

    const handleSendMessage = (content: string, files?: File[]) => {
      sendMessage(content, files);
    };

    const handleClear = () => {
      clear();
      schema.onClear?.();
    };

    // See the `chatbot` renderer above — one seam, one adapter (objectui#4399).
    const runtimeMessages = useMemo(() => toRuntimeMessages(messages), [messages]);

    return (
      <FloatingChatbot
        // Fenced and FIRST — matches the two sibling registrations above
        // (`d3499b315`). Was a raw `{...props}` spread LAST: every authored
        // key `SchemaRenderer` forwarded reached the panel's `ChatbotEnhanced`
        // unfiltered, so `processVisibility`, `surface` and `showAvatars` were
        // live here although `ChatbotFloatingSchema` declares none of them,
        // AND the authored `messages` seed overrode the runtime `messages`
        // prop written below — a sent message never rendered on a floating
        // node. Filtering through `toDomProps` and moving it first closes
        // both: only the DOM-safe whitelist (plus `id`/`data-*`/`aria-*`)
        // survives, and every named prop below now wins over it. No member
        // `ChatbotFloatingSchema` declares depends on this channel — each is
        // consumed by `useObjectChat` above or forwarded by name below, so
        // fencing dark-outs nothing the face promises.
        {...toDomProps(props)}
        floatingConfig={schema.floatingConfig}
        messages={runtimeMessages}
        placeholder={schema.placeholder}
        onSendMessage={handleSendMessage}
        onClear={handleClear}
        onStop={isApiMode && isLoading ? stop : undefined}
        onReload={isApiMode ? reload : undefined}
        // The evaluated verdict — see the head of this registration.
        disabled={hostDisabled}
        isLoading={isLoading}
        error={error}
        showTimestamp={schema.showTimestamp}
        userAvatarUrl={schema.userAvatarUrl}
        userAvatarFallback={schema.userAvatarFallback}
        assistantAvatarUrl={schema.assistantAvatarUrl}
        assistantAvatarFallback={schema.assistantAvatarFallback}
        enableMarkdown={schema.enableMarkdown ?? true}
        enableFileUpload={schema.enableFileUpload ?? false}
        className={className}
      />
    );
  },
  {
    namespace: 'plugin-chatbot',
    label: 'Chatbot (Floating)',
    // `displayMode` is NOT offered here and NOT seeded below (objectui#7654,
    // maintainer ruling B, 2026-09-05). The control painted a "Display Mode"
    // switch this registration never read — the node `type` is the one
    // selector of presentation, and `<FloatingChatbot>` below renders
    // unconditionally — while `defaultProps` wrote `'floating'` into every
    // designer-created node. The control is restated, not deleted into a
    // vacuum (`5f4514f7b`): the restatement is the `?: never` tombstone on
    // `ChatbotSchema` / `ChatbotFloatingSchema` in `@object-ui/types` and the
    // release note. Stored documents carrying the key are unaffected — it has
    // no Zod arm and `BaseSchema` is `.passthrough()`, so they parse exactly
    // as before, and nothing here ever read the value.
    inputs: [
      { name: 'floatingConfig.position', type: 'string', description: 'bottom-right or bottom-left' },
      { name: 'floatingConfig.defaultOpen', type: 'boolean' },
      { name: 'floatingConfig.panelWidth', type: 'number' },
      { name: 'floatingConfig.panelHeight', type: 'number' },
      { name: 'floatingConfig.title', type: 'string' },
      { name: 'floatingConfig.triggerSize', type: 'number' },
      { name: 'messages', type: 'array' },
      { name: 'placeholder', type: 'string' },
      { name: 'enableMarkdown', type: 'boolean' },
      { name: 'enableFileUpload', type: 'boolean' },
      { name: 'api', type: 'string', description: 'Backend SSE endpoint for streaming AI mode' },
      { name: 'conversationId', type: 'string' },
      { name: 'systemPrompt', type: 'string' },
      { name: 'model', type: 'string' },
      { name: 'streamingEnabled', type: 'boolean' },
      { name: 'autoResponse', type: 'boolean' },
      { name: 'autoResponseText', type: 'string' },
      { name: 'autoResponseDelay', type: 'number' },
      { name: 'className', type: 'string' },
    ],
    defaultProps: {
      floatingConfig: {
        position: 'bottom-right',
        defaultOpen: false,
        panelWidth: 400,
        panelHeight: 520,
        title: 'Chat',
        triggerSize: 56,
      },
      messages: [
        {
          id: 'welcome',
          role: 'assistant',
          content: 'Hello! How can I help you today?',
        }
      ],
      placeholder: 'Type your message...',
      enableMarkdown: true,
      enableFileUpload: false,
      autoResponse: true,
      autoResponseText: 'Thank you for your message! This is an automated response.',
      autoResponseDelay: 1000,
    }
  }
);
