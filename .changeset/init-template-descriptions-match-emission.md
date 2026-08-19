---
"@objectstack/cli": patch
---

fix(cli): `os init` template descriptions no longer advertise metadata kinds they never emit (#9737)

The `app` and `plugin` templates' `description` strings — shown by `printKV('Template', …)`
right after `os init -t <template>` runs, and mirrored in `content/docs/deployment/cli.mdx` —
claimed views, actions, and extensions that neither template's `srcFiles` map ever writes.
Both templates emit objects only (`src/objects/index.ts` + `src/objects/{namespace}_item.ts`).

- `app`: `'Full application with objects, views, and actions'` → `'Full application with objects'`
- `plugin`: `'Reusable plugin with objects and extensions'` → `'Reusable plugin with objects'`
- `content/docs/deployment/cli.mdx`'s template table drops the same false `views` claim from the
  `app` row.

A new pin (`packages/cli/test/init.test.ts`) asserts every template's description only claims a
metadata kind (`objects`/`views`/`actions`/`extensions`) its `srcFiles` map actually has an entry
under, so a future template can't drift the same way.
