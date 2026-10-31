---
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
'@objectstack/client': patch
'@object-ui/app-shell': patch
'@object-ui/data-objectstack': patch
'@object-ui/i18n': patch
---

feat(runtime,metadata-protocol,client,console): Studio's publish takes a change note, every history row it writes carries it, and the item history names the person who changed it

Clause-②: yes (widening)
Metadata-protocol: none

**The note reaches each item's history.** `POST /packages/:id/publish-drafts` now forwards a string `message` from its body. `publishPackageDrafts` already wrote that note into the package commit; it now also passes it to each item's promote, so every `sys_metadata_history` row the publish writes stores it as `change_note` (the history read returns it as each event's `message`). A publish with no note, or an empty one, keeps the sentence the rows carried before, `publish app package '<id>'`. The SDK's `packages.publishDrafts(id, opts)` accepts `opts.message`, and the console's `MetadataClient.publishPackageDrafts` sends it only when given, so a caller that names no note sends the same `{}` body as before.

**Who published is the signed-in caller.** The door used to record `body.actor` as the publisher, so a caller holding `manage_metadata` could put any name on every history row and on the commit. It now records the user id of the request's authorized execution context, the rule the single-item `/meta` publish door follows, and ignores a body `actor`. A caller with no user id (a system context) records no actor (`NULL`), never the body's. The SDK keeps `opts.actor` in its type, marked deprecated, so existing callers still compile; the door ignores it. The other package write doors (discard, revert, rollback and the rest) are unchanged here.

**In Studio.** The publish review (the pending-changes sheet's footer) offers an optional **Change note** where it publishes one package as a batch; the note is sent trimmed, and an empty one sends nothing. The item history panel shows each event's actor by the user's name, read from `sys_user` once per set of ids. An id with no user row behind it (a deleted user), or a directory the viewer cannot read, is shown as the id marked "unresolved user". A write no person made shows no actor. Each event's change note is shown under its row. English and Chinese strings are added to the console i18n bundles (the publish-review strings in all ten locale packs, as the key-parity suite requires).
