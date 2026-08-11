---
"@objectstack/rest": patch
---

Give `POST /api/v1/packages/publish` an owner on every boot (#7563)

On a live showcase boot, `POST /api/v1/packages/publish` answered **405** with
`Allow: DELETE, GET, HEAD, PATCH`. Not one of those verbs belongs to the publish
surface — `POST` is the only verb it has ever had. They are `/packages/:id`'s
method set, offered because with the publish route unmounted that pattern was
the only registration still matching the path, with `id = "publish"`. A caller
was told "this path exists, use another method", and every method on offer would
have operated on a package literally named `publish`.

Two facts produced it, and both are repaired.

The REST package registrar was gated on `ctx.getService('package')` resolving at
the single instant `RestApiPlugin.start()` ran. `objectstack serve` registers the
capability providers (`requires: ['marketplace']` → `PackageServicePlugin`)
*after* `createRestApiPlugin`, and start order follows registration order for
plugins with no dependency edge between them — so the deployments that do
compose a package service are precisely the ones that answered "no" at mount
time. The service is now handed to the registrar as a resolver and read per
request, which makes the answer independent of composition order instead of
silently encoding it.

And `POST /packages/publish` has no dispatcher twin, so "not mounted" never
degraded to the 404 the composition documented — it degraded to a sibling's 405.
It therefore mounts unconditionally and answers its own honest 404, naming the
surface rather than a package id, where no package service is composed. The
other three package routes deliberately do **not** follow: each shadows a live
dispatcher twin at a byte-identical pattern, so mounting them without a service
would replace three working routes with a degraded refusal.

The route-ledger ↔ live-mount parity gate (#7526) had this row **pinned** as
unobservable, reasoned as "the registrar is service-gated and this boot composes
none". The reason was true and the conclusion was wrong: an unmounted route is
not automatically an unanswered one. The pin is deleted (the route is now
observable for real), and the pin rule itself is tightened — a pinned path that
some *other* pattern answers now fails the gate, because that is the disguise
the gate already refuses for every unpinned row.
