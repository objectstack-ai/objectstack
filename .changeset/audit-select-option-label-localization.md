---
"@objectstack/plugin-audit": patch
---

fix(plugin-audit): localize select option labels in the tracked-change activity summary (#7289)

`sys_activity.summary` is composed at **write time** and shipped verbatim to
every consumer at once — the record discussion feed, console home activity, the
header inbox, the Setup `sys_activity` list, and mobile/REST/SDUI.
`displayFieldValue` rendered a select/picklist value by scanning `field.options[]`
and returning the matching option's **authored** `label`. `field.options` comes
from `engine.getSchema(name)`, which is locale-independent metadata, while the
shipped bundles carry those same labels under
`objects.<object>.fields.<field>.options.<value>` (`sys_audit_log.fields.action.options.create = "创建"`).
Nothing on this path read them.

After #7230 localized the field label, that left a zh-CN workspace with

```
阶段: Proposal → Closed Won
```

— a half-localized string at the bottom of a fully-localized page. The tracked-change
branch now resolves the option label through the same locale-bound translator its
field label already uses, on the bundles' own key shape, with the authored label as
the fallback. A bundle miss returns `undefined`, so the authored label and then
`String(value)` answer exactly as before: the change can only replace an authored
label with that label's translation, never the reverse.

**The fired-milestone branch is deliberately left alone**, and the opt-out is by
construction rather than by omission — `renderMilestoneSummary` passes no option
resolver, so a select token there still renders its authored label byte-for-byte.
A milestone summary is an author-written sentence with no bundle key of its own,
and #7290 ruled leaving templates untranslated a contract decision. #7290's own
change (a reference id → the referenced record's title) is locale-*independent*
data — the same string in every locale — which is why it could be added to an
untranslated sentence; an option label is locale-*dependent* rendering, so reading
the bundle there would guarantee a split sentence (`Deal moved to 已赢单`) in
exactly the case the bundle exists for. The tracked-change branch has the opposite
geometry: its frame is fully localized, so there the authored value is the mismatch.

**Read cost is unchanged.** This is a bundle lookup, not I/O: zero added reads on
every write shape, so the #6656 / PR #6977 retirement (2 → 1 reads per single-id
write, 3 → 0 per predicate write) that #7291 and #7333 preserved still stands,
and `displayFieldValue` stays synchronous.

Historical rows keep their write-time composition; only new writes improve.
