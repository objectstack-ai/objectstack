# 🎨 ObjectUI Principles & Architecture

**Goal:** Create a world-class, enterprise-grade UI library for ObjectStack.
**Tech Stack:** React, Tailwind CSS, Shadcn UI, Framer Motion.
---

## 1. Core Philosophy

1.  **"Beauty as a Feature":** Enterprise software doesn't have to be ugly. Use generous whitespace, subtle shadows, and smooth transitions.
2.  **Radical Consistency:** Every button, input, and card must feel like they belong to the same family.
3.  **Composition over Configuration:** Use standard Shadcn slots (`<Card><CardHeader>...`) rather than monolithic config objects when writing internal code.
4.  **Tailwind Native:** All styling must be via Tailwind utility classes. No `.css` files except for global variables.

---


## 2. Component Standards

### A. The "cn" Pattern
Every component **MUST** accept `className` and merge it using `cn()` (clsx + tailwind-merge).

```typescript
import { cn } from "@/lib/utils"

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn("inline-flex items-center rounded-full px-2.5 py-0.5", className)} {...props} />
  )
}
```

### B. Shadcn Compatibility
*   Do not modify `components/ui/*` primitives heavily. Keep them upgradeable.
*   Use `cva` (class-variance-authority) for managing component variants (primary, secondary, ghost).

### C. Theming Variables
Theme is controlled via CSS variables in `globals.css` (in the consumer app or injected by LayoutProvider).

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 221.2 83.2% 53.3%; /* Brand Color */
  --radius: 0.5rem;
}
```

---

## 3. Development Workflow

1.  **Add Primitive:** Use Shadcn CLI (or manual copy) to add atoms.
    *   `npx shadcn-ui@latest add dropdown-menu`
2.  **Build Block:** Combine primitives into a "Block" (e.g., `PageHeader`).
3.  **Connect Engine:** Wrap the Block in the `withEngine` HoC if it needs data/logic.

---

## 4. Visual Standards

*   **Typography:** Inter (default). Headings tight tracking, strict scale.
*   **Borders:** Subtle (`border-zinc-200` light / `border-zinc-800` dark).
*   **Shadows:** `shadow-sm` for cards, `shadow-lg` for dropdowns/modals.
*   **Animation:** Use `framer-motion` for complex entrances. Standard duration: `200ms`.
*   **Dark Mode:** First-class citizen. All colors must have dark substitutions.

