---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/react': patch
'@object-ui/i18n': patch
---

fix(app-shell): a record page whose comments or activity read fails (5xx, network) says it could not load them, with a Retry, instead of showing the empty state

Clause-②: yes (widening)
Metadata-protocol: none

On a record page, a comments read or an activity read that answered a server error used to settle the discussion panel on its empty state (「暂无评论」, "No activity recorded"), and the 动态 tab's badge on 0. A comment users wrote looked lost, and an outage was visible only in developer tools.

- **A failed read has its own state.** A 5xx, or a request that never got an answer, now shows "We couldn't load the comments for this record." (or the activity) with a Retry, in place of the empty state, on the 动态 panel, the 动态 tab and the discussion panel. Rows the other read answered stay on screen with the notice above them, and the count is unknown (no number) until the read answers.
- **Retry reads only what failed**, directly, never the page payload again. A retry that fails again keeps the notice.
- **Unchanged:** a refusal (401 / 403) keeps its no-permission state and is never retried; an empty 200, a 404 (a table the deployment does not serve), an object that withholds its API and a 400 keep the empty state.
- **New public members.** `DiscussionContextValue` gains the optional `activityFailed`, `commentsFailed` and `onRetryFeed`; `RecordActivityTimeline` and `RecordChatterPanel` gain the same three optional props; the `detail` locale namespace gains `activityLoadFailed`, `commentsLoadFailed` and `retryLoadFeed` in all ten packs.
- The attachments panel already showed its own load-failure state with a Retry for a failed read; that is now pinned for the record page payload's attachments part too.
