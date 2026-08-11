---
"@objectstack/objectql": patch
---

fix(objectql): keep every locale of a declared i18n bundle in the registry (#7730)

`EmailTemplateDefinitionSchema` declares that "multiple rows with the same `name`
but different `locale` form an i18n bundle" and that a template "is resolved by
`(name, locale)`". `SchemaRegistry.registerItem` keyed every item by its name
alone, so the second locale of a name collided with the first, went through the
`[Registry] Overwriting email_template: …` path, and replaced it. A stack
authoring an en-US and a zh-CN copy of one template materialized ONE row into
`sys_email_template`: declared, not enforced. The translated mail simply never
went out, with no error anywhere.

**The key now carries the identity the spec declares.** A metadata type may
declare a discriminator (`ITEM_KEY_DISCRIMINATORS` in `registry.ts`); an item of
such a type is stored under `<packageId>:<name>@<discriminator>`, so the bundle's
members coexist. `email_template` / `locale` is the only entry today, and the
key computation is otherwise byte-identical — every other metadata type keeps
name-only identity and last-write-wins, which a pin test asserts. An item that
declares no locale is keyed as the canonical member, so `{ name }` and
`{ name, locale: 'en-US' }` remain one template and re-registration stays
idempotent.

**Reads make the round trip whole.** Storing both rows is only half a fix if a
lookup then returns an arbitrary one, so a bare-name read of a bundled type
resolves through the same precedence tiers as before — ADR-0005 overlay, then
ADR-0048 prefer-local, then first composite — and picks the canonical (`en-US`)
member inside the winning tier, which is the locale `sendTemplate` already falls
back to. `getArtifactItem` keeps serving the packaged member over an overlay,
and withdrawal by name (`unregisterItem`, `removeOverlayEntry`,
`removeRuntimeShadow`) takes the whole bundle rather than one member, matching
the consumer side where `deactivateDeclaredEmailTemplate` sweeps
`sys_email_template` by name across locales because a delete event carries no
locale.

For an app this shows up as declared email templates finally materializing per
locale: authoring `auth.welcome` in en-US and zh-CN now produces two
`sys_email_template` rows, and `IEmailService.sendTemplate` can pick the
recipient's language instead of whichever locale happened to be declared last.
