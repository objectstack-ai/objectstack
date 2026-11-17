---
'@object-ui/app-shell': patch
---

feat(app-shell): the AI chat request carries the console's UI language as `context.uiLocale`

Clause-②: no
Metadata-protocol: none

The AI chat pane, on the AI page and in the console dock, now sends the language the console renders in as `context.uiLocale` on every chat request, beside the existing `agentName`, `activeApp`, `packageId` and `surface` keys. Before, the server saw only the browser's `Accept-Language`, so a reply could name a card control (such as the plan card's approve button) in a language the card did not use. The value is the console's resolved language tag, sent as is; the server decides whether to use it. Nothing else in the request changes.
