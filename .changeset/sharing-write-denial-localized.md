---
"@objectstack/plugin-sharing": minor
---

fix(plugin-sharing): the by-id write denial renders through the Operation
Message Catalog instead of a hardcoded English sentence (#12260, the consumer
half of the key #12493 landed)

A user holding object-level allowRead + allowEdit — and no `modifyAllRecords` —
PATCHed a record they do not own on an object declaring
`sharingModel: 'public_read'` with `access: { default: 'private' }`. The sharing
middleware refused, correctly, and the client showed the server's reason
verbatim to the end user: one hardcoded English sentence naming the object's API
name and the row's opaque id. In a fully Chinese deployment that was the only
thing the user was told about why their save failed.

The refusal now renders through the shared Operation Message Catalog in
`@objectstack/spec/system` under the key `record_write_denied` that #12493
landed for it — the same mechanism `plugin-security`'s record-level denial
already uses, which is exactly the comparison the report drew: the same "I can
see this record but cannot change it" situation showed human language or raw
English depending on which layer refused. Same resolution ladder (deployment
override → the caller's locale → `en` → the key), same guarantee that a
misbehaving i18n service cannot turn a 403 into a 500. All four platform
locales (`en`, `zh-CN`, `ja-JP`, `es-ES`) ship copy that sends the reader to the
record's owner or an administrator instead of dead-ending them.

`record_write_denied` is deliberately not `record_access_denied`: this gate
fires on a row the READ path already admitted, so "You do not have access to
this record" would be false the moment it rendered. It is one key for BOTH write
verbs — the user's situation and remedy are identical for `update` and `delete`.

`buildSharingMiddleware` gains an optional third argument, a lazily resolved
`II18nService.t`-compatible lookup wired by `SharingServicePlugin`, because the
i18n service is contributed by another plugin and may start later. It is what
makes the override address the catalog documents,
`errors.record_write_denied`, take effect for this emitter. The argument is
additive: every existing caller passes two and is unchanged, and a stack with no
i18n service still renders the built-in catalog in the caller's locale.

**Not changed: who may write.** The gate is byte-identical — ownership, write
depth, an edit-level share for `update`, Modify All Data — and the app-authored
RLS deferral ahead of it is untouched. The `FORBIDDEN:` prefix the REST layer
classifies 403 on is untouched, and so is the ADR-0111 D10 `delete`-verb
diagnostic breadcrumb. The verb, object and row id the old sentence carried are
now developer facts on the error's `developerMessage` and `details` and in the
log, where a developer reads them and a user never does.
