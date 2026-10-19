---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: the row-policy collection applies an object's declared `defaultRowScope` when no permission set the caller holds carries a row policy for the object

Clause-②: no (narrowing) — the narrowing is real only for a principal with no platform baseline whose permission sets carry no row policy for an object that declares a default; no object in this release declares one, and no export, option, schema or stored shape moves.

<!-- adr-0087: not-required (no-migration-prescription) A runtime row-scope narrowing at the security plugin's one row-policy collection, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped: `ObjectSchema.defaultRowScope` already parses, and this change only gives it its reader, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is the rows a principal reads on an object that declares a default when none of its permission sets carries a row policy for that object and operation: it now reads under the object's default instead of under no row filter. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers the collection and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`ObjectSchema.defaultRowScope` declares an object's default row-level security policy. Until now no server read it. The security plugin's row-policy collection (`collectRLSPolicies`), which every read, write and explain composes from, now applies it:

- **When it applies.** When the policies the caller's permission sets carry for the object and the operation come out empty, the object's default is collected in their place, for the declaring object. Empty means what the collection already meant by it: a held policy for every object (`'*'`) counts, while a held policy that is switched off, outside the caller's positions, or for another operation does not.
- **How it is judged.** Exactly as a held policy: its `operation`, `positions` and `enabled` decide where it applies, and its `using` and `check` compile through the same compiler. So it scopes reads, the by-id and bulk write filters, and the post-image check, and `checkAuthoredRowWrite` reads it as the declaration it is. A `using` the compiler cannot lower is dropped with the same warning and fails closed to zero rows, as an authored policy's does.
- **Explain** names an applied default as the object's own declaration, with its `name`, `label` and `description`: the row-level layer's `detail` says so, and a record-grained explanation names the rule after the default, reached `via: 'object_default'`.
- **Unchanged:** a policy an authored set carries for the object is used as authored, with the default not added to it; a principal whose superuser bypass skips row policies never reaches the collection; an object that declares no default collects exactly what it collected before. A deployment that composes the platform baseline is unaffected for the identity objects, whose shipped sets carry their own policies.

What changes for you: nothing until an object declares `defaultRowScope`. Once one does, a principal whose permission sets carry no row policy for it reads only the rows the default admits. To give such a principal a different scope, put a row policy for the object in a permission set it holds; that policy is then used instead of the default.
