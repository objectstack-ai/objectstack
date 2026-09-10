---
"@objectstack/plugin-auth": patch
---

`runAdminImportUsers`'s hand-written `ImportProtocolLike` reads the CANONICAL QueryAST (`where` / `limit`) — the payload `@objectstack/rest`'s import runner sends as of this same release — instead of the wire-only `$filter` / `$top`.

`POST /api/v1/auth/admin/import-users` reuses the shared import runner but swaps in an identity-specific protocol, because an identity write is `auth.api.createUser` and not an engine insert. That protocol is hand-written, so it never passes through `ObjectStackProtocolImplementation` — the normalizer that folds `$filter` onto `where` and `$top` onto `limit` for a caller arriving off the HTTP door. It has to read the canonical keys itself.

- **A mismatch here does not produce a missing filter, it produces an unbounded one.** `const where = args?.query?.$filter ?? {}` turns an unread key into an empty filter, and an empty filter constrains nothing: the upsert duplicate probe stops discriminating, `findExisting` matches rows it was given no key for, and an admin import updates the WRONG user. Both halves are measured in `admin-import-users.test.ts` — the email-match case reported `updated: 2` where one of the two rows was new, and the phone-match case sent a probe carrying no `where` at all.
- **One dialect, and no default behind it.** The two reads are now `args.query.where` and `args.query.limit`, with no `??`. A default here would not be tolerance for an older caller — this handle is fed by the runner, never off the wire — it is precisely the lenient fallback that converts a spelling mismatch into a silent match-everything. A request that arrives without a `query` now costs a loud `TypeError` instead.

⚠️ No published version shipped the mismatch. The runner's rewrite and this adapter land in the same release, and `@objectstack/plugin-auth` depends on `@objectstack/rest` at an exact workspace version, so the two cannot be installed apart. What this entry records is why they move together — and what the same mismatch costs any OTHER hand-written `ImportProtocolLike`, which the `@objectstack/rest` entry calls out for implementors.
