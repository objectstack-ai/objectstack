---
'@objectstack/spec': patch
---

spec: `WebhookSchema` declares `secret` (a credential value) and `headers` (a credential map, as a whole) with `.meta({ credential: 'value' | 'map' })`, and `getMetadataTypeRedactor(type)` gains a third resolution — after explicit registrations and built-ins — a redactor derived from the credential markers on the type's registered schema. Every meta read door now withholds a webhook's `secret` and `headers`, with or without `@objectstack/plugin-webhooks` mounted (ruling B+ on #24966).

Clause-②: no (narrowing) — the `/meta` read doors return less for `webhook`: a stored `secret` or non-empty `headers` map is dropped from the served item and named in `redactedKeys`; the cleared forms (an empty string, an empty map) are served as written. A save that omits the two fields keeps the stored values (the metadata protocol's carry-forward); to remove a credential, save its cleared form. The dispatcher reads the declaration itself, so delivery signing is unchanged.

A metadata type that stores a credential in a declared field marks it on its schema instead of registering a redactor; a spec ratchet reds on a credential-named field that carries no marker.
