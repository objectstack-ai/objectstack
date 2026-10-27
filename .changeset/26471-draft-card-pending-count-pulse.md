---
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
---

fix(plugin-chatbot): a draft card's Publish (N) refreshes after a publish it did not run

Clause-②: no
Metadata-protocol: none

The assistant's draft tool card read its package's pending-draft count once per tool call and re-read it only after its own publish or discard. A publish from the chat banner (or Studio) left the card showing 发布 (N) with the old count. `ChatbotEnhanced` takes a new optional `subscribeMetadataRefresh` prop, the host's live-metadata pulse: on every pulse each draft card re-reads its package's count through `fetchPendingDraftCount`, and a count of 0 draws Published. The Console's AI chat page passes the assistant bus's `subscribeMetadataRefresh`. Hosts that pass nothing keep today's behaviour.

What to do: nothing. A custom host that wires `fetchPendingDraftCount` can pass its own pulse subscriber to get the same refresh.
