# Migration Notice: `@objectstack/plugin-ui` → `@object-ui/cli` (revert)

The package previously published as `@objectstack/plugin-ui` (an oclif plugin
hosted under `os ui …`) has been **reverted** to its original identity:

- **Package name:** `@object-ui/cli`
- **Distribution:** standalone Commander.js CLI (no oclif host required)
- **Bin:** `objectui` (unchanged)

## Why revert

- ObjectUI is a **protocol-agnostic** renderer (Rule #1). Coupling its CLI to
  a single ecosystem host (`@objectstack/cli`) bound a neutral toolchain to one
  vendor.
- Naming consistency: every other workspace package is `@object-ui/*`.
- Standard frontend toolchains (Vite, Next, Astro, Remix) ship standalone CLIs.
- The oclif plugin layer duplicated every command (Commander entry + 15 oclif
  wrappers) and forced flag regressions (e.g. `-h, --host` was lost to oclif's
  built-in `-h` for help).

## What you need to do

### Installation

```bash
# Old
npm install -g @objectstack/plugin-ui

# New
npm install -g @object-ui/cli
```

### Commands

The `objectui` bin and all flags work exactly as before.

```bash
objectui dev app.json
objectui build
objectui init my-app --template dashboard
```

The `os ui …` namespace no longer exists in this package. If you need to
aggregate ObjectUI commands under an `os` meta-CLI, write a thin wrapper in
your host CLI's repository that shells out to `objectui`.

### Programmatic imports

```ts
// Old
import { serve, init } from '@objectstack/plugin-ui';

// New
import { serve, init } from '@object-ui/cli';
```

### Flag note

`-h, --host` is back to its original short form on `dev`, `serve`, and `start`
(oclif's reservation of `-h` no longer applies).
