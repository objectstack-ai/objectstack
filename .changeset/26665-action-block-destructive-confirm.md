---
'@object-ui/components': patch
'@object-ui/types': patch
---

fix(ui): a `destructive` action block confirms through the destructive button (#26665)

Clause-②: no
Metadata-protocol: none

The four action blocks (`action:button`, `action:icon`, `action:group`, `action:menu`) now forward their `variant` to the action runner. `@objectstack/spec` spells the value in two dialects, each on its own surface: the blocks' rows take the Button primitive's vocabulary plus `primary`, and `ActionSchema`, which the runner dispatches, takes `primary | secondary | danger | ghost | link`. The forward translates: `destructive` becomes `danger`, `primary` / `secondary` / `ghost` / `link` pass through, and `default` / `outline` forward nothing. So a block declared `variant: 'destructive'` with a `confirmText` now asks its question through the destructive confirm button, where before it asked through a neutral one.

`UIActionSchema.variant` (`@object-ui/types`) now takes the block rows' vocabulary by reference (`ActionButtonProps['variant']`), which adds `link`, a value those rows already accept. `danger` stays refused there, as the block rows refuse it.
