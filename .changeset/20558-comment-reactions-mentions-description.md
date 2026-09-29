---
'@objectstack/plugin-audit': patch
---

`sys_comment.reactions` and `sys_comment.mentions` now describe the shape they actually store (#20558)

The two field descriptions are served metadata (field help in the console, and what an AI client reads before it seeds a comment), and both named a shape no producer writes:

| Field | Description was | Description is now | Stored value |
| --- | --- | --- | --- |
| `reactions` | `JSON array of emoji reaction objects` | `JSON object mapping each emoji to the list of user ids who reacted` | `{"👍":["usr_1","usr_2"]}` |
| `mentions` | `JSON array of @mention objects` | `JSON array of the user ids @mentioned in the comment` | `["usr_1","usr_2"]` |

The console's record discussion panel reads and writes `reactions` as that map, and writes `mentions` as that list of ids; the `collab.mention` notification hook reads the ids.

Description text only: no stored value, validation rule or hook changes, and nothing to migrate. The English translation bundle is regenerated from the source description, and the zh-CN, ja-JP and es-ES help texts for both fields are rewritten to match (values only, no key added or dropped).
