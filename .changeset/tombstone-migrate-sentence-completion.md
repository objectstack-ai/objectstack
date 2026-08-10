---
"@objectstack/spec": patch
---

docs(spec): 14 `retiredKey()` prescriptions over protocol-17 conversions now close with the house `os migrate meta` sentence (#6914)

The tombstone guidance string IS the migration doc for whoever hits it
(`shared/retired-key.ts`), and for these 14 keys an ADR-0087 conversion has
existed all along — but the prescription never said so, telling the author
(very often an AI, ADR-0033) to hand-edit sources a tool rewrites mechanically.
Each now ends with the #6856 route-D house sentence:
`` Run `os migrate meta --from 16` to rewrite existing sources automatically. ``

Sites: `skill.triggerPhrases`; `flow.active` / `flow.template` /
`flow.nodes[].outputSchema` / `flow.errorHandling.fallbackNodeId`;
`waitEventConfig.timeoutMs` / `.onTimeout`; `stack.api.requireAuth` (both the
stack block and the forwarded `RestApiConfigSchema` copy);
`rowLevelSecurity[].priority`; `view.list.responsive` / `view.list.performance`
/ `view.form.defaultSort` / `view.form.aria`.

Verified per site against `spec-changes.json`'s v17 `converted` list and the
conversion's `apply()` in `conversions/registry.ts`. The remaining silent
tombstones stay silent deliberately: no conversion exists for their surfaces
(API request/response keys, engine options, transport envelopes — e.g.
`environment-artifact.zod.ts` and `HookContext.session.roles` say so in so many
words), the `data/driver.zod.ts:108` precedent. Guidance prose before the
appended sentence is byte-identical; the legal metadata set is unchanged.
