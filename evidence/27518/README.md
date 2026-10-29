# objectstack#27518 acceptance screenshots

Removed again by the next commit on this branch: the pull request body links
these files at this commit, and none of them is meant to merge.

Rendered at 1440x900 by headless Chromium (Playwright) against a fresh
`examples/app-showcase` boot (`objectstack dev --seed-admin --fresh`) and the
console dev server from this branch, signed in as the seeded admin.

1. `01` New report dialog in a new package (`com.example.fieldsvc`) whose only
   object is the draft Work Order: the line says no dataset reads the
   package's objects, and the New dataset button sits under the picker.
2. `02` The picker before: only `sys_` and `showcase_` datasets.
3. `03` New dataset: object preselected, Status to group by, Estimated Hours
   to total.
4. `04` Back in the report dialog: the new dataset is selected and its
   measures are offered.
5. `05` The widget inspector's dataset picker lists the package's dataset
   first.
6. `06`, `07` New dataset from the widget inspector, and the widget bound to
   it.
7. `08`, `09` After Publish and seven sample records: the report's rows and
   the bar chart.
