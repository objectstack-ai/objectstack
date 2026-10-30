---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the bell's header breakdown names its unit, unread topics, so it agrees with the grouped row it counts

Clause-②: no
Metadata-protocol: none

With three unread notifications about one topic and three pending approvals, the inbox header read "4 total · 1 notification + 3 pending approvals" while the one coalesced row read "×3 · 3 unread". Both numbers were right, in different units. The first addend of the breakdown now reads "1 unread topic" (`notifications.badgeNotifications`, reworded in all ten packs, same key and plural family). The badge arithmetic is unchanged: unread topics plus pending approvals.
