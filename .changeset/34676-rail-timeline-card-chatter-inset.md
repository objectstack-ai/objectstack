---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a discussion block in the record page's activity card keeps the card's inner padding

Clause-②: no
Metadata-protocol: none

The activity card at the foot of the record page's right column draws its body edge to edge, because the compact activity face it normally holds pads its own rows. A page whose `discussion` slot places `record:chatter` (or `record:discussion`) puts the full discussion timeline in that card instead, and that timeline padded only its top: the row icons sat on the card's left border, the composer's send button touched the right border, and long rows ran into it before wrapping.

Inside that card the discussion timeline now takes the same inset as the related-list cards above it (12 px at the sides and a 12 px band at the top and foot), with one divider under the card head. The compact activity face in the same card, and the discussion timeline in the Activity tab and on the page body, look exactly as before.
