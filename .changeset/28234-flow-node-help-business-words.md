---
'@objectstack/service-automation': patch
'@objectstack/plugin-approvals': patch
---

Clause-②: no
Metadata-protocol: none

The HTTP and approval flow nodes now describe themselves in business words. The node description and
config help are the text the Studio flow palette and node cards show an admin, and the HTTP node's
spoke of the messaging outbox, retry / dead-letter, an HMAC-SHA256 secret, "a literal, read as
written" and a CEL value envelope; the approval node's said it "suspends the flow". The HTTP node now
reads "Send a request to an outside web service: wait for its answer, or hand it off to be delivered
in the background with automatic retries", with plain help for the request kind, background delivery,
the wait time, the signing secret and what to send; the approval node reads "Ask people to approve or
reject a record". The engineer detail moved to code comments beside each entry. No key, type, default,
accepted value or behaviour changed.
