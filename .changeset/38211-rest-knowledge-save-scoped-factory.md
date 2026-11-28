---
'@objectstack/rest': patch
---

fix(rest): the `knowledge_source` save reads a scoped knowledge factory in the request's environment, and answers its miss as the dispatcher does

Clause-②: yes (widening) — `@objectstack/rest`'s exported `RestServer` constructor takes an optional trailing `classifiedKernelServiceProvider`, which makes `ClassifiedKernelServiceLookup` reachable
Metadata-protocol: none

- **What was wrong.** On a host that registers `knowledge` as a scoped factory, `PUT /meta/knowledge_source/:name` over REST read the service without the request's environment as its scope. On a single kernel the lookup could not build a factory at all, so every author's save was refused `503 SERVICE_UNAVAILABLE` with "this deployment runs no knowledge service", including a save in an environment the factory serves. On a host that fronts environment kernels, the same save was refused `503` because the service "could not be judged (Scope ID required for scoped service 'knowledge')". The runtime dispatcher's `/meta` save already named the environment for a real miss.
- **What changes.** `RestApiPlugin` reads `knowledge` in the request's environment, using the environment id as the scope id. A plain instance ignores the scope id, so the platform's `KnowledgeServicePlugin` path is unchanged. A factory that serves the environment is now asked, and the save is admitted. A factory that serves no instance there is refused `503 SERVICE_UNAVAILABLE` with the same sentence the dispatcher answers, which names the environment and does not point to the stack's `requires`. A deployment with nothing registered under `knowledge` keeps the no-service sentence. A request that names no environment, made against a scoped registration, is refused `503` as a lookup that could not be made: the registry rejects a scoped read that names no scope, and the dispatcher's lookup keeps that rejection loud as well.
- **Who is affected.** Only a host that registers its own scoped `knowledge` factory. No action is needed.
