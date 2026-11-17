---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a list read that registers stored rows no longer sends the reads after it to the store

Clause-②: no
Metadata-protocol: none

On a kernel whose list read (`getMetaItems`) registers the stored rows back into the schema registry, every list read moves `registry.revision`, even when it registers what is already there. Each move opened a new compile-cache bucket, and opening a bucket retired the `sys_metadata` row cache. So the list read and the item reads after it all went to the store. Measured with a list read of three stored objects followed by item reads, in alternation: 3 store reads per round with the compile cache on against 1 with it off (one item read), and 7 against 3 (three item reads).

A bucket opened by a counter move now keeps the row cache when its rows were read within the last bound, and its first bound ends one bound after they were read, so no answer carries a row more than one bound old. When the rows are older than that, opening the bucket retires them, as before. The same alternation now costs what it costs with the compile cache off.
