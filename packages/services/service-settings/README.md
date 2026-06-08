# @objectstack/service-settings

Settings service for ObjectStack. Implements ADR-0007: a generic
namespace **manifest** mechanism + a single K/V table (`sys_setting`) +
a resolver that layers `OS_* env > Tenant > User > Default`.

## What it gives you

- `SettingsServicePlugin` — registers the `sys_setting` schema, exposes
  a `settings` service in the kernel, and mounts REST routes on the
  HTTP server (when one is available).
- `SettingsService` (`kernel.getService('settings')`)
  - `get(ns, key, ctx)` / `getNamespace(ns, ctx)` — resolved values with
    `{ value, source, locked }`.
  - `set(ns, key, value, scope, ctx)` / `setMany(...)` — writes that
    persist into `sys_setting`. Throws when the effective value is
    locked by env.
  - `registerManifest(manifest)` / `listManifests()` / `getManifest(ns)`.
  - `runAction(ns, actionId, input, ctx)` — for "test connection",
    "rotate", etc. declared in `action_button` specifiers.
- REST routes (default base path `/api/settings`):
  - `GET    /api/settings`                       → manifests visible to caller
  - `GET    /api/settings/:namespace`            → `{ manifest, values }`
  - `PUT    /api/settings/:namespace`            → batch upsert
  - `POST   /api/settings/:namespace/:actionId`  → invoke declared action

## Env override

`process.env[OS_NAMESPACE_KEY]` (uppercased, with dots / hyphens converted
to underscores) takes precedence over any stored value. For example,
`mail.smtp_host` resolves from `OS_MAIL_SMTP_HOST`, and
`feature_flags.ai_enabled` resolves from `OS_FEATURE_FLAGS_AI_ENABLED`.
Such fields are returned with `source: 'env', locked: true` and writes
(service or REST) fail with HTTP 409.

## Encryption

`Specifier.encrypted: true` (implicit for `password`) routes the value
through a pluggable `ICryptoProvider` into `sys_secret`; only an opaque
handle id lands in `sys_setting.value_enc`. The same provider backs every
secret-at-rest in the platform: encrypted settings, ObjectQL `secret`
fields, and runtime datasource credentials.

### Default provider: `LocalCryptoProvider`

The default is `LocalCryptoProvider` — AES-256-GCM keyed off a single
32-byte data key. It resolves its key in order:

1. **`OS_SECRET_KEY`** — the canonical production master key (32-byte hex
   or base64). Set this in any container / multi-node deployment.
   Generate one with `openssl rand -hex 32`. It **must be identical**
   across every restart and every node, or previously-encrypted secrets
   become undecryptable.
2. `OS_DEV_CRYPTO_KEY` — dev convenience key (same format).
3. A persisted file at `~/.objectstack/dev-crypto-key` (mode 0600). In
   development this is auto-created so single-host dev loops survive
   restarts; in production it is only *read*, never minted.

**Fail-loud in production.** When `NODE_ENV=production` and no stable key
source (env var or pre-existing file) is available, the provider refuses
to start with an actionable error instead of silently generating an
ephemeral key. This turns the old silent-data-loss footgun — every
`sys_secret` value becoming undecryptable after a container restart or on
a second node — into a config error at boot.

Secrets surviving a restart is **correctness, not a premium feature**, so
`LocalCryptoProvider` and the env-key path are open-source. KMS / Vault
providers (managed custody, per-tenant keys, automatic rotation) plug in
behind the same `ICryptoProvider` seam via `cryptoProvider` plugin option.

> `InMemoryCryptoProvider` is a deprecated alias for `LocalCryptoProvider`
> (the old name wrongly implied an ephemeral key).

The legacy `CryptoAdapter` / `NoopCryptoAdapter` (a base64 wrapper) remains
only as a pre-Phase-3 backward-compat path when no `cryptoProvider` is wired.

## Audit

Every write emits a `sys_audit_log` row (when the audit service is
present). Encrypted values are masked with `'<encrypted>'` + checksum.

## Always-on default

`SettingsServicePlugin` is part of the **default capability slate** —
it is auto-mounted by `objectstack serve` (any preset except
`--preset minimal`) and by `mountDefaultProjectPlugins()` on every
per-project kernel on hosted objectos. Apps no longer need to declare
`requires: ['settings']`. Apps with zero registered manifests pay
no runtime cost (the registry is empty, no routes fire).

The Settings hub in `apps/console` therefore appears in every app, and
the following built-in manifests are pre-registered out of the box:

| Namespace      | Owner plugin                | Highlights                                  |
|----------------|-----------------------------|---------------------------------------------|
| `mail`         | `EmailServicePlugin`        | SMTP / Resend / Postmark + `mail/test`      |
| `storage`      | `StorageServicePlugin`      | Local FS / S3 + encrypted secret + `storage/test` |
| `branding`     | (built-in fallback)         | Workspace name, logo, accent colour         |
| `feature_flags`| (built-in fallback)         | Opt-in experimental features                |

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
