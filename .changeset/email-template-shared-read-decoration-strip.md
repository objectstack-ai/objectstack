---
"@objectstack/plugin-email": patch
---

`plugin-email` strips read decorations with the shared list, not a blanket underscore sweep.

`readEffectiveTemplate` — the layered read a `DELETE /meta/email_template/:name` runs to restore the packaged baseline an overlay was hiding — removed decorations with a module-local copy of `stripReadDecorations` that dropped **every** key beginning with `_`. The shared list it drifted from, `METADATA_READ_DECORATIONS` in `@objectstack/spec/kernel`, is exactly `['_diagnostics', '_draft']`, and its module header names the ADR-0010 protection envelope (`_lock`, `_lockReason`, `_lockSource`, `_provenance`, `_packageId`, `_packageVersion`, `_lockDocsUrl`) as deliberately **not** a member: it is envelope state the write path legitimately carries, and the closed metadata schemas allowlist it so a served document keeps its provenance on re-parse.

The private copy justified its sweep on the claim that `EmailTemplateDefinitionSchema` "declares no underscore key". That is false — `email-template.zod.ts` spreads `MetadataProtectionFields` into its `strictObject`, so every envelope key is declared and parses clean. The copy was removing keys the schema was deliberately widened to accept, and the list lives in `spec` precisely so a producer and its consumers cannot drift like this.

The path now calls the shared helper, matching the other read-back-envelope consumers (the dataset query in `rest-server.ts`, the cold-boot flow bind in `service-automation`, `saveMetaItem`'s verbatim persist, and the route-level seed apply). Two behavioural consequences:

- An underscore key that is neither a decoration nor declared is no longer swallowed before validation. The closed schemas exist to reject exactly that (protocol 17), and the rejection is now reported on the write's own response through the mutation projector, instead of the reset quietly succeeding against a body the schema would have refused.
- The ADR-0010 envelope survives the strip. It still does not reach `sys_email_template`: `upsertDeclaredEmailTemplate` projects the parsed template through `mapTemplateToRow`, a closed column list, and the object declares no underscore column — so no stored row changes shape. There is deliberately no second, envelope-stripping pass beside the shared one; spelling one would re-create the drift this fixes, one layer up.
