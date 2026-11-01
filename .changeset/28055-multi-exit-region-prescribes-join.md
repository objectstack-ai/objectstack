---
'@objectstack/spec': patch
---

fix(spec): a flow region refused for having more than one exit is told how to join them

Clause-②: no
Metadata-protocol: none

A `loop` body, a `parallel` branch or a `try_catch` try/catch region must still have exactly one exit (ADR-0031), and registration still refuses one that has more. The refusal used to name the exits and stop there, so an author whose region branches had to find the fix by trial. It now says what to add:

```text
try_catch 'tc' try: region must be single-exit but has 2: x, y — add one node with an edge from each of x, y to it, so it is the region's only exit; an `assignment` node with no `config` sets nothing and can be that node
```

What a flow may contain does not change: the same regions are accepted and refused as before, at the same place, and only the sentence is longer.
