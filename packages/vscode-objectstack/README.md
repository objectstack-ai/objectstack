# ObjectStack for Visual Studio Code

> Autocomplete, validation, and inline diagnostics for ObjectStack Protocol files.

## Features

- **Snippets** — Quickly scaffold objects, fields, views, flows, agents, and full `defineStack` configs with `os-` prefixed snippets.
- **Hover Documentation** — Hover over `defineStack`, `defineView`, field types (`text`, `lookup`, `select`, etc.) to see inline descriptions.
- **Diagnostics** — Real-time warnings for common mistakes:
  - Missing `manifest` in `defineStack()`
  - camelCase names that should be `snake_case`
- **Config File Watching** — Automatically re-validates when `objectstack.config.ts` changes.
- **JSON Schema Validation** — Validates `objectstack.json` files against the bundled schema.
- **Quick Fix Stubs** — Code action provider for quick fixes (add missing label, convert to snake_case).

## Snippets

Every snippet scaffolds through the spec's own authoring factory
(`ObjectSchema.create`, `defineView`, `defineFlow`, `defineAgent`,
`defineStack`), so what you tab out of the IDE validates against
`@objectstack/spec` the moment it runs — never a bare `: Type` literal that
type-checks over a shape nothing ever parses.

| Prefix | Scaffolds | Validated by |
|--------|-----------|--------------|
| `os-object` | A new business object | `ObjectSchema.create` |
| `os-field-text` | A text field (paste inside `fields: { … }`) | `FieldSchema` |
| `os-field-select` | A select (picklist) field | `FieldSchema` |
| `os-field-lookup` | A lookup (reference) field | `FieldSchema` |
| `os-view-grid` | A grid list view container | `defineView` |
| `os-flow` | A record-change automation flow | `defineFlow` |
| `os-stack` | Full `defineStack` boilerplate | `defineStack` |
| `os-agent` | An AI agent | `defineAgent` |

That claim is enforced, not advertised: `pnpm test` in this package expands
every snippet, evaluates it against the real `@objectstack/spec`, and
`safeParse`s the authored literal with the same schema the runtime uses — plus
a check that each import binding still exists on the spec's export surface. A
snippet that goes stale (as `os-view-grid` did when `ListViewSchema` closed
`defaultSort` / `pageSize`) fails CI instead of shipping. See
`test/snippets.test.ts`.

## Installation

### From Source

```bash
cd packages/vscode-objectstack
npm install
npm run build
npm run package
# Install the generated .vsix file in VSCode
```

### From Marketplace (Coming Soon)

Search for "ObjectStack" in the VSCode Extensions marketplace.

## Usage

1. Open a project containing `objectstack.config.ts`
2. The extension activates automatically for `.object.ts`, `.view.ts`, and `objectstack.config.ts` files
3. Start typing `os-` to see available snippets
4. Hover over ObjectStack keywords for inline documentation

## Supported File Types

| Pattern | Description |
|---------|-------------|
| `*.object.ts` | Business object definitions |
| `*.view.ts` | View configurations (list, form, kanban) |
| `objectstack.config.ts` | Stack configuration file |
| `objectstack.json` | JSON configuration (with schema validation) |

## Development

```bash
# Build the extension
npm run build

# Watch for changes
npm run watch

# Verify every contributed snippet still parses against @objectstack/spec
npm test

# Package as .vsix
npm run package
```

## Requirements

- VSCode 1.85.0 or later
- TypeScript project using `@objectstack/spec`

## License

Apache-2.0. See [LICENSING.md](../../LICENSING.md).
