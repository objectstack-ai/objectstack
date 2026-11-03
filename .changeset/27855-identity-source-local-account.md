---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the Users identity source reads "Local Account" instead of "Env-Native"

Clause-②: no
Metadata-protocol: none

- **Identity Source.** A user who signed up with email and password, or an app end-user, showed the identity source "Env-Native", a word from the provenance design. The `env_native` option is now labelled "Local Account", beside the federated "IdP-Provisioned": the identity is held by this environment's own sign-in rather than by an identity provider. zh-CN reads 本地账号, ja-JP ローカルアカウント, es-ES Cuenta local.
- The stored value is unchanged: rows, the sign-up hook and the cloud-managed gating keep reading `env_native`.
