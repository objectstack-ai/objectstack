---
'@objectstack/plugin-email': patch
---

fix(plugin-email)!: the email template send judges the served holders, so a disabled package holds no name at the send (ADR-0150 D3)

Clause-②: yes (narrowing) — widened: a send of a template name an enabled and a disabled package hold, made with no package or from a caller whose closure holds both, is served the enabled holder's template where it was refused naming both. Narrowed: a send that only a disabled holder's side answered (its customization pair's row, a dependent's added locale, the environment's item or a package-less stored row beside a name only it holds) finds no template; a send of an auth name whose one overriding package is disabled is served the built-in copy. Refusals name only the packages that serve the name. With no holder of the name disabled, every answer is unchanged.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` and no page under `content/docs/**` teaches what an email template send answers when a package holding the name is disabled.

**BREAKING** for a send of an email template (`createRegistryEmailTemplateLoader`: the `sendTemplate` path and a flow's `notify` delivery) of a name a disabled package holds. Before, the send counted every holder, a disabled package's included: a disabled package was still the answer, and a refusal still named it. Now, when a holder of the name is disabled, the name is resolved over the served holders, and the bundle is read only where no member of a disabled holder's side is listed: the resolved holder's own address, or the built-ins' own address. A caller whose own holding is the disabled one, or that no served holder answers, finds no template. With no holder disabled, every read is the one it was.

Why the read is chosen and never filtered: the environment-wide execution list keeps a disabled holder's customization-pair rows and a dependent's added locales listed, and an item's `_packageId` there is the slot it fills, not the package that stores it (a pair row filling a dependent's locale wears the dependent's id; the environment's item over a disabled holder's slot wears the disabled holder's), so no member can be told apart after the read.

**Every moved answer, before → after.** Holders ALPHA and BETA; ALPHA's pair `ALPHA.custom` stores a member row; ADDER depends on ALPHA only and adds a locale. Both registration orders, the protocol's read and the registry's own read. First-party count 0: no first-party composition ships an email template name two packages hold, or disables a package that holds one.

Widening:

- Row 27. Two holders, one disabled, a send with no package (omitted or `null`): 409 naming both → the enabled holder's address (its template; a locale only the disabled side carries finds no template).
- Row 28. The same, from a caller whose closure holds both: 409 naming both → the enabled holder's address.

Refused, the disabled package no longer named:

- Row 29. Two holders, one disabled, a caller whose closure reaches the name only through the disabled holder (a dependent of it included): no template, or the disabled holder's pair row → 409 `outside-closure` naming the enabled holder.
- Row 30. Two holders, one disabled, a caller that reaches neither (the built-in package as caller included): 409 `outside-closure` naming both → naming the enabled holder.

Served or refused → no template:

- Row 31. Every holder disabled, every caller: 409 naming them, or the pair's row → no template.
- Row 36. Two holders, the disabled holder's own send: its pair's row → no template.
- Row 37. One holder, disabled, every caller: the environment's item, a package-less stored row, ADDER's locale or the pair's row (the environment-wide list), or 409 `outside-closure` naming it for a caller with no path → no template.

Re-targeted to the built-in copy:

- Row 38. An auth name (`auth.*`, platform-requested) whose one overriding package is disabled: every caller but that package → the built-ins' own address (the built-in template, or a package-less stored row there), where the environment-wide list sent the disabled package's side; ADDER's send, refused naming ADDER and the package → the same; the package's own send → no template.

**Not moved.** A send of a name none of whose holders is disabled; a disabled dependent's addition beside enabled holders (the address it was read at already left it out); the enabled holder's own send beside a disabled holder (read at its address, as before, so its own pair row and a package-less stored row there are still its customization). The metadata reads (`/meta`, `?package=`, `_env`) and the lists are not touched.
