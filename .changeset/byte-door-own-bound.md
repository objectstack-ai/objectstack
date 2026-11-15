---
'@objectstack/spec': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/service-storage': patch
---

fix(storage, plugin-hono-server): every byte-reading upload door holds a body with no declared length to its own bound, exactly as it holds a declared one

Clause-②: yes (widening) — `IHttpRequest.rawBody` takes an optional `{ maxBytes }`: the bound the reading door states, which an implementation holds whether or not the request declares a length (a declared length over it is refused unread, a body with no declared length is refused once it passes it and read no further, exactly the bound is read whole), refusing with `413` `PAYLOAD_TOO_LARGE`. A call without it reads the whole body, as before, and an implementation that takes no argument still type-checks.
Metadata-protocol: none

- **The contract.** `IHttpRequest.rawBody(options?: { maxBytes?: number })`. A refusal rejects with an error carrying `status` 413 and `code` `PAYLOAD_TOO_LARGE`; the door answers it with its own refusal, and one that lets it escape is answered `413` `PAYLOAD_TOO_LARGE`. Repeated calls answer what the first read: the same bytes, judged against each call's bound, or the first refusal. The `body` contract now also names the transport's `413` refusal and the one way out of it: a door that then reads `rawBody` takes the read over under its own bound, which it owes to `rawBody`.
- **`@objectstack/plugin-hono-server`** holds `maxBytes` on every path a byte door reads through, a body a JSON or form pre-read already held included, and stops reading where the bound is passed.
- **`@objectstack/service-storage`.** The chunk `PUT` states what `max_upload_mb` leaves the chunk, the presigned local raw `PUT` and the upload-link `PUT` state `max_upload_mb`, and the upload link's several-file form, taken over past the transport's limit, states its form limit. Each answers its own `413` `PAYLOAD_TOO_LARGE` when the read is refused. The upload-link `PUT` also judges the link (open, unexpired and the caller's) before it reads a byte of the body; a body that declares more than the door takes is still refused first, as before.
- **Unchanged:** with `max_upload_mb` unset a byte door states no bound and reads the whole body, as before.

**Who moves:** a host that implements `IHttpRequest` itself and serves `rawBody` should honour `maxBytes`; until it does, the storage doors still judge the bytes they read after the read, as before. A route of your own that reads `rawBody` and has a bound should pass it.
