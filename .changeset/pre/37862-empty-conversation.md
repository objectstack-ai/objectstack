---
'@object-ui/app-shell': patch
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

feat(app-shell): one empty-conversation layout for the AI home, the full-window drawer and the narrow drawer

Clause-②: yes (widening) — `@object-ui/plugin-chatbot` `ChatbotEnhancedProps` gains the optional `renderEmptyState`; `@object-ui/i18n` gains `console.ai.suggestionsLabel` and `console.ai.suggestions.page.*` (eight keys) in every locale
Metadata-protocol: none

A conversation with no message now shows the same layout in all three places: a greeting, a line on what to ask, suggested questions and the recent conversations with their titles.

- **The AI home page** (an app's `ai:chat` entry) keeps its large question box, its suggestions that send and its recent conversations that open on the page. Its heading is the entry's declared `title`; with none it now greets the user by the time of day and name, as Home does, where it read "Ask your data".
- **The console's assistant drawer** draws the layout before the first message: large when the drawer fills the window, compact in the side rail and the phone sheet. The composer stays where it is, under the conversation. The `ask` assistant's suggestions follow the page in view: on a record, "Summarize this record" and "What is related to this record?" put their text in the composer for the user to finish; on a list, a dashboard or a report, the page's two questions send at once. Elsewhere, and for other assistants, the starter questions are the ones they had. The recent conversations list the drawer assistant's last three (five in the full window), not the AI home's own, and open in the drawer.
- **`@object-ui/plugin-chatbot`.** `ChatbotEnhanced` takes `renderEmptyState`: a host's empty conversation drawn in place of the built-in one, given `send` (sends a text) and `fill` (puts it in the composer, focused, sending nothing).

Nothing to migrate.
