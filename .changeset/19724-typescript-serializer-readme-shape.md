---
"@objectstack/metadata": patch
---

`README.md` — the `TypeScriptSerializer` line now says what the serializer emits and what it is for, instead of claiming it exists "for `ObjectSchema.create()`, `defineView()`, etc." (#19724).

The serializer has never written a factory call. It writes a JSON document wrapped in a module — `export const metadata = { …JSON… };` then `export default metadata;`, with the `typescript` format adding an `import type { ServiceObject }` and annotating the constant with it — and it reads back only a JSON body (double-quoted keys and strings, no comments, no trailing commas), so an authored `ObjectSchema.create({ … })` file with ordinary unquoted keys is refused with `Failed to parse object literal as JSON`. It is the file format `FilesystemLoader` uses for the `typescript` / `javascript` formats: `MetadataManager.save('object', 'account', data)` routed to the filesystem loader writes `{rootDir}/object/account.ts`, never a `*.object.ts`.

- **No behaviour moves.** The emitter, the parser and every published export are byte-identical; only the README text shipped in this package's `files[]` changes.
- ⚠️ **Not an authoring shape.** Authored metadata — a `*.object.ts` written `ObjectSchema.create({ … })`, a view written `defineView({ … })` — is not produced by, and in its usual TypeScript spelling not readable by, this serializer; do not point it at authored source files.
