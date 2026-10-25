---
'@object-ui/types': patch
---

The key-extraction pin (objectui#9766). A backticked span has to BE a name
before it can be a key. `SpinnerSchema` declares `retirementTombstone()` for the
key it retired, and inherits the rest through
`extends Omit<Partial<BaseSchema>, 'className'>` in the barrel that writes
`export { SpinnerSchema as LoaderSchema }`, which the call site reaches through
`as any`. None of those spans names a key, so none of them may be read as one.

The half a character class cannot decide. `SpinnerSchema` declares `size`, typed
`string` — two lowercase words, lexically identical, and only one of them is a
key of this protocol.

The leg that a keyword blacklist would break: `SpinnerSchema` declares no
`type`. That word IS one of the language's own, and it is also the protocol's
recursion point, so refusing it by its spelling would lose the most-declared key
in the tree.

The leg that a "must be declared somewhere" rule would break: `SpinnerSchema`
declares `onCardAdd`. This tree carries that name on zero faces, which is
exactly the shape of a claim that has ROTTED, and the reason this instrument
exists.
