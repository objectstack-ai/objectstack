---
'@objectstack/runtime': patch
'@objectstack/spec': patch
'@objectstack/types': patch
---

fix(runtime): the mounted-but-unimplemented `501` of `/ai`, `/automation`, `/notifications`, `/ui` and a custom flow endpoint answers in the request's language

Clause-②: yes (widening) — `@objectstack/spec` `BUILTIN_OPERATION_MESSAGES` gains `capability_unavailable_install`, `capability_unavailable_unshipped`, `capability_unavailable_ui`, `capability_unavailable_ai` and `capability_unavailable_search` in every locale; `@objectstack/runtime` `HttpDispatcherResult.response` gains the optional, never-written `faultLogMessage`
Metadata-protocol: none

When a dispatcher domain's route is mounted and nothing implements the capability behind it, it answers `501 NOT_IMPLEMENTED` with the remedy sentence discovery reports for the slot. That sentence was fixed English for every reader. It now follows the request's top `Accept-Language` tag, as the other domain `501`s already do, and carries `Vary: Accept-Language`, so a shared cache cannot hand one reader's language to the next. The same holds for a custom API endpoint whose flow target finds no automation service.

- The English sentence, the status and `error.code` are unchanged byte for byte. A request with no `Accept-Language`, or with a language the catalog does not carry, reads exactly the English it read before.
- Discovery's `services.<slot>.message` stays English: it is read by SDKs, codegen and AI clients, and a host-level `/discovery` has no request to read a language from. A pin holds the `501`'s English equal to `serviceUnavailableMessage(slot)` for every slot, so the two still name the same remedy.
- The operator's fault log stays English: the one line a declared capability absence earns per route per process prints the English sentence whatever language the first request asked for.
- zh-CN now says 「定制包」 for the customization package in the three operation sentences that said 「定制软件包」, the term the console uses.

Nothing to migrate.
