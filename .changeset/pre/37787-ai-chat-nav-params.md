---
'@objectstack/spec': minor
'@object-ui/types': minor
'@object-ui/layout': patch
---

feat(spec): an `ai:chat` menu entry's `params` have a declared shape — the AI inquiry home page's title, subtitle, placeholder and up to four suggested questions

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed

An app puts the AI inquiry home page on its menu as a component entry with `componentRef: 'ai:chat'`. Its `params` are now judged by the new `AiChatNavParamsSchema` wherever an app is parsed:

```ts
{ id: 'nav_ask', type: 'component', label: 'Ask AI', componentRef: 'ai:chat',
  params: {
    title: 'Ask about our policies',          // at most 60 characters
    subtitle: 'Leave, travel and expenses',   // at most 200
    placeholder: 'Type a question…',          // at most 100
    suggestions: ['How many leave days do I get?', 'Who approves travel?'],  // 1 to 4, each at most 100
  } }
```

- The record is closed: an unknown key, a wrong type, an empty string or a fifth suggestion is refused at `navigation.<i>.params.<key>`. `agent` and `scope` are answered with why they are not configurable: the page always talks to the platform `ask` agent, and answers prefer the app's own objects without being limited to them.
- An app carries at most one `ai:chat` entry across `navigation` and every `areas[].navigation`, at any depth; a second one is refused at its own path, naming the first.
- Every other `componentRef` keeps its open `params` record, unchanged.
- The console sidebar links an `ai:chat` entry to `/apps/<app>/component/ai/chat` with no querystring: the page reads the copy off the entry, not the URL. Other component entries still carry their `params` as querystring. `@object-ui/types`' app validator chains both new spec checks.

New exports from `@objectstack/spec/ui`: `AiChatNavParamsSchema`, `AiChatNavParams` (author state), `AiChatNavParamsParsed`, `AI_CHAT_COMPONENT_REF`, `checkAiChatNavParams`, `checkAppSingleAiChatEntry`. The console page that reads these keys ships separately; until then an `ai:chat` entry opens the console's "component not registered" notice, as it did before.
