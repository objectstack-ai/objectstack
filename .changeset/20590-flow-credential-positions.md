---
'@objectstack/service-automation': patch
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

fix(security): every credential a flow definition holds is withheld from what is served, at every depth, and an edit round trip keeps each one where it belongs (#20590)

Clause-②: no

**What is now withheld.** Beside an `api` flow's inbound-hook secret (the start node's
`config.secret`), every served flow definition now also withholds an `http` node's
outbound signing secret (`config.signingSecret`), and both are withheld wherever the
node sits: at the top level, or inside a `loop` body, a `parallel` branch, or a
`try_catch` region. The engine still executes the stored values.

**Removing a signing secret.** A definition saved back without the key keeps the
stored secret, because an absent key is what every read serves. To remove it, save
the key as the empty string (`signingSecret: ''`): the durable callout is then
delivered unsigned, and the empty value is served as written, so the next round trip
keeps it cleared.

**Changing a node's kind.** An edit that keeps a node's `id` and changes its kind no
longer carries that node's stored credential onto it. The credential belonged to the
old kind; a start node that needs a secret asks for one again at registration.

**Moving a node.** A node moved into or out of a `loop` body, a `parallel` branch or a
`try_catch` region keeps its stored credential across the round trip, as long as its
`id` and kind are unchanged and it is the only node, at the top level or in any region,
that carries that `id`. An edge or a config value with the same `id` does not count.

**The `/meta` list read on a dispatcher host.** When the metadata protocol's list read
fails, the list answers that failure (`503 SERVICE_UNAVAILABLE` for a store outage, or
the protocol's own refusal) instead of serving the metadata service's stored list,
which applies no credential redaction. A host whose protocol has no list verb keeps
its metadata-service fallback.
