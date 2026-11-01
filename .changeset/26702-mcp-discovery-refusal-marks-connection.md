---
'@objectstack/service-automation': patch
---

fix(service-automation): a borrowed token refused at `mcp` tool discovery marks its connection, not the client secret

Clause-②: no
Metadata-protocol: none

An `mcp` instance with an `oauth2` `authorization_code` grant lists its tools with the token of its discovery organization's connection (ruled B on #26702). A discovery refusal of that connection-borrowed token is now attributed to the connection, not to the instance's client secret:

- that organization's connection is marked `reconnect_required`, with a platform sentence naming the refusal (served as `statusReason` by the connection door and as the held instance's reason);
- the client secret its `credentialRef` names is left as it is (it was marked `rejected`, which setting it again was the only way to clear);
- the instance lists as the next connected organization, or is held "reconnect required" until a reconnect, and a reconnect by that organization lists again (before, the instance stayed held until a declaration edit or a restart).

A reconnect that landed while the refused token was listing keeps its fresh grant: the connection is marked only while it is still the connect whose token was sent, and otherwise the instance retries on the backoff. Static credentials (`bearer`, `api-key`, `basic`) and tokens an instance mints itself (`client_credentials`, `app-credential`) keep the client secret's attribution, unchanged.
