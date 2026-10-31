# Record page v4 top bar: HotCRM screenshots

Evidence for the record page v4 top bar (Target 7 and the ⊟ half of Target 4), against the v4 boards at `a7825499aa`. This folder is committed once and removed in the next commit, so it never reaches `main`.

## How the shots were made

- **Backend.** HotCRM (`objectstack-ai/hotcrm` at `a598256`) served by this branch's own server, `node packages/cli/bin/run.js dev --fresh -p 4127`. The published 18.2.0 server has no `POST /data/:object/:id/page`, which the console's record page reads, so it cannot draw a record. On this server, three of HotCRM's lead form views fail to compile: `split_edit`, `quick_edit_drawer` and `status_update_modal` declare `type: 'split' | 'drawer' | 'modal'`, which spec 18.3.0 retired. In the rig's clone only, they were set to `simple`.
- **Console.** A production build of this branch (`VITE_BASE_PATH=/ vite build`), served by `vite preview` with `DEV_PROXY_TARGET` pointing at the backend.
- **Browser.** Playwright Chromium, locale zh-CN, through `shoot.cjs` (here). `facts.json` records what each shot's DOM held: the top bar's leading text, counter, tooltip, controls, height and width, the tab row, and the enlarged toolbar.
- **Data.** The seed's seven tasks name no contact, so one task was added for John Smith (`Send the renewal quote`), so that his 任务 tab has a row.

## Shots

| File | Face | Board |
|:--|:--|:--|
| `01-lead-1440-from-list.png` | Lead page at 1440, opened from the lead list. HotCRM's lead list opens its rows as pages, so it has no ↗. Bar: 「线索 › Mira Costa」, `1 / 21` with the tooltip 「全部线索 中第 1 条，共 21 条」, ↓ ↑. No ⊟: the lead declares its own page layout, which has no right column. | RecordPageV4Panels |
| `02-lead-1440-after-step-down.png` | The same page after ↓: `2 / 21`, Kai Watanabe, with the page replaced. | RecordPageV4Panels |
| `03-lead-1200-direct.png` | Lead at 1200, opened directly: the crumb only. | RecordPageV4TwoCol |
| `04-contact-split-720.png` | Contact in the split pane at 720: 「联系人 › John Smith」, ⤢, ✕. No counter: the contact list is grouped by account, and a grouped list reports no row sequence. No ⊟: the 720 tier has no right column. | RecordDrawerV4Peek |
| `05-contact-maximized.png` | The pane maximized: ⊟, ⤡ and ✕. ⊟ appears because the maximized width has a right column. | RecordDrawerV4Max |
| `06-contact-split-task-tab.png` | The pane with 任务 active, chosen from 「+5 ▾」: the toolbar (filter, 全部 1 / 我的, 新建, 导出) and 「1 条」. | RecordDrawerV4Enlarged |
| `07-contact-page-task-tab-deep-link.png` | The contact page, deep-linked to `?related=crm_task.related_to_contact`: the same toolbar, and 动态's tab shows `2` although the stream is not drawn. | RecordPageV4Enlarged |
| `07b-contact-page-task-tab-mine.png` | The same page with 我的 pressed. | RecordPageV4Enlarged |
| `08-product-1440.png` | Product at 1440, opened directly: crumb and ⊟. | RecordPageV4Product |
| `09-lead-phone-390.png`, `09b-contact-phone-390.png` | A 390 phone: the crumb only. | RecordMobile |
| `10-crm_account-split-pane-counter.png` | Account in the pane over the ungrouped account list: `3 / 9`, ↓ ↑, ⤢, ✕. | RecordDrawerV4Peek |
| `11-crm_account-split-pane-after-step.png` | The pane after ↓: `4 / 9`. | RecordDrawerV4Peek |
| `12-crm_account-page-from-arrow.png` | An account page opened by the list row's ↗: `1 / 9`, ↓ ↑, ⊟, ⤡ 「收为抽屉」. | RecordPageV4Panels |

No shot shows the crumb row or the small ‹ line: `facts.json` has `crumbRow: false` on every one.
