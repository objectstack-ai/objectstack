---
"@objectstack/plugin-audit": patch
---

fix(plugin-audit): localize the tracked-change activity label and render lookup titles instead of raw ids (#7230)

`sys_activity.summary` is composed at write time and shipped verbatim to every
feed surface at once — the record discussion feed, console home activity, the
header inbox, the Setup `sys_activity` list, and mobile/REST/SDUI. Its
tracked-change branch (ADR-0052 §5b, `"<label>: <old> → <new>"`) was producing
strings like `Rating Owner: ∅ → oBK25…` at the bottom of an otherwise
fully-localized page. Two independent causes, both fixed here:

- **The label was never localized.** `renderTrackedChangeSummary` was the one
  summary branch never handed the locale-bound `translate` its three siblings
  (`messages.activityCreated` / `messages.activityDeleted` /
  `messages.activityUpdated`, plus the object label via `displayLabelFor`) all
  resolve through — an oversight against ADR-0053 / #3039 write-time
  localization. The field label now resolves through the same translator, on the
  bundles' own key shape (`objects.<object>.fields.<field>.label`), and falls
  back to the authored `label`, then the machine key, exactly as before.
- **A reference value printed its raw id.** `displayFieldValue` resolved
  select/picklist option labels only, so a `lookup` / `master_detail` / `user`
  value fell through to `String(value)` — the stored 32-char id. It now renders
  the referenced record's title, resolved through ADR-0079's
  `resolveDisplayField` (`nameField` → deprecated `displayNameField` alias →
  derivation) rather than a local name-guessing heuristic.

The `∅ →` notation is unchanged, and so is every other summary branch. The
change is restore-invariant: an id that cannot be resolved — a target removed
out of band, an unregistered object, a failing read — renders exactly as it did
before.

**Read cost, measured with a counting driver** (the same technique that measured
#6656 / PR #6977's retirement of the redundant pre-image read from this write
path, and pinned as cases in `audit-lookup-summary.test.ts`):

- **0 added reads** on every create, every delete, every update that moves no
  tracked reference field, and every update that moves an *untracked* one —
  including on rows that do carry references. #6977's counts (1 `findOne` per
  single-id write, 0 per predicate write) are untouched.
- **1 read per distinct target object** on an update that does move a tracked
  reference: both sides of the change are answered by a single
  `id: { $in: [...] }` selecting only the id and title columns, however many
  tracked reference fields point at that object.

Historical `sys_activity` rows keep their original write-time composition — only
new writes improve.
