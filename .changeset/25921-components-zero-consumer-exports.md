---
'@object-ui/components': patch
---

refactor(components)!: retire sixty-three zero-consumer shadcn sub-part exports, and delete the typography primitives nothing reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/components#TypographyH1, @object-ui/components#TypographyH2, @object-ui/components#TypographyH3, @object-ui/components#TypographyH4, @object-ui/components#TypographyP, @object-ui/components#TypographyBlockquote, @object-ui/components#TypographyList, @object-ui/components#TypographyInlineCode, @object-ui/components#TypographyLead, @object-ui/components#TypographyLarge, @object-ui/components#TypographySmall, @object-ui/components#TypographyMuted, @object-ui/components#AlertDialogOverlay, @object-ui/components#AlertDialogPortal, @object-ui/components#BreadcrumbEllipsis, @object-ui/components#BreadcrumbSeparator, @object-ui/components#CarouselContent, @object-ui/components#CarouselNext, @object-ui/components#CarouselPrevious, @object-ui/components#CommandShortcut, @object-ui/components#ContextMenuCheckboxItem, @object-ui/components#ContextMenuGroup, @object-ui/components#ContextMenuLabel, @object-ui/components#ContextMenuPortal, @object-ui/components#ContextMenuRadioGroup, @object-ui/components#ContextMenuRadioItem, @object-ui/components#ContextMenuShortcut, @object-ui/components#DrawerOverlay, @object-ui/components#DrawerPortal, @object-ui/components#useFormField, @object-ui/components#InputOTP, @object-ui/components#InputOTPSlot, @object-ui/components#MenubarCheckboxItem, @object-ui/components#MenubarContent, @object-ui/components#MenubarGroup, @object-ui/components#MenubarLabel, @object-ui/components#MenubarPortal, @object-ui/components#MenubarRadioGroup, @object-ui/components#MenubarRadioItem, @object-ui/components#MenubarSeparator, @object-ui/components#MenubarShortcut, @object-ui/components#MenubarSub, @object-ui/components#MenubarSubContent, @object-ui/components#MenubarSubTrigger, @object-ui/components#MenubarTrigger, @object-ui/components#NavigationMenu, @object-ui/components#NavigationMenuContent, @object-ui/components#NavigationMenuIndicator, @object-ui/components#NavigationMenuLink, @object-ui/components#NavigationMenuList, @object-ui/components#NavigationMenuTrigger, @object-ui/components#NavigationMenuViewport, @object-ui/components#navigationMenuTriggerStyle, @object-ui/components#PaginationContent, @object-ui/components#PaginationEllipsis, @object-ui/components#PaginationItem, @object-ui/components#PaginationLink, @object-ui/components#PaginationNext, @object-ui/components#PaginationPrevious, @object-ui/components#SelectScrollDownButton, @object-ui/components#SelectScrollUpButton, @object-ui/components#SelectSeparator, @object-ui/components#TableCaption) the retired operands are React UI primitives of the components package; nothing in the workspace or in hotcrm imports any of them from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names them (the schema renderers that draw menubars, carousels, breadcrumbs and the rest keep reading them inside the package), so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these sixty-three names from `@object-ui/components`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected, and every schema node type (`menubar`, `navigation-menu`, `pagination`, `carousel`, `breadcrumb`, `context-menu`, `input-otp`, `table` and the rest) renders exactly as before.

Twelve of them are **gone from the package, not only from the entry**, because nothing inside the package read them either: `src/ui/typography.tsx` is deleted with `TypographyH1`, `TypographyH2`, `TypographyH3`, `TypographyH4`, `TypographyP`, `TypographyBlockquote`, `TypographyList`, `TypographyInlineCode`, `TypographyLead`, `TypographyLarge`, `TypographySmall` and `TypographyMuted`. It was not a shadcn registry component (`shadcn-components.json` does not list it).

The other fifty-one stay in their shadcn modules, which this package's own renderers read and which `pnpm shadcn:update` keeps in step with the registry, and only leave the entry:

