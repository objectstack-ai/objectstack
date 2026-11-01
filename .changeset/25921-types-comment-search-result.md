---
'@object-ui/types': patch
---

refactor(types)!: retire the zero-consumer `CommentSearchResult` interface

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/types#CommentSearchResult) the retired operand is a TypeScript interface for a cross-record comment search result; its only producer, the `useCommentSearch` hook of `@object-ui/collaboration`, already retired, and nothing in the workspace or in hotcrm reads the type; no packages/spec schema, registered node type, conversion surface or stored shape names it, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports the type `CommentSearchResult` from `@object-ui/types`. It described the hits of a comment search the packages no longer ship. `CommentEntry`, `MentionNotification` and `ActivityEntry` stay exported unchanged.

- FROM `CommentSearchResult` TO a local interface in your own code: `{ comment: CommentEntry; objectName: string; recordId: string; highlight?: string }`.
