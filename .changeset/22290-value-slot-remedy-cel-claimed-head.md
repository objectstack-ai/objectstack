---
'@objectstack/spec': patch
---

A value-slot `{…}` refusal now names a CEL spelling that evaluates when the path's head variable is named like a CEL type or keyword (`{list.0}` → `vars["list"][0]`)

Clause-②: no

The refusal for a `{…}` path token in a flow value slot (`valueSlotTemplateRefusals` / `flowNodeValueTemplateRefusals`, shown by `objectstack validate`, `registerFlow` and the executors) printed the path as bare CEL. For a head variable named `list`, that remedy was `list[0]`, and CEL read `list` as its own type, not the variable: `objectstack validate` refused the remedy it had just suggested (`Cannot index type 'type' with type 'int'`), and the bare `{list}` remedy `list` passed validation and evaluated to the type instead of the variable's value. A head that CEL claims for itself is now read through the flow scope's `vars` map, the route a `$`-named head already took: `{list.0}` → `vars["list"][0]`, `{list}` → `vars["list"]`.

The claimed names are read off the CEL implementation the formula engine builds (cel-js 8.0.0): the type identifiers `bool`, `bytes`, `double`, `int`, `list`, `map`, `null_type`, `string`, `type` and `uint`; the namespaces `cel`, `google` and `optional`; the reserved words, such as `for`, `if` and `var`; and the keywords `true`, `false`, `null` and `in`. `timestamp`, `duration` and `dyn` are functions there, not bindings, so a variable with one of those names already read correctly and is unchanged. A later path segment that is a keyword is indexed by name (`{record.in}` → `record["in"]`). The `has()` guard the refusal suggests is now printed only where `has()` accepts it. CEL refuses `has()` over an index at run time (`has(rows[0].name)`, `has(vars["list"].tags)`), so a path with an index gets no guard, and a claimed head is guarded as `has(vars.list.tags) ? vars.list.tags : null`.

Ordinary heads (`record.owner`, `items[0]`) print the same remedy as before. Which strings are refused and which are kept is unchanged; only the remedy text changes.
