---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
'@objectstack/core': patch
'@objectstack/service-i18n': patch
'@objectstack/plugin-sharing': patch
---

Wire three more Studio-authored metadata surfaces at runtime (#2605 — the
"declared but never wired" family, following the #2596 hooks template).

**Authored actions now execute (#2605 item 1).** `engine.executeAction`'s map
was only ever populated from the app bundle at boot, so a published `action`
row (standalone or embedded in an authored object's `actions[]`) was stored
and listed but never executable — before OR after a restart. Now:

- `AppPlugin` installs a QuickJS-sandboxed default action runner at boot
  (`engine.setDefaultActionRunner`), the action-path twin of the #2596 hook
  body runner. Opt out with `OS_DISABLE_AUTHORED_ACTIONS=1`.
- `ObjectQLPlugin` re-registers runtime-authored actions from their
  `sys_metadata` rows under `packageId: 'metadata-service'` at
  `kernel:ready`, on `metadata:reloaded`, and on `action`/`object` protocol
  mutations — saves, publishes, edits, and deletes take effect live.
  Package-artifact actions are excluded (AppPlugin owns those; re-registering
  would clobber their handlers).

**Authored translations reach the i18n runtime (#2591).** `translation`
metadata items (single-locale `AppTranslationBundle` payloads; locale from
`_meta.locale`, a top-level `locale`, or a BCP-47-shaped item name) now load
into the i18n service as a separate authored layer that overlays static
bundles. Both adapters carry the layer — service-i18n's `FileI18nAdapter`
AND the kernel's in-memory fallback (`createMemoryI18n`), which is what dev
and standalone stacks actually run. The shared sync
(`wireAuthoredTranslationSync`, exported from `@objectstack/core`, wired by
the runtime's AppPlugin and by I18nServicePlugin with single-owner
semantics) runs at `kernel:ready`, on `metadata:reloaded`, and on
`translation` protocol mutations, with clear-then-reload semantics so
deleted items/keys stop resolving instead of lingering in the deep-merged
map.

**Sharing rules created at runtime bind without a restart (#2592).**
`bindRuleHooks` was boot-only, so the first rule authored at runtime for an
object with no boot-time rule silently never evaluated (rule authoring is a
data insert — `metadata:reloaded` never fires). The sharing plugin now binds
afterInsert/afterUpdate/afterDelete triggers on `sys_sharing_rule` that
unbind + re-bind the rule-hook package from a fresh `listRules()`, serialized
so overlapping writes can't leave a stale snapshot bound, and fail-safe so a
rebind failure never fails the rule write.
