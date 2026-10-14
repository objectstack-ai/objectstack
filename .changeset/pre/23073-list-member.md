---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
---

feat(spec, metadata-protocol): the pending-drafts list and a package's commit timeline tell two languages of one email template apart — each entry of a template carries `member` (#23073)

Clause-②: yes (widening: a new declared response key)

**What changed for a reader of the two lists.** An email template kept in several languages is one item per language: two languages of `acme.welcome` are two drafts, and two items of one commit. Until now `GET /api/v1/meta/_drafts` and `GET /api/v1/packages/:id/commits` answered them as two entries with the same `type` and `name`, so a reader could not tell which entry was which language, and could not address the second one.

- Each entry of `GET /meta/_drafts` (`ListDraftsResponseSchema`) and each item of a commit in `GET /packages/:id/commits` (`ListPackageCommitsResponseSchema`) now carries an optional `member` for a type whose identity is a pair (today only `email_template`, identified by `(name, locale)`). It is the language the entry is: `zh-CN`, and `en-US` for the canonical language, spelled out rather than left blank. Two languages of one template are therefore two entries with different `member` values.
- `member` is present on every entry of such a type and absent on every other type, so the lists are unchanged for every type whose identity is its name alone.
- The value is the one the by-name doors take back as their `member` selector: `GET /api/v1/meta/email_template/acme.welcome?state=draft&member=zh-CN` reads the `zh-CN` draft a list entry names, and `?member=` on publish, history, revert and reset addresses it the same way. For a commit item, `member` is the language the stored revert plan records, the one a revert of that commit acts on.

**For code that uses these packages directly** (`@objectstack/metadata-protocol`): `ObjectStackProtocolImplementation.listDrafts` entries and `listCommits` items have the optional `member` described above. The types `ListDraftsResponse` and `ListPackageCommitsResponse` (`@objectstack/spec/api`, which `@objectstack/client`'s `meta.listDrafts` and `packages.listCommits` return) gain the same optional field. Code that does not read it behaves as before.
