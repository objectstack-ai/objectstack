---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): while a phone list's cards are selecting, Enter or Space on a card's 「⋮」 ticks the card and opens no menu

Clause-②: no
Metadata-protocol: none

On the phone card list, a selection already turned every tap inside a card into a tick. A keyboard still reached the row menu: with focus on a card's 「⋮」 button, Enter, Space or ArrowDown opened it. While selecting, those keys now behave like a tap: Enter and Space tick or untick the card, ArrowDown does nothing, and no menu opens. After 「×」 ends the selection, the same keys open the menu again.
