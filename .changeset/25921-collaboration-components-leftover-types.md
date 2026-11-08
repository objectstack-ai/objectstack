---
'@object-ui/collaboration': patch
'@object-ui/components': patch
---

refactor(collaboration, components)!: retire two zero-consumer type exports from the package entries (`CollaborationTranslate`, `MobileDialogContentProps`)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/collaboration#CollaborationTranslate, @object-ui/components#MobileDialogContentProps) the retired operands are two TypeScript type aliases, the translate-function type of the collaboration package's i18n hook and the props type of the components package's mobile dialog content; nothing in the workspace or in hotcrm imports or names either outside its package, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports `CollaborationTranslate` from `@object-ui/collaboration` or `MobileDialogContentProps` from `@object-ui/components`. Neither had an importer or a mention anywhere outside its package, in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Nothing renders differently.

Both stay in their modules, which their package's own code still reads; only the entries stop publishing them:

- `CollaborationTranslate` types the `t` that `CommentThread` and `PresenceAvatars` pass to their timestamp and status helpers.
- `MobileDialogContentProps` is the props type of `MobileDialogContent`, and the props stay recoverable as `React.ComponentPropsWithoutRef<typeof MobileDialogContent>`.

Every other name the two entries exported stays exported unchanged, among them `useCollaborationTranslation`, `COLLAB_DEFAULT_TRANSLATIONS`, `CommentThread`, `PresenceAvatars` and `MobileDialogContent`.

What leaves, and what to write instead:

- FROM `CollaborationTranslate` TO `ReturnType<typeof useCollaborationTranslation>['t']`, the expression the type was defined as.
- FROM `MobileDialogContentProps` TO `React.ComponentPropsWithoutRef<typeof MobileDialogContent>`.
