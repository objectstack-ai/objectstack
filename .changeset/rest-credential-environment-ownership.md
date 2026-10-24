---
'@objectstack/rest': patch
---

fix(rest)!: a credential is honoured only in the environment whose auth service validated it, on every route behind the shared auth gate

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A request-time authentication check in the REST transport: no key of any metadata schema is removed, renamed or re-shaped, no export, type or error code is removed or renamed, and the refusal reuses the existing anonymous-deny response. There is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the REST transport (ADR-0006: auth is per-environment).

- **Before.** When the environment a request resolved to had no `auth` service of its own, the REST server validated the caller against the default environment's `auth` service and served the request. Only `GET /ui/view/:object/:type` compared the two environments.
- **Now.** `enforceAuth`, the shared gate every data-plane route calls, compares the environment that validated the credential with the environment the request resolved to, and refuses a mismatch with the same `401` and body an unauthenticated request receives. This covers crud, data-action, import/export, batch, sharing, approvals, analytics, search, security and the other routes behind that gate, on both the scoped (`/environments/:environmentId/...`) and the unscoped mount.
- **Unchanged.** A credential validated in the environment it targets is served exactly as before, and so is every request on a single-kernel deployment, where the one auth service answers for the one environment. Control-plane requests, which resolve no environment, are not compared.
- **Who sees it.** Only a multi-environment host whose per-environment kernels carry no `auth` service while the default environment's does. Such a request now answers `401`.

**The remedy.** Give each environment's kernel its own `auth` service, and sign in to the environment you call.
