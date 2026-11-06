---
'@object-ui/plugin-chatbot': patch
---

refactor(plugin-chatbot)!: retire eight zero-consumer exports (the floating chatbot context hook and its three types, the message item props, one adapter helper and two display helpers)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-chatbot#useFloatingChatbot, @object-ui/plugin-chatbot#FloatingChatbotState, @object-ui/plugin-chatbot#FloatingChatbotActions, @object-ui/plugin-chatbot#FloatingChatbotContextValue, @object-ui/plugin-chatbot#ChatMessageProps, @object-ui/plugin-chatbot#toRuntimeToolInvocation, @object-ui/plugin-chatbot#unwrapToolResult, @object-ui/plugin-chatbot#summarizeChatError) the retired operands are a React context hook with its state, actions and context-value types, the props interface of an internal message row, one authored-to-runtime tool-invocation converter and two tool-call display helpers; nothing in the workspace or in hotcrm imports any of them from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these eight names from `@object-ui/plugin-chatbot`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Every module stays in the package: `FloatingChatbotTrigger` and `FloatingChatbotPanel` keep reading the floating state through the hook, `toRuntimeMessages` keeps converting tool invocations, and `ChatbotEnhanced` keeps rendering tool results and error summaries with the two helpers. Only the entry stops publishing them. `FloatingChatbot`, `FloatingChatbotProvider`, `FloatingChatbotTrigger`, `FloatingChatbotPanel` and their `…Props` types, `toRuntimeMessages`, `authoredToRuntimeMessage`, `toRuntimeRole`, `toRuntimeTimestamp`, `toRuntimeToolState`, `humanizeToolName`, `TypingIndicator`, `emitAiUsageRefresh` and `AGENT_ALIAS_GROUPS` stay exported unchanged.

What leaves, and what to write instead:

- FROM `useFloatingChatbot`, `FloatingChatbotState`, `FloatingChatbotActions`, `FloatingChatbotContextValue` TO `FloatingChatbotTrigger` and `FloatingChatbotPanel` inside a `FloatingChatbotProvider`, which open, close and toggle the panel themselves; for a control of your own, hold the open state in your own component.
- FROM `ChatMessageProps` TO `ChatbotProps`: `Chatbot` renders the message rows itself.
- FROM `toRuntimeToolInvocation` TO `toRuntimeMessages` or `authoredToRuntimeMessage`, which convert every tool invocation of a message.
- FROM `unwrapToolResult`, `summarizeChatError` TO no replacement: `ChatbotEnhanced` applies both itself; keep a local copy if your own chat surface needs them.
