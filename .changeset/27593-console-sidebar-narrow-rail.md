---
'@object-ui/components': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(console): on a narrow window the sidebar is the icon rail, and a click expands it over the content

Clause-②: yes (widening)
Metadata-protocol: none

On a 1280 px laptop window the expanded console sidebar left 1024 px of content, too little for a record's split view beside its list. Now:

- **The fold.** Below the width the record split needs beside an expanded sidebar (its 1160 px of content plus the 256 px sidebar, so 1416 px), the console sidebar mounts as the icon rail and the content takes the rest. At that width and above the sidebar behaves as before; below the phone breakpoint the drawer is unchanged. The width is derived in one named constant, `CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH`, from the sidebar's own width.
- **Expand over the content.** A click on the rail's background, the app bar's sidebar button or ⌘B / Ctrl+B expands the full sidebar over the page without moving it; choosing a navigation entry, a press outside it or Esc folds it again. Hovering does nothing, and a click on a rail icon still opens that entry.
- **Keep sidebar open.** While the rail is expanded, its foot offers "Keep sidebar open": pressed, the narrow window keeps the wide-window sidebar in this browser, and pressing it again brings the fold back.
- **The wide window keeps its state.** The open or collapsed state the reader chose on a wide window is no longer overwritten by the fold: it comes back when the window widens, and on the next load that opens wide.

`@object-ui/components`: new `useIsViewportBelow(breakpoint)` hook, `true` while the window is narrower than `breakpoint` CSS pixels, read synchronously on the first render and live through `matchMedia`. Nothing existing changes.

`@object-ui/i18n`: the `sidebar` namespace gains `sidebar.keepOpen` in all ten packs. No key is removed or renamed.
