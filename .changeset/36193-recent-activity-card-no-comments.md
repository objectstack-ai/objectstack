---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the overview's 最近动态 card lists the system history alone while the comment panel holds the comments, on a slotted page with a `record:chatter` stream too

Clause-②: no
Metadata-protocol: none

- On a page whose `discussion` slot holds `record:chatter` or `record:discussion`, the 概览 tab's 最近动态 card drew the chatter's own panel face: a 「讨论 (N)」 heading counting comments, the 全部动态 filter, every comment and its replies, and 加载更多. While the comment panel is offered (desktop page, objectstack#36075), the card now draws that stream as the `record:activity` block its `feed` configures, in the peek face the default page's card already uses: the newest three system entries, no comment or reply, no 讨论 heading, and a count of the system entries alone. With no system history the card is not drawn, whatever the comments.
- The card keeps that count to itself: the 动态 tab still draws the chatter with its comments, so its label in the tab row is unchanged.
- Not changed: the 动态 tab, the comment panel, the default page's card (already system history only), the drawer (draws no rail), the phone (no comment panel), and an authored page.
