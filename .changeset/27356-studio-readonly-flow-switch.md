---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(studio): a read-only package's flow Enabled switch no longer looks like a live control

Clause-②: no
Metadata-protocol: none

- **Before.** In Studio's Automations pillar, a read-only (code) package's flow showed its Enabled switch with a green track. The switch was already disabled, but it read as one the author could flip.
- **Now.** On a read-only package the track is muted and a lock sits beside the word. The thumb position, the word (Enabled or Disabled) and `aria-checked` still say whether the flow is on. The read-only reason on the wrapper is unchanged.
- **Unchanged.** A writable package's switch keeps its green track and stays operable.
