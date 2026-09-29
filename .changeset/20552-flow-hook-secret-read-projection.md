---
'@objectstack/service-automation': patch
'@objectstack/metadata-protocol': minor
'@objectstack/metadata': patch
'@objectstack/runtime': patch
---

fix(security): a flow's inbound-hook secret is withheld from every served flow definition, and a read → edit → republish round trip keeps it (#20552)

Clause-②: yes (widening)

**The widening.** `@objectstack/metadata-protocol` gains one public method,
`ObjectStackProtocolImplementation.getMetaItemsForExecution`. It returns the stored
bodies without the serving decorations, for in-process binders that execute what they
read. No door that answers a caller may use it.

An `api` flow's start node carries its inbound hook's HMAC secret (`config.secret`,
ADR-0041), the one credential that hook has. Every read that served the flow's
definition served the secret with it, to any authenticated caller. It is now
withheld from what is SERVED, and from nothing the engine executes.

**What no longer carries the secret.** The automation domain's flow-definition read
and the flow its `POST` / `PUT` / clone doors answer with; and on the metadata plane,
every read of a flow — item, list, layered, draft preview, published snapshot, diff,
audit — plus a package export. The key is removed, not masked: a mask is a non-blank
string the registration gate would accept as the secret.

**Consequence for a reader.** A client that read the secret back from a definition
no longer can. A package exported from one deployment and imported into another
arrives without it, and its `api` flows are refused at registration until a secret is
set on the start node again.

**The round trip.** A save that carries the projected form — no `secret` where the
read served none — keeps the stored secret, on both authoring surfaces (the metadata
plane's save door and the automation domain's `PUT` / `POST`). Only an explicit value
replaces it, so a rotation is written as before. The start node is matched by its
`id`, not its position, so an edit that reorders `nodes` keeps it too. The first save of an item that has no stored row yet, such as a code-authored flow or datasource, takes the value from the code layer the read served, for every type with a registered redactor.

- `@objectstack/service-automation` owns the projection (`redactFlowCredentials`) and
  registers it as the `flow` read-path redactor at plugin `init`. The engine keeps
  binding with the stored secret: it now reads flows from the protocol's execution
  face, because the served face no longer holds the credential its hooks verify
  against.
- `@objectstack/metadata-protocol` gains `getMetaItemsForExecution` on
  `ObjectStackProtocolImplementation` — the same flattened list `getMetaItems`
  serves, without the serving decorations (no `_diagnostics`, no credential
  redaction). It is for in-process engines that execute what they read; every door
  that answers a caller keeps serving `getMetaItems`. `carryForwardRedactedValues`
  now follows a redacted path through an array by the element's `id`.
- `@objectstack/metadata`'s `getPublished` applies the type's registered read-path
  redactor to the body it returns. It was the one metadata read exit that served a
  stored body without it.
