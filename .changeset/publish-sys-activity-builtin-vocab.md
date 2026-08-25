---
'@objectstack/spec': minor
'@objectstack/plugin-audit': patch
---

Publish the built-in `sys_activity.type` vocabulary from `@objectstack/spec` (#11807).

`SYS_ACTIVITY_BUILTIN_TYPES` (and the derived `SysActivityBuiltinType` union) is now exported from `@objectstack/spec/data` (`feed.zod.ts`, alongside `FeedItemType`), and the `sys_activity` object declaration in `@objectstack/plugin-audit` derives its `type` options from it — one source instead of a hand-copied list per consumer.

The constant is the platform's **built-in set, not the column's value domain**: `sys_activity.type` stays an open, author-extensible vocabulary (#11507 ruling — an app may contribute values via `activityMilestones[].type`, ADR-0052 §5b.2, or its own inserts, and undeclared values are stored verbatim). It is deliberately a plain `as const` tuple rather than a `z.enum`, so it cannot be used as a validator; consumers must render unknown values, never drop them. UI packages that hand-copied the list (objectui's feed-kind census, which drifted the day #11522 added `scheduled`) can now read this export instead.
