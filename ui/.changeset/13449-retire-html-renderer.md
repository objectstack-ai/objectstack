---
'@object-ui/components': minor
'@object-ui/types': minor
'@object-ui/core': minor
'@object-ui/cli': minor
---

The raw-HTML `html` node type is retired (objectui#13449). Its renderer wrote the authored `html` string into the page through `dangerouslySetInnerHTML` with no sanitiser, so anyone who could write metadata could put script-bearing markup in front of every viewer — a `kind: 'html'` page included, which compiled an `html` tag carrying an `html` attribute with no diagnostic. `@objectstack/spec` declares no `html` component, so it is removed rather than sanitised, at once, with no deprecation alias. This is breaking for a page that still names it; it is marked `minor` under this repository's version policy.

- **SDUI node `html`**, also registered as `ui:html`. FROM: `@object-ui/components` registered both keys. TO: neither is registered. A JSON node that still names it draws the unknown-component panel, a `kind: 'html'` page that writes the tag fails to compile with `forbidden-tag` and `unknown-component`, and `objectui check` no longer counts either key among the known component types.
- **Public block `html`** in `PUBLIC_BLOCKS` (`@object-ui/core`). FROM: listed as the curated tier's escape hatch, so `getPublicConfigs()` and the published `sdui.manifest.json` carried it. TO: not listed, so neither names it.
- **Schema `HtmlSchema`** in `@object-ui/types`: the TypeScript interface from the package entry, with its `DataDisplaySchema` member and its `SchemaRegistry` row (so `ComponentType` no longer offers `'html'`), and the zod arm from `@object-ui/types/zod`. FROM: exported, and a `type: "html"` node validated against the arm. TO: there is no such export, so importing it fails to compile. `DataDisplaySchema` keeps a refusal arm for the literal, which is not exported, so `objectui validate` refuses a `type: "html"` node BY NAME at `type`, and the message names the remedy.

The `html` FIELD type (`HtmlFieldMetadata`, drawn by `field:html`) is a different layer and stays: its value displays through the sanitised fields path.

Fix for a page that still names it: in place of `{ "type": "html", "html": "…" }`, declare rich text a user edits as an `html` or `richtext` field on the object, whose value renders sanitised, and write authored page copy as a `kind: 'html'` page.

Clause-②: no (narrowing)
Metadata-protocol: narrowed
