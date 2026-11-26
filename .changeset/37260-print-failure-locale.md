---
'@objectstack/spec': patch
'@objectstack/service-print': patch
---

Clause-②: no
Metadata-protocol: none

The print door (`POST /api/v1/print/records`) now answers its own 5xx sentences in the request's language. A print that fails on the server because the print engine is not ready (`503`), ran past its time (`504`), failed for any other reason (`500`), or could not resolve its caller (`500`) used to answer a fixed English `error.message` whatever the request's `Accept-Language`, so a Chinese console showed the toast in English. The sentences are now four keys of the platform's operation-message catalog (`print_engine_unavailable`, `print_timed_out`, `print_failed`, `print_caller_unresolved` in `BUILTIN_OPERATION_MESSAGES`, `@objectstack/spec/system`) in `en`, `zh-CN`, `ja-JP` and `es-ES`, written through `operationUserMessage` (`@objectstack/core`) in the request's top `Accept-Language` tag. A print clicked as a `type: 'api'` action answers the same way: the `/actions` door forwards the caller's `Accept-Language` and relays the door's `message` as written.

Code, status and the English text do not change: a request in English, with no `Accept-Language`, or in a language the catalog carries no text for, reads the same sentence as before. What the engine or the host said is still withheld from the wire and kept in the server fault log.
