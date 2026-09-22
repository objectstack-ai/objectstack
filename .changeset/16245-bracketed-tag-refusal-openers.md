---
'@objectstack/metadata-protocol': minor
---

Refusal messages no longer open with a bracketed tag restating the `code` the same throw declares — `error` carries the human sentence, `code` carries the machine token, and the token is no longer duplicated onto the prose axis.

Clause-②: yes

Every refusal `ObjectStackProtocolImplementation` and `SysMetadataRepository` raised opened with a lowercase `[tag]` that was the restatement of the `code` that very throw declared: `[no_draft]` in front of `NO_DRAFT`, `[item_locked]` in front of `ITEM_LOCKED`, and so on for 38 throw sites across the two producers. They were not invisible. `withoutDeclaredCodePrefix` strips a leading restatement only when the message opens with the declared code followed by a colon (`INVALID_REQUEST: …`); the bracketed lowercase spelling matches neither the casing nor the separator, so it was never stripped and reached the caller in `error.message`. The repo's own de-duplication mechanism existed and did not fire here.

The maintainer ruling of 2026-08-29 on the `/data` door shipping `FORBIDDEN:` in front of a localized refusal is ONE envelope semantics — `error` is HUMAN LANGUAGE, `code` is the MACHINE TOKEN — and a prefix is removed *because* the same fact already rides the `code` axis. All 38 met that condition by construction.

## FROM → TO

| before | now |
| --- | --- |
| `error: "[no_draft] No pending draft exists for view/task_list."` | `error: "No pending draft exists for view/task_list."` |
| `error: "[item_locked] view/task_list is locked (_lock=…)."` | `error: "view/task_list is locked (_lock=…)."` |
| `error: "[NOT_OVERRIDABLE] 'action' is not allowOrgOverride…"` | `error: "'action' is not allowOrgOverride…"` |

**`code` is unchanged on every one of them**, and it is where the token always also was — `NO_DRAFT`, `ITEM_LOCKED`, `NOT_OVERRIDABLE`, and the 14 others. A reader matching `error.message` for `[<tag>]` reads `error.code` for `<TAG>` instead; a reader already using `code` needs no change. The HTTP `status` is untouched.

- **Measured, not assumed, before it was removed**: 37 literal openers plus one written as `` `[${code}]` `` from the same variable the throw assigns to `err.code` three lines down — that one spelled by interpolation, so it was invisible to every grep for a literal tag and is absent from the card's own inventory.
- **Nothing consumed the tag.** The only consumers found anywhere are strippers: `@object-ui/react`'s `extractWriteErrorMessage` and two `plugin-detail` call sites each remove a leading bracketed prefix before showing the sentence to a user, next to the `SCREAMING_SNAKE:` strip. They confirm the tag was arriving and they cannot break on its absence — the regex simply matches nothing.
- **Two bracketed vocabularies are deliberately kept**: the `path [zod code]` locators inside a validation headline and the `[rule]` locators the author-time gate composes. Neither restates a declared `code` — they name WHICH finding, a fact the envelope carries nowhere else.
- **Pinned as an absence**, because nothing else would notice one coming back: a re-introduced tag reds exactly one per-door pin and a newly-written refusal reds none.
