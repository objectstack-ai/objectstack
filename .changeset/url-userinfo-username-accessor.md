---
"@objectstack/spec": minor
---

feat(spec): export `urlUserinfoUsername` — the username half of the shared URL userinfo grammar (#8876)

`@objectstack/spec/data` owns the DSN userinfo grammar (`urlUserinfoPassword` /
`redactUrlPassword`, #8082/#8300) but exported only its password half. The
mongo DSN arm (#8696) must inject a bound `external.credentialsRef` secret via
`MongoClient`'s `auth` option, which requires the username the URL already
names — and reading it needs this grammar, because `new URL()` throws
`ERR_INVALID_URL` on the multi-host DSN form `MongoConfigSchema` documents
(`mongodb://app@h1:27017,h2:27017/app`, measured). A local copy in
`service-datasource` is the shape the #8082 single-parse ruling refuses by
name.

**Additive only.** The new accessor shares the password half's boundary parse
by construction (both now call one internal RFC-3986 userinfo parse), returns
the RAW component (percent-encoding preserved, decoding stays with the
caller), answers `''` for an empty username inside present userinfo and
`undefined` when the string carries no userinfo at all, and still parses the
publish-refused `user:password@` shape correctly — stored legacy rows carry
it, and #8155's migration path must judge exactly those rows. No Zod schema
changes: every input that validated before validates identically after; the
read-path redaction alignment pin now covers the username half too (redaction
preserves the username byte-for-byte).
