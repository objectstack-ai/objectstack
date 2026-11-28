---
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(plugin-chatbot): an ask answer that saved drafts shows a draft review card, with Studio review links

Clause-②: yes (widening) — widened: `@object-ui/plugin-chatbot` exports `DraftReviewCard`, `DraftReviewCardProps` and `extractDraftReview`; `ChatbotEnhancedProps` gains the optional `onOpenReviewLink` and `reviewLinkHref`; `ChatbotEnhancedMessage` gains the optional `draftReview`.
Metadata-protocol: none

When an assistant answer carries a `data-draft-review` part (`DraftReviewListSchema` in `@objectstack/spec/ai`), `ChatbotEnhanced` draws a card under it that lists the drafts the turn saved:

- One row per draft: its label or name, its type, a verdict badge ("Will publish", "N problems", or "Verdict withheld" when no verdict was read) and a Review link to the draft's review in Studio. A verdict read by the save rather than at the turn's end says "checked when saved".
- The rows are grouped by package; each package has one "Review and publish" link to its Changes drawer in Studio. More drafts than the part lists show as "+N more".
- Nothing is published or discarded from the chat: the card has no such control, and a person publishes in Studio.
- A part the schema refuses draws no card; an answer without the part renders as before.
- The card is drawn on a live answer only. The part is not kept with the message, so a conversation reloaded from history shows no card.

In the console (`@object-ui/app-shell`), `ChatPane` opens the links inside the app, so the conversation stays as it was, and gives them an href with the console's base path for a new tab. `@object-ui/i18n` carries the card's strings (`chatbot.draftReview.*`) in every locale pack.
