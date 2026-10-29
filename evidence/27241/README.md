# Evidence — objectstack#27241 / objectstack#27055 round 2

Never merged. Screenshots of the HotCRM contact record page (`crm_contact`), console
served by vite from branch `claude/issue-27055-v3-patch-27241` (code at 9c82d929a8), backend
`objectstack dev --fresh --seed-admin` from hotcrm 1f3f8880, headless Chromium.

| File | What it shows |
|:---|:---|
| 01-1440-three-columns-both-on.png | 1440 x 900 window, sidebar expanded (record page root 1184 px): three columns; the segmented panel control ends the header's action row |
| 02-1440-header-row-segmented.png | The header row close up: actions, then the hairline, then Timeline / Related column (both on) |
| 03-1440-related-off.png | Related switched off: details and timeline, no related column, no rail toggle |
| 04-1440-timeline-off.png | Timeline switched off: details and related, the timeline folded at the related column's foot |
| 05-1440-moved-restore-default-order.png | One card moved down through its menu: Restore default order at the related column's foot |
| 06-1440-related-foot-line.png | The foot line close up |
| 07-1024-two-columns-related-on-rail.png | 1024 x 800 window, sidebar expanded (root 768 px): two columns, related on, the Related rail toggle |
| 08-1024-two-columns-related-off-no-rail.png | The same with related off: no rail toggle; the header row wraps the segmented control onto its own line |
| 09-1440-dark-header-row-timeline-off.png | Dark theme header row, timeline off (muted) and related on (accent fill) |
