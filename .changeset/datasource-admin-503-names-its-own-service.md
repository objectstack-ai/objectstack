---
"@objectstack/service-datasource": patch
---

fix(service-datasource): the datasource-admin 503 names the service the route actually needs (#4225)

`admin-routes.ts` registered nine service-backed routes behind one hard-coded 503:

```ts
const unavailable = (res) =>
  sendError(res, 503, 'SERVICE_UNAVAILABLE', 'The datasource-admin service is not available.');
```

Six of those routes resolve `datasource-admin`, so the message was right. Three
resolve `external-datasource` — `GET /:name/remote-tables`, `POST /:name/test`,
`POST /:name/object-draft` — and answered with the same sentence. An operator
whose federation service was unwired was told to go look at `datasource-admin`,
which was running fine.

The code was never the bug. `SERVICE_UNAVAILABLE` is correct for all nine:
ADR-0112's ledger asks generic conditions to reuse the standard catalog rather
than register a per-service 503 synonym, and this module documents that decision
inline. Which service is down is carried by `message`, exactly as intended — the
`message` was simply wrong on three routes.

Rather than parameterise the 503 helper and leave the name typed out a second
time at each call site, the lookup and the message now come from one argument.
The two `adminService()` / `externalService()` resolvers collapse into a single
`resolve(res, service, method)` that answers the 503 itself, naming whatever
service it just failed to resolve:

```ts
const svc = resolve(res, 'external-datasource', 'listRemoteTables');
if (!svc) return;
```

Fixing the three messages needed only the parameter; taking the name from the
lookup is what stops a tenth route reintroducing the mismatch. The per-route
capability check is preserved — a host may wire a partial implementation, so
"the service is registered" and "this route can use it" stay separate facts.

Wire-visible change, on those three routes only: the 503 body's `error.message`
now reads `The external-datasource service is not available.` — the same string
`packages/rest/src/external-datasource-routes.ts` already emits for its own
surface. Status and `error.code` are unchanged on all nine.

Each of the nine 503s is now pinned to the service it names, driven through the
real `HonoHttpServer` against a context that resolves services **per name**. The
mock every existing test used answers the same object for every lookup, which is
why nothing could see this: it cannot tell the two services apart. One case
covers the operator's actual situation — `datasource-admin` wired and answering
200s, `external-datasource` absent — including `POST /:name/test`, where the
wired admin service has a `testConnection` of its own and must not answer for the
external route.

Pre-existing: #3843 carried every code string over verbatim and #3973 changed no
bytes on the wire.
