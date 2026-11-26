---
'@object-ui/i18n': patch
'@object-ui/plugin-detail': patch
'@object-ui/components': patch
---

fix(i18n): the record timeline's events chip reads 事件 / Events, and the Chinese stream says 动态, never 活动

Clause-②: no
Metadata-protocol: none

The record page's 动态 tab drew its chips as 「全部 · 活动 · 讨论 · 变更」, so an app with an object named 活动 (a CRM's meetings and calls) showed 活动 twice on one screen with two meanings, and the English tab Activity held a chip also named Activity. The chips now read 「全部 · 事件 · 讨论 · 变更」 (zh-Hant the same), Events in English, and each other pack's own word for events (Ereignisse, Eventos, Événements, イベント, 이벤트, Eventos, События, الأحداث). What each chip holds is unchanged: 变更 / Changes keeps the audit-sourced field changes, and created, updated, assigned and shared rows stay under the events chip.

In zh-Hans and zh-Hant the rest of the stream takes the tab's word: the empty state reads 「暂无动态」 (「暫無動態」), the stream title `detail.activity` reads 「动态」 like `detail.timeline`, and the access-denied, load-failed and filter labels say 动态. The English chip's in-code fallback follows the pack, and the tab strip's Chinese token map reads an `Activity` tab as 动态 / 動態, matching `detail.activity`. Values only: no key is added, renamed or removed.
