---
'@object-ui/collaboration': patch
---

refactor(collaboration)!: retire the zero-consumer `useCommentSearch` and `createPresenceUpdater` exports

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/collaboration#useCommentSearch, @object-ui/collaboration#CommentSearchConfig, @object-ui/collaboration#CommentSearchReturn, @object-ui/collaboration#createPresenceUpdater) the retired operands are a React hook, its two option and result types, and a plain helper factory in a published ui package's entry that nothing in the workspace imported; no packages/spec schema, no registered node type, no ADR-0087 conversion surface and no stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these four names from `@object-ui/collaboration`. None had an importer anywhere in the workspace, so the Console and every `@object-ui/*` package are unaffected. `useCommentSearch` is deleted with its module; `createPresenceUpdater` leaves the package entry only. Everything else the entry exports is unchanged, including `usePresence`, `PresenceProvider`, `CommentThread` and their types.

What leaves, and what to write instead:

- FROM `useCommentSearch` TO a `useMemo` over your own comment list that keeps the entries whose `text` or `author` contains the trimmed, lower-cased query.
- FROM `CommentSearchConfig` TO `{ comments: CommentEntry[] }`, with `CommentEntry` from `@object-ui/types`.
- FROM `CommentSearchReturn` TO the shape your own search state returns; the result rows can keep using `CommentSearchResult` from `@object-ui/types`.
- FROM `createPresenceUpdater` TO a `Map<string, PresenceUser>` keyed by `userId` that you update from your realtime channel, or `PresenceProvider` with `useTenantPresence` / `useRecordPresence`, which the package keeps exporting.
