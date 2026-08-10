---
"@objectstack/rest": minor
---

fix(rest): a repeated `?version=` on `/packages/:id` is refused, not silently resolved (#6307)

`IHttpRequest.query` is declared `Record<string, string | string[]>` — a repeated
query parameter arrives as an **array**. Both `/api/v1/packages/:id` handlers read
it as a string and passed it straight to `PackageService.get/delete`, whose
parameter is `version?: string`. Measured on `main` before the fix:

```
GET    /packages/com.acme.crm?version=1.0.0&version=2.0.0
       → packageService.get('com.acme.crm', ['1.0.0','2.0.0'])
DELETE /packages/com.acme.crm?version=1.0.0&version=2.0.0
       → packageService.delete('com.acme.crm', ['1.0.0','2.0.0'])
       → 200 { message: 'Deleted com.acme.crm@1.0.0,2.0.0' }
```

The `DELETE` line is the sharp one. `if (!version && protocol.deletePackage)` is
what gates the **full uninstall** (#2747: the package's metadata rows, the durable
`sys_packages` record, and the registered data-plane cleanups — plugin-security
revoking its permission sets and bindings). Any truthy `version` skips it, so a
repeated parameter silently narrowed the *scope of the operation* on a destructive
verb and still reported success.

**Both verbs now refuse the ambiguity** with `400 VALIDATION_ERROR`
(`The "version" query parameter was supplied 2 times. Supply it at most once — this
endpoint will not choose between conflicting values.`). `?version=a&version=b` is a
well-formed request carrying two conflicting intents; picking one silently is a
wrong answer delivered as a `200`. The rule is identical on both verbs — one
parameter, one answer — and the code comes from ADR-0112's **standard** catalog
rather than a newly registered synonym, because "this request contradicts itself"
is a generic validation condition.

The rule is about **multiplicity, not shape**: the parameter may be supplied at
most once. A one-element array is one occurrence encoded differently by an adapter
and is accepted; an empty array is no occurrence. Two identical values are still
two occurrences and are still refused — "at most one *distinct* value" would be a
de-duplication rule no client can predict, while "supply it at most once" is
checkable client-side.

**Not tolerance for off-spec input.** The contract already declared the array; the
consumer simply never handled a shape it was told to expect.

**Nothing that works today changes.** A single `?version=1.0.0`, no `version` at
all, and an empty `?version=` all behave exactly as before — including the full
uninstall still being reached when no version is supplied. No in-repo caller,
documented example or SDK path repeats the parameter (`client.packages.get` builds
`?version=` from a single `version?: string`), so the new 400 is unreachable from
any supported client. It is `minor` rather than `patch` only because a request
shape that used to answer `200` now answers `400`.

Adapter note, measured over a real socket: the `node:http` adapter
(`NodeHttpServer`) hands `['1.0.0','2.0.0']` to the handler as the contract
declares, while the Hono adapter collapses a repeat to the first value before any
handler sees it. Both are contract-legal (the union permits either), which is
exactly why the consumer must handle the declared shape rather than depend on
which server booted.
