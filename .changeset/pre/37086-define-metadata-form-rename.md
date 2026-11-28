---
'@objectstack/spec': patch
'@objectstack/lint': patch
'@objectstack/cli': patch
'@objectstack/metadata-protocol': patch
'@objectstack/platform-objects': patch
---

refactor(spec)!: the Studio metadata-form helper `defineForm` is renamed `defineMetadataForm`, and its modules move from `*.form.ts` to `*.metadata-form.ts`, so the name and the suffix are free for the `form` metadata type (ADR-0159)

Clause-②: yes (narrowing)
Metadata-protocol: none

ADR-0159 makes `form` a metadata type of its own, and the maintainer ruled that its factory is `defineForm` (question 1, option A). The helper that held the name builds something else: a schema-bound form for Studio's metadata editors (`data.provider: 'schema'`). It is renamed after the translation family its forms feed (`metadataForms`), with the same argument and the same result, and its 18 modules under `packages/spec/src` are renamed with it. `defineForm` is absent from `@objectstack/spec` until the `form` type lands with it, in the same major; it never has two meanings. Nothing a metadata author writes changes: no stack, no stored row and no spec key names the helper, which is why the protocol line is `none`.

<!-- adr-0087: registered define-form-studio-helper-renamed-define-metadata-form -->

**BREAKING** (a published export is renamed), shipped as `patch`: the change is not to the metadata protocol (`Metadata-protocol: none`).

- **FROM:** `import { defineForm } from '@objectstack/spec'` (or `@objectstack/spec/ui`), `defineForm({ schemaId, … })` in a `NAME.form.ts` module.
- **TO:** `import { defineMetadataForm } from '@objectstack/spec'` (or `@objectstack/spec/ui`), `defineMetadataForm({ schemaId, … })` in a `NAME.metadata-form.ts` module.
- **The fix:** rename the import and the call; rename a module that builds one to `*.metadata-form.ts`. The compiler names every call site (`TS2305` / `TS2724`).
- **Outside use, read before the rename:** no import or call of `defineForm` in any public repository of the organization, nor in the cloud repository.
- `@objectstack/lint`: the explanation of `visibility-root-mislayered` and the `data`-root message of the field-rule check name the Studio modules by their new suffix (`*.metadata-form.ts`); what each rule reports is unchanged.
- `@objectstack/cli`, `@objectstack/metadata-protocol`, `@objectstack/platform-objects`: comments and docblocks that cite the Studio modules name them by their new file names; no behaviour changes.
