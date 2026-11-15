---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a bare save of a name an enabled and a disabled package both hold writes the enabled holder's row, where the bare read serves it

Clause-②: no
Metadata-protocol: none

A save that names no package (`PUT /meta/:type/:name` with no `?package=`, or `saveMetaItem` with no `packageId`) now resolves its address the way the read at the same address does (ADR-0150 D3/D5). A disabled package holds nothing an address reaches. Before this fix the save door still counted a disabled package as a holder of the name. So when an enabled package E and a disabled package D both held the name, the save could:

- write a new package-unbound row, an environment-own item that shadows both packages once D is enabled again;
- update D's row silently, so the next read kept serving E's item and the edit never showed;
- refuse 409 naming D, while the read served E without ambiguity.

The bare save of such a name is now E's write (ADR-0150 D4). It writes E's row, D's row stays byte-unchanged, and D is never named. When two or more enabled packages hold the name beside the disabled one, the save refuses 409 and names only the enabled ones. When a package-unbound row already stands in for the item, the save edits that row, which is the one the read serves. Once D is enabled again, the bare read and the bare save both answer 409 naming both packages. A name no disabled package holds saves exactly as before. So does a name only disabled packages hold.

What moves, for a bare save of a name held by an enabled package E and a disabled package D:

- FROM D's row silently updated TO E's row written, D's row unchanged.
- FROM a package-unbound row written TO a row bound to E.
- FROM 409 naming E and D TO E's row updated (a widening: the save now writes where it refused).

Nothing to migrate. To edit D's own row while D is disabled, name it: `?package=` on the REST door, `packageId` in process.
