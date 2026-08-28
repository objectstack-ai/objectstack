---
"@objectstack/spec": patch
"@objectstack/service-datasource": patch
---

docs(spec,service-datasource): `CryptoContext` documents the three producer vocabularies, and the AAD sentence narrows to the guarantee that holds (#12599)

Documentation-only correction to the `ICryptoProvider` contract. No behavior
changes and no schema shape changes: `gen:schema`, `gen:openapi` and `gen:docs`
all regenerate byte-identically over this diff. It ships because the corrected
TSDoc is emitted into the published `.d.ts`, so it is what every consumer of
`@objectstack/spec` reads at the call site.

`CryptoContext.namespace` / `.key` documented themselves as a settings
coordinate ("Settings namespace the value belongs to" / "Specifier key within
the namespace"), one layer below the three producers that actually construct
the type:

| producer | `ctx.namespace` | `ctx.key` | where `handle.id` is recorded |
|---|---|---|---|
| `SettingsService` | settings namespace | specifier key | `sys_setting.value_enc` |
| the ObjectQL engine's secret-field path | **object name** | **field name** | a `secret:` ref on the business row |
| the datasource secret binder | caller-supplied, default `datasource` | datasource name | a `sys_secret:` credentialsRef |

The prose now names all three, and `CryptoHandle.id`, `encrypt()` and
`rotateKey()` no longer describe `sys_setting.value_enc` as the general
destination of a handle.

The load-bearing half is the AAD sentence. It read "Helps reject ciphertexts
that were copied across namespaces", which overstates what a binding over this
pair can provide: `(namespace, key)` is **one flat space shared by all three
vocabularies**, `sys_secret` declares the pair non-unique by design, and nothing
reserves a name in one vocabulary against another. The sentence is replaced by
the guarantee that actually holds — such a binding rejects a ciphertext swapped
between two coordinates *within one producer's vocabulary*, and does **not**
exclude a cross-vocabulary pair. The docblock records this as the contract's
present state and names the intended end state (a producer-discriminated AAD)
so the weak guard is not read as the designed one.

The same settings-only prose on `DatasourceSecretBinderDeps.namespace`
("Settings namespace recorded on the secret row") is corrected in the same
change.

Recorded under the maintainer ruling of 2026-08-27 on #12599 (Option A now,
with the producer-discriminated AAD recorded as direction in its own ADR).
