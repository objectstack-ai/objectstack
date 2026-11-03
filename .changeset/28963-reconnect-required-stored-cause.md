---
'@objectstack/service-automation': patch
---

fix(service-automation): a connection already marked "reconnect required" answers the cause it stores, and the refusal log names it (#28963)

Clause-②: no — the text of a dispatch refusal on an already-marked connection and of one log line. No accept set, status value, error code or export changes meaning.
Metadata-protocol: none

A refresh that marks a connector connection `reconnect_required` stores a reason naming its cause: the authorization server refused the grant, it issued no refresh token, or the connection keeps no client to refresh with. Two places still said the server refused the grant whatever had happened.

- **Every later dispatch on the marked connection** answers the reason the row stores, the same sentence the first dispatch answered. Before, only the dispatch that marked the row named the cause; every one after it (another replica, a restart, a retry) said the authorization server refused the grant. A row that stores no reason still answers the refusal sentence.
- **The server log line** written when a refresh marks a connection is now that stored reason, so it names the cause on each of the three refresh paths. Before, it said "the authorization server refused the grant" on all three.
- Unchanged: the 503 `SERVICE_UNAVAILABLE` refusal itself, the reason each path stores, the instance's "reconnect required" hold, and every status, code and write.
