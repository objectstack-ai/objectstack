---
'@objectstack/plugin-audit': minor
'@objectstack/spec': minor
---

feat(plugin-audit)!: `sys_comment.reactions` retires; an emoji reaction lives only in `sys_comment_reaction`, and reactions stored in the old column are converted into `sys_comment_reaction` records by `os migrate comment-reactions`

Clause-②: no (narrowing)

<!-- adr-0087: registered sys-comment-reactions-column-retired -->

**BREAKING**, shipped as `minor` under the repo's convention for breaking changes on this line.

**Existing emoji reactions stored in `sys_comment.reactions` survive the upgrade.** They stay in the column, which no screen or API returns, until `os migrate comment-reactions` converts them into `sys_comment_reaction` records, and `os migrate apply --allow-destructive` drops the column only after that conversion is verified (see *Existing databases* below). Reactions now live in `sys_comment_reaction`, one row per comment, emoji and user, the reacting user's own record. Where the entry that introduces `sys_comment_reaction` says the column is unchanged, this entry supersedes it: the column retires.

- **`sys_comment`** (`@objectstack/plugin-audit`) no longer declares `reactions`. Nothing takes its place on the comment row: no stored aggregate, and no block computed on read. Its label leaves the four generated translation bundles.
- **The data door refuses the field.** A create or an update of a comment that still carries `reactions`, and a list filter on it, answer `400 INVALID_FIELD` naming the field, and nothing is written. The rest of the payload is not applied either. A read of a comment no longer returns `reactions`.
- **`@objectstack/spec`**: the protocol-18 step of the ADR-0087 migration chain gains the semantic entry `sys-comment-reactions-column-retired`, so `os migrate meta` and the upgrade guide carry the prescription below.

**What moves for consumers.**

| You wrote | Write instead |
|:---|:---|
| `sys_comment.reactions` read as a map of emoji to user ids | one read of `sys_comment_reaction` for the comments on screen (`comment_id` `$in` their ids), grouped by comment and emoji |
| an update of `sys_comment` that rewrites `reactions` to add or remove a user | create the user's own `sys_comment_reaction` row (`comment_id`, `emoji`) to react; delete that row to un-react |
| `reactions` in a seed row, filter or list-view column on `sys_comment` | delete it |

An application that shows reactions grants `sys_comment_reaction` read, create and delete beside its `sys_comment` grant; without it a member cannot react. The console's record chatter already reads and writes `sys_comment_reaction` rows wherever the deployment declares that object, as this framework does.

**Existing databases — nothing moves automatically.** Schema sync is additive: the physical `reactions` column stays with the values it holds, the boot drift report names it orphaned (`sys_comment.reactions: column exists in the database but not in metadata`), and the boot is otherwise clean. The data door neither returns nor accepts the column. Convert first, then drop. `os migrate comment-reactions` previews the conversion and writes nothing; `os migrate comment-reactions --apply` turns each stored (comment, emoji, user) into that user's own `sys_comment_reaction` record, in the comment's organization, lists every stored value it cannot read instead of guessing at it, and records the run verified once every stored value has read and converted. A re-run converts nothing twice. Only then does `os migrate apply --allow-destructive`, run with the audit plugin composed (an auth secret resolves), drop the column; before a verified run is recorded it refuses the drop and exits `1`, because the drop would delete the reactions.
