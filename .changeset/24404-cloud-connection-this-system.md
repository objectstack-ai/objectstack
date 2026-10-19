---
'@objectstack/cloud-connection': patch
---

Clause-②: no

fix(cloud-connection): the sign-in refusals and the unmanaged-install copy no longer call the running system "this environment"

- **What changed.** Inside the running system, user-facing copy names the system the user is in as "this system", or drops the noun. The seven `401 UNAUTHENTICATED` answers on `/api/v1/cloud-connection/*` now read "Sign in to connect a cloud account." (`bind/start`), "Sign in to install apps." (`install`) and "Sign in." (`bind/poll`, `unbind`, `installation`, `installed`, `org-packages`), where each used to say "Sign in to this environment …". On `/api/v1/marketplace/install-local`, the `409 RESOURCE_CONFLICT` that refuses a managed install over an unmanaged copy now names the holder as "the writable base 'BASE' — an unmanaged install of this package, or a base authored in this system — whose items are this system's own metadata", and the unmanaged install's success `note` reads "The package's metadata is now this system's own, in the base 'BASE' …".
- **Unchanged.** Every HTTP status, error code (`UNAUTHENTICATED`, `RESOURCE_CONFLICT`), `details` object and response shape. Server log lines are not touched.
