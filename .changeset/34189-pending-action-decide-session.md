---
'@objectstack/skills': patch
'@objectstack/client': patch
---

docs: deciding an in-app AI pending action is the person's own act, on their signed-in session

Clause-②: no
Metadata-protocol: none

The `objectstack-ai` skill, the client SDK page, the actions-as-tools page and the `client.ai.pendingActions` docblock now say what the confirmation rule says for the in-app assistant door (`in-app-pending-action-decided-by-person`): only the person the assistant call ran as approves or rejects their item, in the app on their signed-in session. Another user's `ai:approve` does not decide it, and an API key or token is refused, even the person's own. A client on a token can still list and get the queue. Docs and docblock text only: no export, type, route or behaviour changes in these packages. The skill gains one eval case (an operator script on an API token asked to approve the queue).
