---
'@objectstack/metadata-core': patch
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(runtime): a knowledge source save refused for a scoped-factory miss says so, and the package duplicate words its remedy for its caller

Clause-②: no
Metadata-protocol: none

- **`@objectstack/metadata-core`.** `authoredKnowledgeSourceRefusal` takes an optional `door` (`'save'`, the default, or `'duplicate'`). With `'duplicate'` each refusal it composes tells the caller to duplicate the package again, and does not say "Nothing was written". A door's knowledge lookup can now answer `knowledgeServiceNotInScope(scopeId)` when a `knowledge` registration serves no instance in the request's environment, a host's scoped factory for example. That save is refused `503 SERVICE_UNAVAILABLE` with its own sentence, which names the environment and does not say the deployment runs no knowledge service or point to the stack's `requires`. The `/meta` save's sentences are unchanged.
- **`@objectstack/runtime`.** The dispatcher's `/meta` save, the MCP `save_metadata_draft` tool and the package duplicate now tell a scoped-factory miss apart from a deployment with no knowledge service, through the new optional `DomainHandlerDeps.classifyServiceOrLoud`. A deps without that member answers both misses as before. The duplicate door's refusal now says once that nothing was copied, and tells the caller to duplicate the package again. The platform's own `KnowledgeServicePlugin` registers a plain instance, so its path is unchanged.
- **`@objectstack/spec`.** The upgrade-guide entry `knowledge-source-save-refused-without-knowledge-service` now names only a deployment whose stack neither declares `requires: ['knowledge']` nor ships a `knowledgeSources` entry. A stack that ships a source already mounts the service.
