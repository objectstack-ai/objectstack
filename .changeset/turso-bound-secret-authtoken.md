---
"@objectstack/service-datasource": patch
---

fix(service-datasource): read a turso datasource's bound secret into `authToken` (#8152)

A turso datasource created after #8078 could not be authenticated by any route
an author has. #7990/#8078 made `config.authToken` a refused inline credential
(`z.never()`) at every authoring door, exactly like the SQL drivers'
`config.password`, and diverted the author to the secret binder:
bind the credential, keep only `external.credentialsRef` on the record. The
connect path resolves that ref and hands the cleartext to the driver factory as
`spec.secret` — and **nothing on the turso path read it**.
`buildTursoDriverConfig` consulted `config.authToken` alone, so the resolved
secret was dropped and the connection was attempted unauthenticated:

```
buildTursoDriverConfig({driver: 'turso', config: {url: 'libsql://my-db.turso.io'},
                        secret: 'THE-BOUND-JWT', external: {credentialsRef: 'sys_secret:abc'}})
  →  { url: 'libsql://my-db.turso.io' }        // no authToken
```

`authToken` now reads `spec.secret` first and falls back to `config`, which is
**exact parity with the postgres / mysql / mongodb arms** in the same package
(`spec.secret ? { password: spec.secret } : cfg.password ? { password: cfg.password } : {}`).
No new mechanism, no spec change, no second binder slot: the credential was
already reaching the builder on the spec it is handed, and this restores the
one slot turso already has.

Nothing that worked before changes. `config.authToken` stays readable, and the
fallback matters beyond legacy rows: the CLI and standalone hosts translate
`OS_DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN` into a `config` they construct
themselves, which never meets the authoring schema that refuses the key. An
empty `spec.secret` is treated as unset and falls through to `config`, matching
this builder's existing rule for string keys.

The gap was invisible because it broke nothing already running — a stored row
bypasses the parse and still connects, so only NEW authoring was dead — and
because `turso-driver-config.test.ts` had no `secret` case at all. It has one
now, plus an end-to-end pin that authors a datasource through the real admin
door, binds the secret, resolves it through the real connect path, and asserts
the credential arrives (`turso-bound-secret-authoring.test.ts`).

#8078's refusal of the inline key is untouched and pinned in both places.
`encryptionKey` is deliberately out of scope: it is a different secret, the
binder has one slot, and whether it needs a second is a separate decision.
