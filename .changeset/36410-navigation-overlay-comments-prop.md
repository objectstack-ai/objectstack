---
'@object-ui/components': patch
---

fix(components)!: `NavigationOverlay` drops its `comments` prop, which no caller fills

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/components#NavigationOverlayProps.comments) the retired operand is a prop of the drawer component in a published ui package entry; no packages/spec schema, no registered node type, no ADR-0087 conversion surface and no stored shape names it, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that passed `NavigationOverlay` its `comments` prop.

The record drawer took a comments switch and handed it to its top bar, ahead of the record's button group. Since the console stopped offering comments in the drawer, nothing passes it: a record's comments live on its full page, whose own bar draws the switch. The prop is removed so the drawer no longer advertises a slot no caller fills. `RecordTopBar` keeps its own `comments` slot: the record page fills it on the desktop and on a phone.

What leaves, and what to write instead:

- FROM `NavigationOverlayProps.comments` TO nothing, in the components package: the drawer's bar draws no comments switch. Fix: delete `comments` from the `NavigationOverlay` call; to show a record's comments, open its full page (the drawer's ⤢), where the bar draws the switch.
