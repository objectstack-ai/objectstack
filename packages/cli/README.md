# @objectstack/cli

Command Line Interface for building metadata-driven applications with the ObjectStack Protocol.

Built on [oclif](https://oclif.io/) — commands are auto-discovered, and plugins can extend the CLI without modifying the main package.

## Installation

```bash
pnpm add -D @objectstack/cli
```

The CLI is available as `objectstack` or the shorter alias `os`.

## Quick Start

```bash
# Initialize a new project
os init my-app

# Generate metadata
os generate object task
os generate view task
os generate flow task

# Validate configuration
os validate

# Start development server
os dev

# Compile for production
os compile
```

## Commands

### Development

| Command | Description |
|---------|-------------|
| `os init [name]` | Initialize a new ObjectStack project in the current directory |
| `os dev [package]` | Start development mode with hot reload |
| `os serve [config]` | Start the ObjectStack server with plugin auto-detection |
| `os studio [config]` | Launch Studio UI with development server |

### Build & Validate

| Command | Description |
|---------|-------------|
| `os compile [config]` | Compile configuration to a JSON artifact (`dist/objectstack.json`) |
| `os validate [config]` | Validate configuration against the ObjectStack Protocol schema |
| `os info [config]` | Display metadata summary (objects, fields, apps, agents, etc.) |

### Scaffolding

| Command | Description |
|---------|-------------|
| `os generate <type> <name>` | Generate metadata files (alias: `os g`) |
| `os create <type> [name]` | Create a new package/plugin/example from template |

Available generate types: `object`, `view`, `action`, `flow`, `agent`, `dashboard`, `app`

### Plugin Management

Runtime plugins (declared in `objectstack.config.ts` `plugins`) are loaded automatically by `os serve` / `os dev`. There is no `os plugin` command group in v1; project-level dependency management and marketplace distribution will arrive with the Cloud Projects model. To distribute a build today, use `os build` (or `os compile`) and bind the artifact via `os projects bind <id> --artifact dist/objectstack.json`.

### Quality

| Command | Description |
|---------|-------------|
| `os test [files]` | Run Quality Protocol test scenarios against a running server |
| `os doctor` | Check development environment health |
| `os lint [config]` | Check configuration for style and convention issues |
| `os diff [before] [after]` | Compare two configurations and detect breaking changes |

### Reference

| Command | Description |
|---------|-------------|
| `os explain [schema]` | Display human-readable explanation of an ObjectStack schema |

### Code Transforms

| Command | Description |
|---------|-------------|
| `os codemod v2-to-v3` | Migrate ObjectStack v2 config to v3 format |

## Configuration

The CLI looks for `objectstack.config.ts` (or `.js`, `.mjs`) in the current directory:

```typescript
import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects';

export default defineStack({
  manifest: {
    id: 'com.example.my-app',
    namespace: 'my_app',
    version: '1.0.0',
    type: 'app',
    name: 'My App',
  },
  objects: Object.values(objects),
});
```

## CLI Options

### Global

- `-v, --version` — Show version number
- `-h, --help` — Show help

### `os init`

- `-t, --template <template>` — Template: `app` (default), `plugin`, `empty`
- `--no-install` — Skip dependency installation

### `os compile`

- `-o, --output <path>` — Output path (default: `dist/objectstack.json`)
- `--json` — Output compile result as JSON (for CI pipelines)

### `os validate`

- `--strict` — Treat warnings as errors
- `--json` — Output result as JSON

### `os serve`

- `-p, --port <port>` — Server port (default: `3000`)
- `--dev` — Run in development mode (load devPlugins, pretty logging)
- `--ui` — Enable Studio UI
- `--no-server` — Skip starting HTTP server plugin

### `os generate`

- `-d, --dir <directory>` — Override target directory

### `os plugins` (oclif)

`os plugins install`, `os plugins uninstall`, `os plugins update`, and friends come from `@oclif/plugin-plugins`. They install third-party CLI extensions (oclif plugins), not runtime plugins for an ObjectStack project. See [oclif's plugin docs](https://oclif.io/docs/plugins) for the full surface.

### `os info`

- `--json` — Output as JSON

### `os doctor`

- `-v, --verbose` — Show fix suggestions for warnings
- `--scan-deprecations` — Scan for deprecated patterns

## oclif Plugin System

The CLI uses oclif's built-in plugin system for extensibility. Third-party plugins (e.g., cloud commands, marketplace tools) can extend the CLI without modifying the main package.

### How Plugin Extension Works

1. **Create an oclif plugin package** with its own `oclif` config in `package.json`
2. **Export oclif Command classes** from the plugin's `src/commands/` directory
3. **Install the plugin** via `os plugins install <package>` or declare it in the main CLI's `oclif.plugins`

### Creating a CLI Plugin

**1. Configure the plugin's `package.json`:**

```json
{
  "name": "@acme/plugin-marketplace",
  "oclif": {
    "commands": {
      "strategy": "pattern",
      "target": "./dist/commands",
      "glob": "**/*.js"
    }
  }
}
```

**2. Create oclif Command classes:**

```typescript
// src/commands/marketplace/search.ts
import { Args, Command, Flags } from '@oclif/core';

export default class MarketplaceSearch extends Command {
  static override description = 'Search marketplace applications';

  static override args = {
    query: Args.string({ description: 'Search query', required: true }),
  };

  async run() {
    const { args } = await this.parse(MarketplaceSearch);
    // Implementation...
  }
}
```

**3. Install and use:**

```bash
os plugins install @acme/plugin-marketplace
os marketplace search "crm"
```

### Key Differences from Previous Plugin Model

| Before (Commander.js) | After (oclif) |
|---|---|
| Plugins declared in `objectstack.config.ts` | Plugins installed via `os plugins install` or `oclif.plugins` |
| Custom `loadPluginCommands` mechanism | oclif's built-in plugin discovery |
| `contributes.commands` in manifest | `oclif.commands` in `package.json` |
| Commander.js `new Command(...)` exports | oclif `class extends Command` exports |
| Project config determines CLI commands | CLI commands available without project init |

## Typical Workflow

```
os init                          # 1. Create project
os generate object customer      # 2. Add a Customer object
os generate object order         # 3. Add an Order object  
os generate view customer        # 4. Add a list view
os validate                      # 5. Validate everything
os dev                           # 6. Start dev server
os compile                       # 7. Build for production
os projects bind <id> --artifact dist/objectstack.json  # 8. Bind to a Cloud Project
```

## Architecture

```
@objectstack/cli (oclif)
├── bin/run.js                  # Entry point (os / objectstack)
├── src/commands/               # Auto-discovered command classes
│   ├── init.ts                 # os init
│   ├── dev.ts                  # os dev
│   ├── serve.ts                # os serve
│   ├── compile.ts              # os compile
│   ├── validate.ts             # os validate
│   ├── generate.ts             # os generate (alias: g)
│   ├── projects/               # os projects <subcommand>
│   │   ├── list.ts
│   │   ├── show.ts
│   │   ├── create.ts
│   │   ├── switch.ts
│   │   └── bind.ts
│   ├── codemod/                # os codemod <subcommand>
│   │   └── v2-to-v3.ts
│   └── ...
├── src/utils/                  # Shared utilities
└── package.json                # oclif config under "oclif" key
```


## Default capability slate (always-on)

`objectstack serve` (and `os dev`) auto-mount a baseline slate of
service plugins for every preset **except** `--preset minimal`:

| Capability  | Plugin                       | Why default                                                  |
|-------------|------------------------------|--------------------------------------------------------------|
| `queue`     | `QueueServicePlugin`         | Background retries (mail, audit batching) need a queue.      |
| `job`       | `JobServicePlugin`           | Scheduled jobs (cleanup, reports, cron).                     |
| `cache`     | `CacheServicePlugin`         | In-memory adapter; performance baseline.                     |
| `settings`  | `SettingsServicePlugin`      | Mail / storage / branding / feature-flag UI + persistence.   |
| `email`     | `EmailServicePlugin`         | Auth callbacks (verify, reset, magic-link) hard-depend.      |
| `storage`   | `StorageServicePlugin`       | Avatars, attachments, exports. Local fallback in dev.        |

Apps no longer need to list these in `requires: [...]`.

**Opt-out:** run `objectstack serve --preset minimal` to skip the slate
and only load core + your explicit `requires`.

**Built-in Settings manifests:** `mail`, `storage`, `branding`,
`feature_flags` are pre-registered. Both `mail` and `storage` expose a
"Test connection" action that exercises the live transport / adapter
end-to-end. Switching the storage adapter does **not** migrate
previously uploaded files — the plugin logs a warning on every swap.

**Storage warning:** when no `storage:` block is configured the plugin
falls back to the local driver under `.objectstack/data/uploads/`. In
non-dev mode a single `console.warn` fires at boot — switch to S3/GCS/
Azure for production by setting `config.storage`, `OS_STORAGE_*` env,
or via the Settings hub (`namespace=storage`).

## License

Apache-2.0
