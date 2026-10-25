# No-Touch Zones (Shadcn Upstream Purity)

> **Critical:** These files are synced from upstream. DO NOT modify them directly.

## Protected Path

```
packages/components/src/ui/**/*.tsx
```

## Rule: Forbidden to Modify Shadcn Primitives

**You are FORBIDDEN from modifying the logic or styles of files in this directory.**

### Why This Rule Exists

1. These are upstream 3rd-party files from [shadcn/ui](https://github.com/shadcn-ui/ui)
2. They are **overwritten by sync scripts** (`scripts/shadcn-sync.js`)
3. Any manual changes will be lost on the next sync

### Examples of Protected Files

- `packages/components/src/ui/button.tsx`
- `packages/components/src/ui/card.tsx`
- `packages/components/src/ui/dialog.tsx`
- `packages/components/src/ui/input.tsx`
- `packages/components/src/ui/select.tsx`
- ...and all other files in `ui/**/*.tsx`

## Workaround: Create Wrappers

If a user asks to change the behavior of Button, Dialog, or any Shadcn primitive:

### Step 1: DO NOT edit the primitive

**❌ FORBIDDEN:**
```typescript
// packages/components/src/ui/button.tsx
export function Button({ children, ...props }) {
  // ❌ DO NOT modify this file
  return <button {...props}>{children}</button>
}
```

### Step 2: Create a wrapper in `custom/`

**✅ CORRECT:**
```typescript
// packages/components/src/custom/enhanced-button.tsx
import { Button } from '../ui/button';

export function EnhancedButton({ loading, children, ...props }) {
  return (
    <Button {...props} disabled={loading || props.disabled}>
      {loading && <Spinner className="mr-2" />}
      {children}
    </Button>
  );
}
```

### Step 3: Export from package index

```typescript
// packages/components/src/index.ts
export { Button } from './ui/button';           // Original primitive
export { EnhancedButton } from './custom/enhanced-button'; // Wrapper
```

### Step 4: Register the wrapper if needed

```typescript
// For schema-driven rendering
import { ComponentRegistry } from '@object-ui/core';
import { EnhancedButton } from '@object-ui/components';

ComponentRegistry.register('enhanced-button', EnhancedButton);
```

## Directory Structure

```
packages/components/src/
├── ui/                    # 🔒 NO-TOUCH ZONE - Shadcn upstream
│   ├── button.tsx
│   ├── card.tsx
│   ├── dialog.tsx
│   └── ...
├── custom/                # ✅ SAFE ZONE - Custom wrappers
│   ├── enhanced-button.tsx
│   ├── data-card.tsx
│   └── ...
├── icons/                 # ✅ SAFE ZONE - Icon components
└── index.ts               # ✅ SAFE ZONE - Package exports
```

## Exception: CSS-Only Modifications

If you need to add CSS rules for state-dependent behavior (e.g., Tailwind 4 sidebar compatibility), you may add them to:

```
packages/components/src/index.css
```

**Example (allowed):**
```css
/* Tailwind 4 sidebar state rules */
.sidebar-menu-button-icon-mode {
  /* Custom CSS for icon mode */
}
```

**But NEVER modify the TypeScript/JSX in `ui/` files.**

## Sync Script Reference

The sync script that overwrites these files is located at:

```
scripts/shadcn-sync.js
```

This script fetches the latest components from shadcn/ui and overwrites local `ui/` files.

## Summary

| Action | Allowed? | Location |
|--------|----------|----------|
| Modify Button logic | ❌ NO | `ui/button.tsx` |
| Create ButtonWithIcon | ✅ YES | `custom/button-with-icon.tsx` |
| Modify Card styles | ❌ NO | `ui/card.tsx` |
| Create DataCard wrapper | ✅ YES | `custom/data-card.tsx` |
| Add CSS rules | ✅ YES | `index.css` |
| Fix TypeScript errors in ui/ | ❌ NO | Report upstream or use workaround |

**When in doubt:** Create a wrapper in `custom/` instead of editing `ui/` files.
