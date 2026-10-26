---
'@object-ui/types': patch
---

The (interface, name) pin. A schema named in a MEMBER'S VALUE is a different
object, so this entry states only what is true: `ObjectKanbanSchema` declares
`columns`. The lane that `columns` carries is the object that declares a lane's
own keys, and the member index must not read them as the board's -- the test
asserts that on the index itself, because a corpus can only ever ask about
sentences somebody wrote.
