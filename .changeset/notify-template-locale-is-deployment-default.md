---
'@objectstack/spec': patch
---

`NotifyConfigSchema.template` now states the locale semantics the delivery path actually enforces — the deployment default, not a per-recipient locale

The `notify` node's localizable path (`template` → a `sys_email_template` bundle)
was documented in `packages/spec/src/automation/io-node-config.zod.ts` as
resolving `(name, recipient locale)` **per recipient** at delivery time, and the
`template` `.describe()` added that it "renders subject/body per recipient".
Read plainly — and it is the text a consuming app's author reads — that says the
recipient's own language selects the template row.

It does not, and deliberately does not. The delivery path
(`service-messaging/src/email-channel.ts`) has said so honestly at its own
`getDefaultTemplateLocale` all along: the platform has no per-user locale
(`sys_user` carries no locale column), and request-scoped locale
(`Accept-Language` → `ExecutionContext.requestLocale`) does not exist at async
delivery time, so "recipient locale" resolves to the **deployment default**,
`II18nService.getDefaultLocale()` — the same ruled source the auth emails use.
The one lever is `payload.locale`, and that is interpolated **once, before
fan-out**, so it is a single value for the whole notification at all three
`channel.send` call sites (`fanOut`, the outbox single-delivery path, and
`processDigestGroup`).

The gap mattered because the wording licensed exactly one conclusion — "convert
the nodes and non-English users get non-English notifications" — which is false,
and acting on it is a **net regression**: `TEMPLATE_*` failures classify
`permanent` and dead-letter, and the inbox channel starts requiring an email
service with `renderTemplate()` where inline text needed none. So the drift was
not a cosmetic imprecision; it was an instruction to make a change that loses
deliveries.

Per the maintainer ruling of **2026-08-13**, the behaviour is the settled side —
a per-user locale is deferred until measured pull — so the prose is the side that
moves. All five "recipient locale" sites in the file now name the resolved value:
the schema doc block, the `template` field's JSDoc and `.describe()`, and both
`superRefine` refusal messages. Each says the locale is `payload.locale` if the
producer set one, else the deployment default, and that it is **one value per
notification, not one per recipient**, with the 2026-08-13 deferral dated in
place so the limitation reads as a decision with provenance rather than a
permanent property of the design — a per-user locale layers in as an override at
that same seam when it lands.

Text only. No schema accepts or refuses anything it did not before, no delivery
behaviour moves, and no wire value changes — `packages/spec` publishes
`src/**/*.zod.ts` and the generated reference page, so the corrected wording
ships to consumers reading either. The pins in
`io-node-config.test.ts` that asserted the old `/recipient locale/` string now
assert the qualification itself, and refuse a bare "recipient locale", so a
future edit cannot quietly restore the promise.
