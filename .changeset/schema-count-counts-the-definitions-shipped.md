---
"@objectstack/spec": patch
---

fix(spec): the bundled JSON Schema's `x-schema-count` counts the definitions it carries (#12588)

`json-schema/objectstack.json` ships in the tarball (`json-schema` is in the
package's `files`), and `content/docs/deployment/troubleshooting.mdx` publishes
what the field means: "its `x-schema-count` field reports the total number of
definitions". It did not. The generator took the number from `count` — a
counter incremented once per emitted schema — while the bundle's `$defs` is
assembled from a map keyed by `<category>/<Name>`. Every def key written more
than once therefore widened a gap nothing reconciled: the published bundle
declared **1596** definitions while carrying **1585**.

`$defs` is now assembled before the envelope and the field is taken from its
size, so the artifact describes itself. The per-schema files on disk already
agreed with `$defs` (1585) — the same key collapses the file writes — so this
brings the one disagreeing number into line with both of the others, and the
docs sentence is true as written without changing it.

**The collapsed emits are now named rather than implied.** The 11 def keys
written twice are all **benign self-aliases** — `export const X = XSchema`
spelled as `Object.assign(XSchema, …)`, one schema object reached by two export
names, so the second write cannot change what is published. Eight in `api`
(`ApiEndpoint`, `RestApiConfig`, `RestServerConfig`, `ApiDocumentationConfig`,
`ApiTestCollection`, `OpenApiSpec`, `RestApiPluginConfig`,
`RestApiRouteRegistration`) and three in `system` (`MiddlewareConfig`,
`QueueConfig`, `Task`). No schema is being silently dropped: the existing
`findDefKeyCollisions` guard exits the build on any def key claimed by two
*different* schemas, so a build that produces a bundle at all has only exempt
ones — and `gen:schema` now prints that population instead of leaving it
visible only as a subtraction between two summary lines.

No schema content changes; only the bundle's self-description and the
generator's console output.
