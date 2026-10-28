# Record page v3 screenshots (evidence only, never merged)

Captured from the app-crm example (`pnpm dev:crm`, fresh database) with the console dev server built from the PR head.
The app sidebar is collapsed in the wide shots: the three-column tier needs a 1280 px page container.
The reader's timeline switch is turned on where the object's default folds it (accounts and contacts are not "worked" objects).

| File | State |
|---|---|
| contact-1440-three-columns.png | Contact at 1440 px: details · timeline stream · related cards |
| contact-1100-two-columns.png | Contact at 1100 px: details · timeline, related in the rail |
| contact-drawer.png | Contact opened from the list in the record drawer (tabbed tier: Details · Related · Timeline) |
| account-1440.png | Account at 1440 px, four compact related cards |
| opportunity-1440.png | Opportunity at 1440 px: Line Items body table after the first field group (no product object in this repo) |
| account-related-dragged.png | Account after dragging Opportunities to the top of the related column |
| account-related-enlarged.png | Account with `?related=crm_opportunity.account` enlarged in place |