- `alert-dialog`: `AlertDialogOverlay`, `AlertDialogPortal`
- `breadcrumb`: `BreadcrumbEllipsis`, `BreadcrumbSeparator`
- `carousel`: `CarouselContent`, `CarouselNext`, `CarouselPrevious`
- `command`: `CommandShortcut`
- `context-menu`: `ContextMenuCheckboxItem`, `ContextMenuGroup`, `ContextMenuLabel`, `ContextMenuPortal`, `ContextMenuRadioGroup`, `ContextMenuRadioItem`, `ContextMenuShortcut`
- `drawer`: `DrawerOverlay`, `DrawerPortal`
- `form`: `useFormField`
- `input-otp`: `InputOTP`, `InputOTPSlot`
- `menubar`: `MenubarCheckboxItem`, `MenubarContent`, `MenubarGroup`, `MenubarLabel`, `MenubarPortal`, `MenubarRadioGroup`, `MenubarRadioItem`, `MenubarSeparator`, `MenubarShortcut`, `MenubarSub`, `MenubarSubContent`, `MenubarSubTrigger`, `MenubarTrigger`
- `navigation-menu`: `NavigationMenu`, `NavigationMenuContent`, `NavigationMenuIndicator`, `NavigationMenuLink`, `NavigationMenuList`, `NavigationMenuTrigger`, `NavigationMenuViewport`, `navigationMenuTriggerStyle`
- `pagination`: `PaginationContent`, `PaginationEllipsis`, `PaginationItem`, `PaginationLink`, `PaginationNext`, `PaginationPrevious`
- `select`: `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator`
- `table`: `TableCaption`

Every other name the entry exported stays exported unchanged, among them `AlertDialog` and its content parts, `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `Carousel`, `CarouselItem`, the type `CarouselApi` (the `setApi` prop of `Carousel` names it), `Command` and its parts, `ContextMenu` with its content, item, separator and sub-menu parts, `Drawer` and its parts, `Form` and its field parts, `InputOTPGroup`, `InputOTPSeparator`, `Menubar`, `MenubarMenu`, `MenubarItem`, `NavigationMenuItem`, `Pagination`, `Select` and its parts, `Table` and its parts, and `toggleVariants` (the props of `Toggle` and `ToggleGroup` are typed by it).

What leaves, and what to write instead:

- FROM `TypographyH1`, `TypographyH2`, `TypographyH3`, `TypographyH4`, `TypographyP`, `TypographyBlockquote`, `TypographyList`, `TypographyInlineCode`, `TypographyLead`, `TypographyLarge`, `TypographySmall`, `TypographyMuted` TO the plain element with the Tailwind classes you want (`h1`, `p`, `blockquote`, `code` and so on), or an `element:text` node with a heading `variant` such as `h2`.
- FROM `AlertDialogOverlay`, `AlertDialogPortal` TO `AlertDialogContent`, which already mounts the portal and the overlay.
- FROM `BreadcrumbEllipsis`, `BreadcrumbSeparator` TO the same parts in the host's own tree (`npx shadcn@latest add breadcrumb`), or a `breadcrumb` schema node, which draws the separators and the collapsed-crumb ellipsis itself.
- FROM `CarouselContent`, `CarouselNext`, `CarouselPrevious` TO the same parts in the host's own tree (`npx shadcn@latest add carousel`), or a `carousel` schema node.
- FROM `CommandShortcut` TO a `kbd` element (or `Kbd`) inside `CommandItem`.
- FROM `ContextMenuCheckboxItem`, `ContextMenuGroup`, `ContextMenuLabel`, `ContextMenuPortal`, `ContextMenuRadioGroup`, `ContextMenuRadioItem`, `ContextMenuShortcut` TO the same parts in the host's own tree (`npx shadcn@latest add context-menu`), or the `@radix-ui/react-context-menu` primitive they wrap.
- FROM `DrawerOverlay`, `DrawerPortal` TO `DrawerContent`, which already mounts the portal and the overlay.
- FROM `useFormField` TO `FormLabel`, `FormControl`, `FormDescription` and `FormMessage`, which read the same field state.
- FROM `InputOTP`, `InputOTPSlot` TO the same parts in the host's own tree (`npx shadcn@latest add input-otp`), or an `input-otp` schema node.
- FROM `MenubarCheckboxItem`, `MenubarContent`, `MenubarGroup`, `MenubarLabel`, `MenubarPortal`, `MenubarRadioGroup`, `MenubarRadioItem`, `MenubarSeparator`, `MenubarShortcut`, `MenubarSub`, `MenubarSubContent`, `MenubarSubTrigger`, `MenubarTrigger` TO the same parts in the host's own tree (`npx shadcn@latest add menubar`), or a `menubar` schema node.
- FROM `NavigationMenu`, `NavigationMenuContent`, `NavigationMenuIndicator`, `NavigationMenuLink`, `NavigationMenuList`, `NavigationMenuTrigger`, `NavigationMenuViewport`, `navigationMenuTriggerStyle` TO the same parts in the host's own tree (`npx shadcn@latest add navigation-menu`), or a `navigation-menu` schema node.
- FROM `PaginationContent`, `PaginationEllipsis`, `PaginationItem`, `PaginationLink`, `PaginationNext`, `PaginationPrevious` TO the same parts in the host's own tree (`npx shadcn@latest add pagination`), or a `pagination` schema node.
- FROM `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator` TO `SelectContent`, which already draws the scroll buttons, and `Separator` between groups.
- FROM `TableCaption` TO a `caption` element inside `Table`.
