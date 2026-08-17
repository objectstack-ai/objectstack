---
"@objectstack/spec": patch
---

fix(spec): correct `MongoConfigSchema.options`'s field description to state the actual refusal boundary — only `auth.password` is refused inline; `proxyPassword`, `tlsCertificateKeyFilePassword`, `key`, and `passphrase` are accepted, stored at rest in cleartext, and redacted only on read (#9254)

The old string claimed "credential material is refused" for the whole `options`
passthrough. That was true for exactly one nested path
(`options.auth.password`, `MONGO_OPTIONS_CREDENTIAL_PATHS` / #9040) — four
other honoured, credential-shaped keys were never refused, only redacted when
a datasource is read back (`PASSTHROUGH_SECRET_PATHS` in
`datasource-credential-redaction.ts`). This string renders verbatim into
`content/docs/references/data/driver-mongo.mdx` and the Studio "Add
Datasource" connection form's field help text, so an author configuring a
proxy password or a TLS key passphrase was told it would be refused when it
would actually be accepted and stored in cleartext.

Describe-only: no schema shape or refusal-path change — every previously-valid
`options` input still parses byte-identically. The corrected text agrees with
the accurate statement #9124 landed in `content/docs/data-modeling/drivers.mdx`.
