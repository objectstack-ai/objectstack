# Shadcn Components Synchronization

How ObjectUI keeps its Shadcn UI primitives in sync with the upstream registry.

## Files

Paths are repo-relative — the tooling does **not** live in this directory:

- `packages/components/shadcn-components.json` - the component manifest: what is
  tracked, what may be re-fetched from the registry, and what must not be
- `scripts/shadcn-sync.js` - the sync script (repo root); every `pnpm shadcn:*`
  script below is a thin wrapper over it
- `scripts/shadcn-local-patches.mjs` - local edits declared as data and
  re-applied after every update, so they survive a sync instead of depending on
  someone remembering them at review time

## Component Categories

`shadcn-components.json` sorts every tracked component into one of two objects,
and `shadcn-sync.js` reads that split to decide what an update may overwrite:

- **`components`** - fetched from the registry. `pnpm shadcn:update <name>` pulls
  upstream and rewrites the local file.
- **`customComponents`** - never fetched. `pnpm shadcn:update` and
  `pnpm shadcn:update-all` skip these. Entries carrying `movedToPlugin` now live
  in their own `@object-ui/plugin-*` package.

**Membership is data, not prose.** This page deliberately does not reproduce
either list. The manifest is the only source of truth, and

```bash
pnpm shadcn:list
```

prints both categories - with each custom entry's stated reason - straight out of
the manifest. It reads no network, so it works offline and cannot be stale.

Restating the names here is precisely what let this page contradict the manifest
about three of them (objectui#3881), including one where following the page
performed a build-breaking action. The one list that survives below survives
because getting it wrong breaks the build, and it is held to the manifest by
`src/__tests__/readme-shadcn-sync-categories.test.ts`.

### Diverged components - re-syncing breaks the build

Some `customComponents` entries are not "custom by origin" at all. They began as
Shadcn components and were hand-migrated past a breaking upstream change, so the
version upstream still ships **cannot compile here**. The manifest marks each one
with a `divergedFrom` URL and states the reason; the local file's own header
repeats it.

Currently diverged:

- `resizable`

Do not move one of these back into `components` because it looks like it belongs
there - that is the mistake this page used to invite. Move it back only after
upstream regenerates for the major version this repo actually installs, and prove
it with a real build first.

## Usage

### Offline (reads the manifest only)

```bash
# List both categories, with each custom entry's reason
pnpm shadcn:list
```

### Automated Sync (Requires Internet)

These reach `ui.shadcn.com`:

```bash
# Check component status
pnpm shadcn:check

# Update a specific component
pnpm shadcn:update button

# Update all components
pnpm shadcn:update-all

# Show diff for a component
pnpm shadcn:diff button
```

### Manual Sync Process

If you don't have network access or prefer manual control:

1. **Visit Shadcn UI Documentation**
   - Go to https://ui.shadcn.com/docs/components/[component-name]
   - Click "View Code" to see the latest implementation

2. **Compare with Local Version**
   ```bash
   # View local component
   cat packages/components/src/ui/button.tsx
   ```

3. **Copy Latest Version**
   - Copy the component code from Shadcn docs
   - Paste into a temporary file

4. **Adjust Imports**
   Replace Shadcn imports:
   ```typescript
   // FROM:
   import { cn } from "@/lib/utils"
   import { Button } from "@/components/ui/button"
   
   // TO:
   import { cn } from "../lib/utils"
   import { Button } from "./button"
   ```

5. **Add ObjectUI Header**
   ```typescript
   /**
    * ObjectUI
    * Copyright (c) 2024-present ObjectStack Inc.
    *
    * This source code is licensed under the MIT license found in the
    * LICENSE file in the root directory of this source tree.
    */
   ```

6. **Preserve Customizations**
   - Keep any `data-slot` attributes
   - Keep ObjectUI-specific variants
   - Keep dark mode enhancements
   - Keep accessibility improvements

7. **Test the Component**
   ```bash
   turbo run build --filter=@object-ui/components
   turbo run test --filter=@object-ui/components
   ```

   Go through turbo, not `pnpm --filter @object-ui/components build`: turbo
   derives this package's build closure from its `dependencies`, and on a tree
   where those are not built yet the bare per-package build fails.

## Using Official Shadcn CLI

You can also use the official Shadcn CLI:

```bash
# Install Shadcn CLI
npm install -g shadcn@latest

# Initialize (if not done)
cd packages/components
npx shadcn@latest init

# Add/update a component
npx shadcn@latest add button --overwrite

# Add all components
npx shadcn@latest add --all --overwrite
```

**⚠️ Warning:** This will overwrite all ObjectUI customizations! You'll need to:

1. Review the diff carefully: `git diff src/ui/`
2. Restore ObjectUI copyright headers
3. Re-add any custom variants or styling
4. Re-add data-slot attributes
5. Test thoroughly

## Checking for Updates

### Manual Check

1. Visit [Shadcn UI GitHub](https://github.com/shadcn-ui/ui/tree/main/apps/www/registry/default/ui)
2. Compare file dates with last update
3. Check [Shadcn Releases](https://github.com/shadcn-ui/ui/releases) for changelog

### Compare Dependencies

```bash
# Check Radix UI versions
cat packages/components/package.json | grep @radix-ui

# Check latest versions
npm view @radix-ui/react-dialog version
npm view @radix-ui/react-select version
```

### Review Breaking Changes

Check Shadcn's changelog:
- [UI Changelog](https://github.com/shadcn-ui/ui/releases)
- [Radix UI Releases](https://github.com/radix-ui/primitives/releases)

## Common Customizations in ObjectUI

When updating components, preserve these ObjectUI patterns:

### 1. Copyright Headers

```typescript
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
```

### 2. Data Slot Attributes

```typescript
<div data-slot="card-header" className={...}>
```

### 3. Additional Variants

```typescript
const buttonVariants = cva(
  "...",
  {
    variants: {
      // ObjectUI-specific variants
      size: {
        "icon-sm": "h-8 w-8",  // Extra size variant
        "icon-lg": "h-10 w-10", // Extra size variant
      }
    }
  }
)
```

### 4. Enhanced Dark Mode

ObjectUI may have enhanced dark mode styles:

```typescript
className="... dark:bg-background/95 dark:backdrop-blur-sm"
```

## Testing After Updates

```bash
# Type check
turbo run type-check --filter=@object-ui/components

# Build (turbo builds the upstream packages this one needs; a bare
# `pnpm --filter @object-ui/components build` does not)
turbo run build --filter=@object-ui/components

# Run tests
turbo run test --filter=@object-ui/components

# Integration test
pnpm test
```

## Rollback

If an update causes issues:

```bash
# Revert specific file
git checkout HEAD -- packages/components/src/ui/button.tsx

# Revert all UI components
git checkout HEAD -- packages/components/src/ui/

# Restore from backup (if created)
cp packages/components/.backup/button.tsx.* packages/components/src/ui/button.tsx
```

## Contributing

When you update a component:

1. Document the changes in CHANGELOG.md
2. Update the version in shadcn-components.json (add lastUpdated field)
3. Test with all examples
4. Create a PR with:
   - Component name in title
   - Reason for update
   - Breaking changes (if any)
   - Screenshots (if visual changes)

## Resources

- [Shadcn UI Docs](https://ui.shadcn.com)
- [Radix UI Docs](https://www.radix-ui.com)
- [Tailwind CSS Docs](https://tailwindcss.com)
- [CVA (Class Variance Authority)](https://cva.style)
