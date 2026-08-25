---
"@objectstack/spec": minor
---

feat(spec): retire `SendTemplateInput.org` — the declared org-overlay resolution tenant id nothing ever read (#11832, ADR-0049 enforce-or-remove)

<!-- adr-0087: registered send-template-input-org-retired -->

**BREAKING** accept-set narrowing (compile-time), landing after the v17.0.0 cut
(the lockstep launch-window convention ships it as `minor`; the migration
prescription is registered under protocol major 18, where `os migrate meta`
users will look).

**Removed member:** `SendTemplateInput.org` (`packages/spec/src/contracts/email-service.ts`).

The member was declared as "Tenant id for org-overlay resolution (when
supported)" and no implementation ever read it: `@objectstack/plugin-email` —
the only `IEmailService` implementation — resolves templates on
`(name, locale)` only, so a caller passing `org` got no org-overlay resolution
and no error; the "(when supported)" hedge was the declaration admitting the
gap. After #11741 landed `organizationId` beside it, `SendTemplateInput`
carried two org-shaped keys of which one did nothing — exactly the shape that
invites an AI author to pick the wrong one.

**FROM → TO:** `sendTemplate({ template, to, org: tenantId, … })` →
`sendTemplate({ template, to, … })` — delete the `org` key; it never changed
behaviour, so removing it changes none either. It is **NOT** replaced by
`organizationId`: that member is the delivery row's tenant stamp
(`sys_email.organization_id` pass-through, #11741) and opts into no template
overlay resolution.

**What is refused:** authoring `org` in TypeScript is now an excess-property
`tsc` error (`SendTemplateInput` is a programmatic contracts interface with no
Zod surface, so the compiler is the enforcement channel — pinned in
`email-service.test.ts`). Runtime behaviour is unchanged: nothing ever read
the member, so a JavaScript caller still passing `org` keeps its exact
pre-removal outcome (the key is carried inert and ignored).

**What stays:** `SendTemplateInput.organizationId` and
`SendEmailInput.organizationId` (#11741, Decision 2 of #11303) are untouched,
semantics included. `RenderTemplateInput` never carried `org`. D3 semantic
entry `send-template-input-org-retired`; no D2 conversion, because the key
only ever appeared in a call-time input bag — no metadata seam ever runs on it
(the `data.engine.update options.upsert` precedent).
