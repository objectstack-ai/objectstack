---
"@objectstack/lint": patch
---

`flow-template-unknown-field` and `flow-template-lookup-traversal` now reach a `{record.<field>}` template that sits outside a node filter — the `warning` half both rules already declared, and never emitted.

A `{record.<field>}` token in a filter has always been reported as an `error`: an unresolved token there erases the condition and the CRUD node refuses to run. A token anywhere else — a message body, an http request payload, a created row's field values — is the quiet failure the rules were written for: it renders as an empty string on every run, at authoring time and at run time alike, so a hand-off payload naming a renamed field ships an empty value and nothing anywhere says so. That half was silent.

The cause was one key, in the shared flow walk rather than in either rule. A rule that scans a node's config recursively has to read a view of it with the nested regions removed, or it reports every finding inside a `loop` / `try_catch` / `parallel` a second time against the container. That view was built by removing every key that holds a region on *any* node type — and `body` is `loop`'s region slot **and** the canonical request-payload key on an `http` node. So `config.body` was deleted from every node's view before any rule read it, and the whole of an http payload was invisible. The view now removes only the slots the node's own type declares, which is exactly the set the walk descended into: nothing is double-reported, and nothing that was never a region is dropped.

Expect new `warning` findings on flows that publish clean today. Each one names a token that renders empty at run time; `warning` does not change `os validate`'s exit code, so a build that passed still passes.
