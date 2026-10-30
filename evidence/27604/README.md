# Evidence for objectstack#27604 (never merged)

Record hover card, taken on the live console at code head `49504eb8`
(branch `claude/project-thread-xisvxo`, main merged in): backend
`objectstack dev --seed-admin --fresh` on `examples/app-showcase`, console on
its Vite dev server, Chromium 1600/1680 px wide, signed in as the seeded admin.
HotCRM is a separate repository; `showcase_account` declares
`highlightFields: ['status', 'industry', 'annual_revenue']`, so a reference to
an account shows them.

| File | Surface | What it shows |
|:--|:--|:--|
| `27604-list-relation-cell.png` | Projects list, Account column (a relation cell in a list) | Card for Contoso: Account icon and label, Lifecycle Active, Industry Technology, Annual Revenue $25,000,000.00 |
| `27604-details-lookup-chip.png` | Field Zoo record, details column, "Lookup → Account" | Card for Northwind: Lifecycle Active, Industry Retail, Annual Revenue $8,000,000.00 |
| `27604-compact-related-row.png` | Contoso's record page, related column, Contacts card, row "Carl Fox" | `showcase_contact` declares no `highlightFields`: the card shows the name and the object label only |

Live readings from the same run (`shots.cjs`, `shots2.cjs`):

- By-id reads of `showcase_account` / `showcase_task` after the Projects list rendered: 0. After one hover on an Account cell: 1 (`/data/showcase_account/7-UwoU8wVoVXgOPb`).
- On the compact row: Space on the focused name showed one card and the page did not navigate; Esc left 0 cards.
