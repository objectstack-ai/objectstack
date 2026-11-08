---
'@object-ui/components': patch
---

refactor(components)!: retire ten zero-consumer shadcn sub-part exports (dialog, dropdown-menu, sheet and sidebar parts)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/components#DialogPortal, @object-ui/components#DialogOverlay, @object-ui/components#DialogClose, @object-ui/components#DropdownMenuPortal, @object-ui/components#SheetPortal, @object-ui/components#SheetClose, @object-ui/components#SidebarSeparator, @object-ui/components#SidebarGroupAction, @object-ui/components#SidebarMenuBadge, @object-ui/components#SidebarMenuSkeleton) the retired operands are React UI primitives of the components package; nothing in the workspace or in hotcrm imports any of them from the package entry (the only other spellings are the upstream shadcn registry snapshots under `ui/scripts/__tests__/fixtures/shadcn-registry/`, which declare their own copies, and a comment naming Radix's own portal part), and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these ten names from `@object-ui/components`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected, and every schema node type (`dialog`, `sheet`, `dropdown-menu`, `sidebar` and the rest) renders exactly as before.

All ten stay in their shadcn modules, which `pnpm shadcn:update` keeps in step with the registry and which this package's own code still reads (`MobileDialogContent` mounts `DialogPortal` and `DialogOverlay`); only the entry stops publishing them:

- `dialog`: `DialogPortal`, `DialogOverlay`, `DialogClose`
- `dropdown-menu`: `DropdownMenuPortal`
- `sheet`: `SheetPortal`, `SheetClose`
- `sidebar`: `SidebarSeparator`, `SidebarGroupAction`, `SidebarMenuBadge`, `SidebarMenuSkeleton`

Every other name the entry exported stays exported unchanged, among them `Dialog`, `DialogTrigger`, `DialogContent` and its header, footer, title and description parts, `DropdownMenu` with its trigger, content, item, group, label, separator, shortcut, radio, checkbox and sub-menu parts, `Sheet` with `SheetOverlay`, `SheetTrigger`, `SheetContent` and its header, footer, title and description parts, and `Sidebar`, `SidebarProvider`, `useSidebar`, `useOptionalSidebar` with every other sidebar part.

What leaves, and what to write instead:

- FROM `DialogPortal`, `DialogOverlay` TO `DialogContent`, which already mounts the portal and the overlay.
- FROM `DialogClose` TO the close button `DialogContent` already draws, or the `Close` part of `@radix-ui/react-dialog` for a custom one.
- FROM `DropdownMenuPortal` TO `DropdownMenuContent`, which already mounts its own portal; for a sub-menu, the `Portal` part of `@radix-ui/react-dropdown-menu` around `DropdownMenuSubContent`.
- FROM `SheetPortal` TO `SheetContent`, which already mounts the portal and the overlay.
- FROM `SheetClose` TO the close button `SheetContent` already draws, or the `Close` part of `@radix-ui/react-dialog` for a custom one.
- FROM `SidebarSeparator`, `SidebarGroupAction`, `SidebarMenuBadge`, `SidebarMenuSkeleton` TO the same parts in the host's own tree (`npx shadcn@latest add sidebar`), or `Separator`, `SidebarMenuAction` and `Skeleton`, which stay exported.
