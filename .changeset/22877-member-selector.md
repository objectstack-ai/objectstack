---
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
'@objectstack/spec': minor
'@objectstack/objectql': patch
---

feat(metadata-protocol): one language of an email template is read, reset, published, viewed in history and reverted by name — the by-name `/meta` doors accept a bundle member selector (#22877)

Clause-②: yes

**What an administrator can now do.** An email template kept in several languages is one item per language in the store. Each language can now be addressed by name on every by-name door, with `?member=` naming the language:

- `GET /api/v1/meta/email_template/:name?member=zh-CN` reads the `zh-CN` wording: the stored customization when there is one, else the package's `zh-CN` template. A language that nothing stores or ships answers as an absent item (404).
- `DELETE /api/v1/meta/email_template/:name?member=zh-CN` resets the `zh-CN` customization alone; the other languages keep theirs.
- `POST /api/v1/meta/email_template/:name/publish?member=zh-CN` publishes the `zh-CN` draft.
- `GET /api/v1/meta/email_template/:name/history?member=zh-CN` lists the `zh-CN` saves. All languages of one template share one version counter, so the version numbers of one language are not consecutive.
- `POST /api/v1/meta/email_template/:name/rollback?member=zh-CN` reverts the `zh-CN` customization to one of its own versions. A version saved for another language answers `404 VERSION_NOT_FOUND`.

With no `?member=`, every door addresses the canonical member (`en-US`), exactly as before; naming `en-US` is the same request. This closes the window the previous release's changeset stated: a non-`en-US` language could not yet be reset, published, listed or reverted by name.

**The selector.** It is named `member`, after what the store keys a row by, and not `locale`: on `/meta`, `?locale=` already chooses the language the response is translated into. The protocol requests gain one optional field, `member`, on `GetMetaItemRequest`, `DeleteMetaItemRequest`, `PublishMetaItemRequest` and `HistoryMetaItemRequest`. A wrong value is refused with `400 VALIDATION_ERROR`, naming the parameter: the selector on a type whose items have no languages (every type except `email_template` today), a blank value, or a value longer than a stored member can hold (100 characters).

**Each of the five routes now declares its query parameters.** `GET`, `DELETE`, `/history`, `/publish` and `/rollback` on `/meta/:type/:name` refuse a query parameter they do not read with `400 VALIDATION_ERROR`, naming the parameter and listing the supported ones, instead of ignoring it. A misspelled `?memeber=zh-CN` is therefore refused, not answered with the `en-US` wording. The supported names are the ones each route has always read, plus `member`:

- `GET /meta/:type/:name`: `layers`, `state`, `preview`, `package`, `locale`, `member`.
- `DELETE /meta/:type/:name`: `state`, `dropStorage`, `member`.
- `GET /meta/:type/:name/history`: `sinceSeq`, `limit`, `member`.
- `POST /meta/:type/:name/publish`: `package`, `member`.
- `POST /meta/:type/:name/rollback`: `toVersion`, `member`.

A client that sent any other parameter to these routes was having it ignored; it now gets a 400 and can drop it. The deprecated `?layers=` view reads no language, so `?layers=` together with `?member=` is refused rather than answered with the `en-US` layers. A read naming a member skips the shared read cache.

**What else now follows the language** (`@objectstack/objectql`, `@objectstack/metadata-protocol`):

- A by-name read that names no language answers the `en-US` template even when only another language is customized. Before, the registry's read of the name could answer the other language's customization.
- Resetting one language keeps the other languages' customizations served at once, not only after the next restart.
- Publishing, discarding and reverting a package's changes (`POST /packages/:id/publish-drafts`, discard, and commit revert) address each language's draft or change as its own item. Before, a package whose only pending draft was a second language failed to publish (`NO_DRAFT`), and a discard reported that draft discarded while it stayed. The draft list and the commit timeline keep the fields they declare.
- In a cluster, a save, reset or revert of one language converges the other servers on that language.
