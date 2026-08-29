---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a metadata app's MARKED refusal is classified as a refusal at the producer, instead of being wrapped as a store outage (#12536)

A metadata app's sandboxed hook on `sys_metadata` can refuse a read and mark its
refusal with `userMessage` — the #9934 producer-side opt-in where the field's
presence *is* the marking. Every such refusal was handed to
`metadataStoreUnavailableError`, which builds a fresh `Error` carrying only
`code` / `status` / `cause`, and `declaredUserMessage` reads the **top level**
and never `cause`. The mark therefore died at the producer, on the whole
`getMetaItem` / `getMetaItems` read family and on `deletePackage`.

**FROM** — a marked hook refusal and a `connect ECONNREFUSED` came out of
`getMetaItems` as the same envelope, and no consumer could tell them apart:

```
MARKED hook refusal  -> 503 SERVICE_UNAVAILABLE  declaredUserMessage=undefined
                        "The metadata store could not be read, ..."
driver fault         -> 503 SERVICE_UNAVAILABLE  declaredUserMessage=undefined
                        "The metadata store could not be read, ..."
```

**TO** — the failure is classified once, at the producer, before it is wrapped:

```
MARKED hook refusal  -> 400 (or the status the hook declared for itself)
                        userMessage = the author's text, verbatim
driver fault         -> 503 SERVICE_UNAVAILABLE  (byte-for-byte unchanged)
                        "The metadata store could not be read, ..."
```

`deletePackage`'s per-item path follows the same classification: `failed[]` and
`cleanups[]` gain an optional `userMessage` member, present exactly when the
item's own failure declared the mark. Those rows ride inside a
`PACKAGE_DELETE_PARTIAL` 400's `details`, where no HTTP boundary can carry a
`userMessage` on their behalf, so the channel has to exist on the row itself.
`deleteMetaItem`'s two re-wrap exits carry the mark forward for the same reason
they already carry a catalogued `code`.

Maintainer ruling 2026-08-27, option B. The declined alternative — forwarding
the mark *across* the 503 — is not implemented and is pinned against: the
store-unavailable door still quotes nothing from `cause`, and a test asserts the
underlying failure text appears in no field outside it.

**Behaviour that does not change.** An unmarked failure keeps the #8136 503
exactly as it was: same status, same code, same sentence, same `cause`
relocation. A blank, whitespace-only or non-string `userMessage` is not a
declaration, so nothing invents a marked refusal, and the #3821 generic
substitution stays in force for everything unmarked.

**For hook authors.** A refusal that names its own `status` / `statusCode`
keeps it (#7867). One that names none is answered 400 — the same default the
REST sandbox door already applies to an undeclared hook refusal (#9967) — with
the catalogued code for that status; declare `status` (and a catalogued `code`)
when a different classification is wanted.
