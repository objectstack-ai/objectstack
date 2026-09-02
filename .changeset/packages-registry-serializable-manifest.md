---
"@objectstack/objectql": patch
"@objectstack/runtime": patch
"@objectstack/rest": patch
---

fix(objectql,runtime,rest): store a serializable manifest in the package registry so `/packages` stops answering 500 (#14309)

On a stock showcase boot, signed in as the seeded admin, every read door that
serialises a package answered `500 INTERNAL_ERROR`:

```
GET /api/v1/packages                           -> 500
GET /api/v1/packages/com.example.showcase      -> 500
GET /api/v1/meta/package/com.example.showcase  -> 500
GET /api/v1/meta/package/com.objectstack.setup -> 200
```

with `Converting circular structure to JSON · _ObjectQL -> actionActivation ->
store -> engine`. Studio asks for the list three times on every open.

**Cause.** `SchemaRegistry.installPackage(manifest)` kept the caller's object
verbatim as `pkg.manifest`. For a code-defined stack that object is the live
`defineStack()` one, and its `plugins: [new ConnectorRestPlugin(), …]` entries
hold the engine once they initialise — a cycle since the engine grew
`actionActivation -> store -> engine`. Measured on that boot: of the 26
installed packages exactly ONE manifest key was unserializable (`plugins`, on
`com.example.showcase`), and only after plugin init — during boot the same
manifest serialised cleanly, which is why a package with no plugin instances
(`com.objectstack.setup`) kept answering 200.

**Fix, at the producer.** `installPackage` now stores a serializable projection:
the registry item is a record, not the runtime. The projection drops by shape
rather than by key name — functions, class instances, `Map`/`Set` and reference
cycles are dropped; primitives, plain objects, arrays and `Date` survive — so a
future live member cannot re-open the same hole. The kernel keeps the live
object (`ObjectQL.manifests`), and the one reader of `manifest.plugins[]` reads
its own parameter, never the record, so nothing downstream loses a member it was
using. The caller's manifest is copied, never stripped in place.

**Defence at the read doors.** `GET /packages` and `GET /packages/:id` project a
registry entry onto its declared record fields instead of spreading it whole, so
an undeclared member appearing on the *item* degrades to a field the response
never mentions instead of failing the whole list for every caller. Applied at
both twins — `packages/runtime/src/domains/packages.ts` (the handler that
actually answered the 500; the 404 wording identifies it) and the
`packages/rest` routes. The database half of the REST merge is deliberately not
projected: its shape belongs to `PackageService`.

No response field is added or renamed. Responses that already served fine are
byte-identical; what disappears is a member that could never be serialised.
