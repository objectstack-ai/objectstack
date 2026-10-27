---
'@object-ui/components': patch
'@object-ui/types': patch
---

fix(ui): a destructive action block confirms through the destructive button (#26665)

Clause-②: no
Metadata-protocol: none

The four action blocks (`action:button`, `action:icon`, `action:group`, `action:menu`) now forward their `variant` to the action runner, which reads it to paint the confirm button: a destructive block with a `confirmText` now asks its question through the destructive confirm button, where before it asked through a neutral one. `danger` / `primary` / `secondary` / `ghost` / `link` forward as they are, and `default` / `outline`, which an action's own `variant` has no word for, forward nothing. The destructive value is spelled `danger` on the blocks, the same word `ActionSchema.variant` uses (see the action block variant entry in this release).

`UIActionSchema.variant` (`@object-ui/types`) now takes the block rows' vocabulary by reference (`ActionButtonProps['variant']`), which adds `link`, a value those rows already accept.
