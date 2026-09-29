---
"@objectstack/rest": patch
---

**The layered view, `GET /api/v1/meta/:type/:name/layers` and the deprecated `?layers=true` flag, now answers a name with nothing behind it with the plain read's `404 RESOURCE_NOT_FOUND`, the answer it already gave a member for an unpublished app.** Before this release, a name with no layer behind it answered `200` with `code`, `overlay` and `effective` all `null`. A member asking for an unpublished app got `404`, so the difference between the two answers told the member which unpublished apps exist. ADR-0045 §3 declares a hidden app externally unobservable on every surface, and the plain read already kept that promise. This follows triage's grade on #20507.

Clause-②: no

- **What changed:** `createMetaLayeredAnswer`, the one chain both transports call after the store read (`RestServer` and the runtime dispatcher's `/meta` domain), answers a layered read with no layer present as the name's absence, before the per-caller gate runs. Each transport writes that absence in its own envelope, the one it already uses for an unpublished app: `RestServer`'s nested `{ error: { code: "RESOURCE_NOT_FOUND", message } }`, and the dispatcher's `404` error envelope. The flag's `Deprecation` and `Link` headers still ride that answer.
- **Who it applies to:** every caller. The plain read answers an absent name `404` whoever asks, and so does the layered view now. A builder (`studio.access` or `setup.access`) is still served an unpublished app on both spellings. A `?package=` scope that leaves no layer behind the name is that name's absence too.
- **Unchanged:** a name with any layer behind it is judged and served exactly as before. An item whose code layer is scoped away by `?package=` but whose overlay row answers is still served, with `code: null`.

A client that read `/layers` for a name that has never been published, and took a `200` with every layer `null` as "not saved yet", now receives `404`. Treat that `404` as the same answer. Studio's metadata client already maps a `404` from this route to every layer `null`, so the designer's "open an item that exists only as a draft" path is unchanged.
