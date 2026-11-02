---
'@object-ui/components': patch
---

fix(components): dropdown-menu rows and tabs are 44 px touch targets at phone width

Clause-②: no
Metadata-protocol: none

Below the `sm` breakpoint every `DropdownMenu` row (`DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem` and `DropdownMenuSubTrigger`) was 32 px tall and every `TabsTrigger` 38 px, under the 44 px touch target the phone-width Console is held to. Below `sm` each of them is now at least 44 px tall (`max-sm:min-h-11`), and `TabsList` drops its fixed `h-10` there (`max-sm:h-auto`) so it grows with its triggers. From `sm` up their classes are unchanged, so desktop menus and tab strips look and measure as before. Every record "more" menu, list row-action menu and tab strip built on these primitives gets it. `dropdown-menu.tsx` and `tabs.tsx` are Shadcn-synced files, so the change is declared in `ui/scripts/shadcn-local-patches.mjs` and re-applied on every `pnpm shadcn:update`. No export or prop changes.
