---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): contributed navigation entries are translated again, the whole Setup sidebar among them

Clause-②: no
Metadata-protocol: none

`getPackagedAppBase(name)` now answers the app's packaged declaration with the code layer's navigation contributions folded in, by the one fold every served app read applies (`SchemaRegistry.applyNavContributions`, ADR-0029 D7). Before, it answered the declaration alone, so `translateApp` read every contributed entry's id as one a `.custom` override authored (ADR-0146 D2), skipped the catalog and served the source text: on a `zh-CN` deployment every Setup leaf entry (Users, Permission Set Assignment, Sharing Rules, API Keys and the rest) read English beside Chinese group headings, although the catalog carries their keys. Contributed entries now read the catalog's translation; the served app's shape is unchanged, only label values move. A navigation node a `.custom` override authors is in no contribution, so it still reads only the pair's translations, else its own text.
