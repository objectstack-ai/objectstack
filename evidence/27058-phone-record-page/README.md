# Phone record page — 390 x 844 evidence

Chromium (Playwright) mobile emulation: viewport 390 x 844, deviceScaleFactor 2,
`isMobile` and `hasTouch` on, locale zh-CN. The console runs from this branch's
source (vite) against `examples/app-crm` served by this branch's own server
(`pnpm dev --fresh`), signed in as the dev admin. `evidence.cjs` is the script
that took every shot; `run.log` is its output: each shot's route and the bottom
action bar's box (`y + h = 844`: the bar sits on the viewport's bottom edge in
every record shot, scrolled or not), and the scroll positions read before a push
and after the way back.

| Shot | What it shows |
|:--|:--|
| 01-lead-list | The lead list: the title switcher 「全部线索 ▾ · 5」 leads the toolbar row, with the filter and display icons; card rows; no view dropdown in the app bar. |
| 02-lead-record | Marie Curie, tapped from the list: 「‹ 线索列表」 with 3 / 5 and ↓ ↑; the header (name, object chip, four highlights in two columns, the stage path); the tab row; the details; the bottom bar [Convert Lead][编辑][⋯]. |
| 03-lead-record-mid-scroll | The same page scrolled to the middle of its body (scrollTop 106 of 212): the bar stays in view. |
| 04-lead-record-end | Scrolled to the end: the details, then the 动态 panel; the bar under them. |
| 05-lead-to-account-pushed | The lead's Account lookup tapped: Acme Corp pushed as a page, the path row 「线索 Marie Curie › 客户」. |
| 06-account-related-panels | That account scrolled to its related panels (活动列表, 联系人列表, 线索列表, 商机列表). |
| 07-account-to-opportunity-pushed | A related opportunity row tapped: pushed one more level, path row 「线索 Marie Curie › 客户 Acme Corp › 商机」, 2 / 3 over the account's opportunity rows. |
| 08-back-to-account | 「‹」 back: the account at the scroll position it was left at (315 → 315). |
| 09-back-to-lead | 「‹」 back again: the lead at its position (212 → 212). |
| 10-account-record | An account opened from its list: the tab row 「概览 · 动态 0 · 活动列表 2 · 联系人列表 1 · +2 ▾」 at 390 px; the bar [编辑][⋯]. |
| 11-account-related-tab-active | 活动列表 active (`?related=crm_activity.account`): the child object's card rows fill the body. |
| 12-lead-bar-more | The bar's ⋯: 刷新, 添加到收藏, 分享, then 删除 in its own band. |
| 13-lead-header-declared-highlights | RIG ONLY: app-crm declares no `highlightFields`, so this one shot patches the served lead metadata in the browser (`page.route`, `highlightFields: company, title, email, phone, source, lead_score`; nothing in the diff) to show the subtitle 「Radium Labs · Director of Research」 and the four highlights after it. |

app-crm has no task object, so the board's 「线索 → 任务」 is shown as lead → account (a lookup) → opportunity (a related row), and the 任务 tab as the account's 活动列表 tab.
