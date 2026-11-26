---
'@object-ui/plugin-kanban': patch
---

fix(plugin-kanban): a collapsed lane's Chinese, Japanese or Korean title reads upright, top to bottom

Clause-②: no
Metadata-protocol: none

A collapsed kanban lane draws its title down a narrow spine. The title was set vertical and then turned 180°, which reads well for a Latin title (bottom to top, like a book spine) but stood every Chinese, Japanese or Korean character on its head, so a lane such as 「已取消」 could not be read. A title that contains Han, kana or Hangul now drops the turn and sets every character upright, reading top to bottom; a title in Latin script renders as before.
