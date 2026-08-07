---
"@objectstack/spec": minor
---

fix(spec): `webhook` / `connector` / `sharing_rule` are validated at the `/meta` write door (#6245)

Three stack collections could be written through `PUT /api/v1/meta/<type>/:name`
with **zero validation**. A spec-invalid webhook body was stored verbatim and
answered `success: true` — the repo pinned that behaviour itself
(`protocol-meta.test.ts`, which saved `{ name, url, events: ['x.created'] }` and
asserted success, where `events` is an alias of `triggers` and `'x.created'` is
not a `WebhookTriggerType`; that webhook subscribed to nothing).

This is the hole #5271 closed for `api`, arriving through three more doors:
the kinds are produced and consumed today — artifact ingest maps
`defineStack({ webhooks, connectors, sharingRules })` onto items of exactly
these type names — but none is a member of `MetadataTypeSchema`, so
`getMetadataTypeSchema()` returned `undefined`, `resolveOverlaySchema()`
returned `null`, and `saveMetaItem` took its documented "unregistered type →
store without validation" branch. Enforced but undeclared.

**FROM** `PUT /meta/webhook/my_hook` with any JSON → `200 { success: true }`,
stored unvalidated.
**TO** a malformed body → `422 INVALID_METADATA` with structured `issues[]`,
the same envelope every other kind already returned. A well-formed body is
accepted exactly as before.

Each type binds the **same schema its stack collection is validated against**,
so no body can be legal in a stack and illegal through `/meta` or the reverse:
`WebhookSchema`, `DeclarativeConnectorEntrySchema`, `SharingRuleSchema`.
`connector` binds the *declarative entry* schema rather than the bare
`ConnectorSchema` deliberately — the entry schema carries the ADR-0097 §3/§5
rules (a provider-bound instance may not inline credentials via
`authentication`, nor author `actions`/`triggers`), and binding the base would
have left the inline-secret shape a stack refuses reachable through `/meta`,
which is this very bug class wearing a different key.

**No new capability surface.** These are bound for shape validation only: no
`MetadataTypeSchema` member, no `DEFAULT_METADATA_TYPE_REGISTRY` entry, so
every authorization verdict keeps taking the identical "no static entry ⇒
synthesised `allowRuntimeCreate: true`" branch. The write *door* is unchanged;
only the 422 is new. #2657's B/C decision on whether these should become kinds
is untouched and unprejudged.

Graded **minor**, following #5271: a write that previously returned 200 can now
return 422. Nothing well-formed changes behaviour, but a caller relying on the
API accepting malformed bodies will see the difference.

**One schema change rides along, and it is load-bearing.**
`CriteriaSharingRule` / `SharingRule` now declare the ADR-0010 protection
envelope (`_lock`, `_lockReason`, `_lockSource`, `_lockDocsUrl`, `_packageId`,
`_packageVersion`, `_provenance`). Both metadata load paths call
`applyProtection` on **every** type, so a package-loaded sharing rule already
carries those keys — and this shape is `.strict()`, so it did not drop them, it
*rejected* them. That was invisible only while the type resolved no schema at
the overlay door. Binding the door without this spread would have aimed the new
422 at the runtime's own stamp instead of at malformed author input. The
existing guard in `metadata-type-schemas.test.ts` names this failure exactly and
prescribes this fix. Additive and internal-only — no authored field changes.
