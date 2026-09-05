---
'@objectstack/objectql': patch
'@objectstack/lint': patch
---

Stop reporting a declarative `operation: 'update'` action as "a button wired to nothing"

The boot action-governance inventory (ADR-0110 D5) built its `unboundDeclarations`
finding from a `type`-only test. The declarative single-record field write
(`operation: 'update'` + `patch`, #14092) is exactly the shape that test mistakes
for a dead button: `ActionSchema` refuses `target` and `body` beside it and keeps
`type` at its default `script`, because the platform action route is where the
write is performed. Every such action was named at every boot and every
`metadata:reloaded` — with a prescription ("add a `body`, or register a handler
under the declared `target`") that parse itself refuses.

Both readers now read `operation` before `type`, the precedence the runtime doors
already use: the engine inventory, and the authoring-time AI tool-reference rule,
which had diverged from the runtime's listing door and reported a resolvable
`action_<name>` reference as fictional.
