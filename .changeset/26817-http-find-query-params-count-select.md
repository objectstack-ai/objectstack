---
'@objectstack/spec': patch
---

fix(spec)!: `HttpFindQueryParamsSchema` declares the `count` and `select` values the list door accepts, instead of a coerced boolean and any string (#26817)

Clause-②: no (narrowing) — the published `GET /data/:object` querystring declaration refuses a `count` other than true or false and a `select` naming no field, which it admitted before. The door already refused both with a 400; nothing is widened and no key is added, removed or renamed.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata type or stored shape moves: two querystring values the declaration admitted, and the Data API list door already refused, are now refused by the declaration too. A caller drops the parameter or sends a well-formed value; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing of a published transport declaration (`@objectstack/spec/api`), read by codegen, the reference docs and clients; it has no runtime reader.

- **Before.** `count` was `z.coerce.boolean()`: the string `'false'` parsed as `true`, and `'maybe'`, `'1'` or a blank value parsed as a boolean. `select` was any string, so a blank or comma-only value was admitted.
- **Now.** `count` is the door's own accept set, read from `QueryTransportParamsSchema.shape.count` (the boolean, or the strings `'true'` and `'false'`) and parsed to the boolean it means: `'false'` is `false`. `select` must name at least one field: a value that is blank, whitespace-only or only commas and spaces is refused, published as the pattern `[^\s,]`. Both match what the list door answers with `400 VALIDATION_ERROR`.
- **Unchanged.** Every other parameter, `count: true` / `false`, and a named projection (`name,email`, spaces and empty members between commas trimmed by the door as before).
- **Who sees it.** Code that parses a querystring bag with this schema and relied on the coercion, or a generated client that trusted the wider declaration.

**The remedy.** Send `count` as `true` or `false` (or leave it out), and `select` naming at least one field (or leave it out to read every column).
