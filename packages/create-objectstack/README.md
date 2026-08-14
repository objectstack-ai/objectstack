# create-objectstack

Scaffold a new [ObjectStack](https://objectstack.ai) project in seconds.

```bash
npm create objectstack@latest my-app
```

## Usage

```bash
# Create a project in a new directory (blank template)
npx create-objectstack my-app

# Use a specific template
npx create-objectstack my-app --template todo

# Scaffold in the current directory
npx create-objectstack

# Skip automatic dependency installation
npx create-objectstack my-app --skip-install
```

## Templates

| Template | Source | Description |
| --- | --- | --- |
| `blank` *(default)* | bundled (offline) | Minimal starter — one object, REST API, ready to extend |

`blank` is bundled inside the npm package, so scaffolding never needs network
access.

The remote content templates (`todo`, `compliance`, `content`, `contracts`,
`procurement`) have been **retired** — they were delisted from the ObjectStack
template marketplace and are no longer maintained. Asking for one by name tells
you so rather than failing as an unknown template.

## Options

| Option | Description |
| --- | --- |
| `[name]` | Project name (defaults to current directory name) |
| `-t, --template <name>` | Project template (default: `blank`) |
| `--skip-install` | Skip dependency installation |
| `--skip-skills` | Skip installing the ObjectStack AI skills bundle |
| `-V, --version` | Show version |
| `-h, --help` | Show help |

## What it does

1. Copies the template into the target directory and rewrites its identity:
   `package.json` name, `objectstack.manifest.json` name/displayName, the
   `objectstack.config.ts` manifest literals, and the README title. A
   **namespace** is derived from the project name (`my-app` → `my_app`) and
   every object name in the template is re-prefixed to match
   (`blank_note` → `my_app_note`).
2. Installs dependencies (pnpm if available, otherwise npm).
3. Installs the ObjectStack AI skills bundle for coding agents
   (`npx skills add objectstack-ai/objectstack/skills --all` — scoped to the
   curated `skills/` catalog).
4. Writes `AGENTS.md` and `.github/copilot-instructions.md` with the project
   conventions — unless the template ships its own.

## What Gets Generated (blank)

```
my-app/
├── objectstack.config.ts        # defineStack() entry point
├── objectstack.manifest.json    # name, namespace, version
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
├── AGENTS.md                    # conventions for coding agents
└── src/
    └── objects/
        ├── index.ts
        └── note.object.ts
```

Next steps inside the project:

```bash
npm run dev        # start the dev server
npm run validate   # verify metadata: schema + predicates + bindings
```

See the docs:
[Your First Project](https://docs.objectstack.ai/docs/getting-started/your-first-project).

## License

Apache-2.0. See [LICENSING.md](../../LICENSING.md).
