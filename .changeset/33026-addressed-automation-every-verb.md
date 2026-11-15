---
'@objectstack/runtime': patch
---

fix(runtime): an addressed `/automation/:ns/:name/(runs|trigger)` route under a verb it does not serve answers the automation domain, as its bare path does

Clause-②: no
Metadata-protocol: none

On the standalone server (the dispatcher plugin on an HTTP adapter), an address is served exactly as its bare path (ADR-0150 D5), but a verb the route is not served under was answered differently on the two. `DELETE /api/v1/automation/send_digest/runs` answered the automation domain's `405` with `Allow: GET` in the dispatcher's envelope, and `401 UNAUTHENTICATED` to an anonymous caller. `DELETE /api/v1/automation/crm/send_digest/runs` answered the transport's `405` with `Allow: GET, HEAD` and an `error.details` envelope, to an anonymous caller too. The same held for `POST` / `PUT` on the addressed `/runs`, `GET` on `/automation/NS/NAME/trigger` and `GET` on `/automation/trigger/NS/NAME`.

The dispatcher now declares those three addressed shapes as routes whose domain decides every verb, as it already did for their bare two-segment shapes. Each of them answers an anonymous caller `401`, and a signed-in caller the domain's `405` with the verbs the route serves (`Allow: GET` for `/runs`, `Allow: POST` for both triggers) in the dispatcher's envelope. A served verb on an address (`GET .../runs`, `POST .../trigger`) is unchanged, and so is a three-segment path whose first segment is no installed namespace: under an unserved verb it now answers the dispatcher's `404 ROUTE_NOT_FOUND`, as the same path does under `GET`.
