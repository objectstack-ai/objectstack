---
"@objectstack/client": minor
"@objectstack/rest": minor
---

fix(client,rest): state `SaveReportInput`'s requirements at the `reports.save` door (#11926)

**BREAKING** accept-set narrowing on `POST /api/v1/reports` and on the
`client.reports.save` parameter type, shipped as `minor` under the repo's
launch-window convention for breaking changes.

`IReportService.saveReport` takes a `SaveReportInput`, on which `name`, `object`
and `query` are all required. Nothing on the path said so. The SDK method
declared its parameter `any`, and the route forwarded `req.body ?? {}` straight
through, so the requirement held only as far as each reports implementation
chose to re-derive it privately — the bundled `@objectstack/plugin-reports` does
re-derive all three, but a third-party implementation need not, and a caller
could not tell which one it was talking to. This is the ADR-0078
declared-but-unenforced shape arriving at an authoring surface: the producer
accepted off-spec input and handed it to a service that requires more.

Both halves now state the contract:

- **`client.reports.save(report)`** takes `SaveReportInput` instead of `any`.
  Omitting `query` (or `name`, or `object`) is now a compile error at the call
  site rather than a surprise from whichever implementation is mounted. The SDK
  remains a transport and adds no runtime validation — it is not a second
  validator.
- **`POST /api/v1/reports`** refuses a body missing any of the three required
  keys, and a `query` that is not a `ReportQuery` envelope (a scalar or an
  array), with `400` / `VALIDATION_FAILED` — the same envelope the route
  already produced for a service-raised validation error (ADR-0112). A
  JavaScript or `curl` caller that never sees the TypeScript type is refused
  too. The refusal is ordered **after** the existing `501` for an unmounted
  reports service: "no reports service on this deployment" is a deployment fact
  and outranks anything about the body. An empty `query: {}` stays legal —
  every field on `ReportQuery` is optional — and is pinned as such.

**Migration.** A caller that omitted `query` was already relying on
implementation-specific behaviour; supply the `ReportQuery` envelope the report
should run (`{}` for "no filters"). Callers already sending a complete
definition are unaffected, and the bundled reports implementation already
refused all three omissions, so no deployment running it changes behaviour —
only the layer that produces the refusal moves, from the service to the door.

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing over keys that already exist and are already required by the service contract: no key is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. `SaveReportInput` is a cross-package TS contract with no spec schema and no stored-metadata form, so no authored artifact at rest carries the affected shape. What a query-less report definition was *meant* to query is authoring intent no migration entry can supply on an upgrader's behalf; the 400 at the door is the channel that reaches the author, naming the missing keys. Mirrors the disposition of the #11519 and #11842 accept-set narrowings. -->
