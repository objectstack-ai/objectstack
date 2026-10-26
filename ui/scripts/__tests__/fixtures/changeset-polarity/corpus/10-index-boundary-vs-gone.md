---
'@object-ui/types': minor
---

The boundary fixture for objectui#9767. Three sentences, three symbols the
member index has no face for -- and one of the three is a different fact from
the other two.

**The symbol that lives in a declared dependency.** The published
`DepOnlySchema` declares `title` for every node the renderer mounts, and this
tree re-exports it rather than declaring it again.

**The symbol that lives in this repo, outside the indexed tree.** The
`RepoOnlySchema` face declares `rows`, and it sits in a sibling package that the
member index never walks.

**The symbol that lives nowhere.** The retired `VanishedSchema` declares
`legacyMode`, and no face anywhere still carries that name.
