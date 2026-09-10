---
"@objectstack/rest": patch
---

fix(rest): `GET /meta/object/:name/state/:field` tells a wired-and-failing engine apart from an absent one (#15405)

`objectQLProvider` has two consumers in `rest-server.ts`. #13476 repaired one of them — the `computeExecCtx` authorization-input seam — by reaching the provider through `wiredEngineOrLoud`, which keeps "no engine is wired" and "the engine was wired and could not be resolved" as two facts instead of one `undefined`. This route, the slot's second consumer, reached it through `.catch(() => undefined)` and converted every rejection straight back into the `undefined` a never-registered engine produces, three lines before the answer is chosen. So a wired-and-failing engine and a never-registered one both answered `404 NOT_FOUND · "Object not found"` — a diagnostic route lying about the cause during exactly the incident it would be consulted in.

That line was newly load-bearing rather than long-broken: before #13904 the shipped provider was `try { … } catch { return undefined; }` and could not reject at all, so the `.catch` was dead code. #13904 made the provider re-raise precisely so a consumer could see the outage, and this consumer caught it back.

**What moves.** On this route only, an engine that is wired and fails to resolve now answers `503 SERVICE_UNAVAILABLE` instead of `404 NOT_FOUND` — the same answer its sibling seam and the package door (#13476) already give for the same fault. No accept set widens and no new wire code is minted: `SERVICE_UNAVAILABLE` is an existing `StandardErrorCode` member, reached through the existing `AuthzStoreUnavailableError`.

**What does not move.** An engine that was never wired, and a provider that resolves `undefined` (the seam contract declaring absence rather than failing), both keep the `404 NOT_FOUND` they answered before — that is the supported no-data-plane composition. A healthy engine asked about an object that genuinely does not exist still answers `404 NOT_FOUND`; a healthy engine asked about an object that exists is still served.

**Reachability, stated rather than implied.** Every `/meta` route sits behind the anonymous-deny gate, and that gate resolves the same engine first. Where it takes its provider branch (a single-kernel boot such as `pnpm dev:crm`) a broken engine already raised there, before this route's line ran — so nothing changes for those deployments. The collapse was reachable where a resolvable kernel supplies auth and the separately-wired `objectQLProvider` is broken, which is the multi-kernel wiring, and that is where the new answer lands.

`POST /email/send` carried the other retired `.catch(() => undefined)` in the same file and moves to `seamOrUndefined`. Its answer is deliberately unchanged at `501 NOT_IMPLEMENTED`; what changes is that a host wiring a **non-`async`** provider — which the seam's declared type cannot prevent — now reaches that same 501 instead of throwing past a `.catch` that did not exist yet and landing in the handler's own `500 EMAIL_SEND_FAILED`. Not reachable from the shipped wiring, where both providers are declared `async`; repaired because it is the same spelling at an embedder-reachable seam.
