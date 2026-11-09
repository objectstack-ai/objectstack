---
'@objectstack/skills': patch
---

docs(skills): objectstack-automation says how a `subflow` / `map` child flow name resolves, and when it is refused

Clause-②: no
Metadata-protocol: none

The `subflow` and `map` rows of `skills/objectstack-automation/SKILL.md` now teach the engine's bare-name rule for `config.flowName` (ADR-0150 D3, `resolvePackageScopedName`): a package's flow reaches its own package's flow, else the one holder in its declared `dependencies` closure plus `sys` packages; a package-less flow reaches the environment's flow, else the one package holder. Anything else passes `os validate` and fails the node at run time with the resolver's sentence and no error code, under one of three reasons: `outside-closure` (only an undeclared package or an environment-authored flow holds the name), `ambiguous-in-closure` and `ambiguous-in-environment` (two package holders, reachable only from a clash older than install's one-holder refusal). A `map` fails at its first item. The automation evals gain a case that declares the dependency on the child flow's package.
