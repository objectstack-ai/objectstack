---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/runtime': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

Two more sentences on the print path now follow the request's language. The `/actions` door's `503` for a same-origin `type: 'api'` action it cannot forward in-process (the kernel exposes no `IHttpServer.getRawApp`), and the own-door bridge's `501 NOT_IMPLEMENTED` for the print door on a kernel with no print service, or with one that lacks `handlePrintDoor`, answered a fixed English `error.message` whatever the request's language, so a Chinese console showed a print action's toast in English.

The sentences are now keys of the platform's operation-message catalog (`BUILTIN_OPERATION_MESSAGES`, `@objectstack/spec/system`) in `en`, `zh-CN`, `ja-JP` and `es-ES`: `action_forward_unavailable` (REST and MCP doors), `action_forward_unavailable_host` (the host door, `dispatchAction`), `action_forward_target_unnamed`, `own_door_service_unregistered`, `own_door_member_missing` and the print door's noun, `own_door_print`. The `/actions` door renders its `503` in the caller's execution-context language (the request's top `Accept-Language` tag, then the workspace default, then `en`), as its other refusals do. The bridge reads the request's top `Accept-Language` tag; a bridge that names no noun key (the personal-view and attachment doors) keeps its English sentence. `operationUserMessage` (`@objectstack/core`) takes an optional third argument, `params`, to fill a key's placeholders; existing calls are unchanged.

Code, status and the English text do not change, and no `userMessage` is added: a request in English, with no `Accept-Language`, or in a language the catalog carries no text for, reads the same sentence as before. The `zh-CN`, `ja-JP` and `es-ES` wording of `print_timed_out` and of the `ja-JP` and `es-ES` `print_engine_unavailable` is reworded, and the catalog header now states that a `translation` item's `errors.print_*` entry is not consulted for those keys and that `Accept-Language` is read by its top tag only.
