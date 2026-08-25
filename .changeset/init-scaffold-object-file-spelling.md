---
"@objectstack/cli": patch
---

fix(cli): `os init` scaffolds its starter object as `<ns>_item.object.ts`, the spelling the registry declares (#11598)

`objectstack init` wrote its starter object to `src/objects/<namespace>_item.ts`
while `DEFAULT_METADATA_TYPE_REGISTRY` declares the `object` type as
`**/*.object.ts` / `.yml` / `.json`. Measured with `node:path`'s `matchesGlob`
against the registry read at runtime: `src/objects/my_app_item.ts` matched
**zero** of the three patterns, `src/objects/my_app_item.object.ts` matches
exactly one. Both `srcFiles` tables (the `app` and `plugin` templates) and the
barrel specifier they emit now carry the type infix.

**This was a naming inconsistency, not breakage — measured, not assumed.** A
scaffolded project declares its objects in code (`import * as objects from
'./src/objects'` → `objects: Object.values(objects)`), so the object reaches the
stack through the barrel's *module specifier*, and `os dev` / `os serve` then
boot from the compiled `dist/objectstack.json` rather than by globbing source.
Three real scaffolds were compiled with the real `os compile` to establish it:
the old-spelled file **did** land in the artifact (so nothing was ever silently
skipped — this is not the #10359 silent-strip shape), a `*.object.ts` file
dropped into `src/objects/` but *not* re-exported from the barrel did **not**
land in it (so the registry glob was never on this load path), and the new
spelling lands identically.

What it *was*: one CLI teaching two spellings for one metadata type. After
#11071 an author who runs `os init` and then `os g object customer` gets
`src/objects/my_app_item.ts` beside `src/objects/customer.object.ts` in the same
directory, from the same CLI. The registry spelling is the authority — the same
convergence #11071 settled — and it is already what `create-objectstack`'s blank
starter ships (`note.object.ts`), what the examples use
(`app-crm/src/objects/account.object.ts`), and what the getting-started docs
list as the house convention two lines under the callout that described the old
name.

**Existing scaffolded projects need to do nothing.** The old filename still
loads exactly as it did — the barrel imports it by specifier and the filename is
not consulted. Renaming `src/objects/<ns>_item.ts` to
`src/objects/<ns>_item.object.ts` (and the matching `from './<ns>_item'` →
`from './<ns>_item.object'` in `src/objects/index.ts`) is an optional
consistency cleanup, not a migration: it changes nothing about how the project
builds, boots or behaves. Only newly scaffolded projects get the new name.
