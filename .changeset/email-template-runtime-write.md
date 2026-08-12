---
"@objectstack/plugin-email": patch
---

Materialize a runtime `email_template` write without a restart (#7733)

`PUT /api/v1/meta/email_template/:name` returned 200 and persisted the row, but
the template never reached `sys_email_template` — so sending it fell back to the
built-in default (or nothing) until the process restarted, at which point the
boot sweep picked the persisted row up and it worked. Neither of the live path's
own log lines ever fired.

The bridge was armed against the wrong announcement. `bootDeclaredTemplates`
subscribed via `metadataService.subscribe('email_template', …)`, whose only
producer is `MetadataManager.register()` → `notifyWatchers()`. The REST save
does not go through there: it calls `protocol.saveMetaItem`, which persists to
`sys_metadata`, write-throughs to the ObjectQL SchemaRegistry (the
`[Registry] Registered email_template` line the QA run saw) and announces on its
own post-persistence seam. `notifyWatchers` has no caller outside
`MetadataManager`, so the watcher could not fire for a runtime write — the boot
log said "subscribed" and meant it, just to the other door.

`EmailServicePlugin` now bridges both doors, sharing one materializer:

* the existing metadata-service subscription — package ingest / artifact
  reload; and
* the protocol's mutation seam — `PUT /meta`, the Studio save behind it,
  publish and delete. The awaited ADR-0094 `registerMutationProjector` is
  preferred, as plugin-security's permission projection prefers it, so the
  write itself carries the materialization (a `PUT` followed by a read of
  `sys_email_template` is consistent, with no race window) and a failure is
  reported on the save's own `projectionApplied` instead of only in a log.
  `onMetadataMutation` is the fallback for protocols predating the projector.

Draft saves stay inert (the ADR-0005 staging buffer), and both seams landing the
same write is harmless — the upsert is keyed on `(name, locale)`, so the row's
`locale` column still holds the tag `sys_email_template`'s loader queries it by.

A delete is no longer read as a withdrawal on its own. `DELETE /meta/:type/:name`
discards a *customization overlay*, so on an artifact-backed template it resets
to the packaged declaration; the bridge re-reads the effective item and
re-materializes the revealed baseline, deactivating rows only when nothing
declares the name any more. A failed read is not an answer and deactivates
nothing — a transient DB error must never be what stops a live template being
sent.
