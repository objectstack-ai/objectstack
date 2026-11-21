# @object-ui/plugin-timesheet

## 18.7.0

### Patch Changes

- Updated dependencies [a0b4ecf]
- Updated dependencies [d6d9645]
- Updated dependencies [1c05546]
- Updated dependencies [4ffe9d3]
- Updated dependencies [c3fb37a]
- Updated dependencies [c9b3f7a]
- Updated dependencies [8896822]
- Updated dependencies [dc53d4a]
- Updated dependencies [0739dee]
- Updated dependencies [ad15579]
- Updated dependencies [89364b4]
- Updated dependencies [eed422e]
- Updated dependencies [2df9691]
- Updated dependencies [bfd6b6b]
- Updated dependencies [55020c3]
- Updated dependencies [50f85e9]
- Updated dependencies [6f2bd4f]
- Updated dependencies [99a0e4f]
- Updated dependencies [a9b36ef]
- Updated dependencies [9f352e8]
- Updated dependencies [1b2cd80]
- Updated dependencies [6ffa816]
- Updated dependencies [7702f09]
- Updated dependencies [05e0eb8]
- Updated dependencies [c890070]
- Updated dependencies [5bd7257]
- Updated dependencies [3819afe]
- Updated dependencies [e6fa510]
- Updated dependencies [9212119]
- Updated dependencies [9b3227f]
- Updated dependencies [fe75349]
- Updated dependencies [dab4712]
- Updated dependencies [141a826]
- Updated dependencies [8145424]
- Updated dependencies [83a79e6]
- Updated dependencies [dda665f]
- Updated dependencies [98b3f87]
- Updated dependencies [ccded86]
- Updated dependencies [ec24363]
- Updated dependencies [e01b8be]
- Updated dependencies [238661f]
- Updated dependencies [d96c878]
- Updated dependencies [72d19c4]
- Updated dependencies [b0c624a]
- Updated dependencies [1e018d6]
- Updated dependencies [6d86b43]
- Updated dependencies [bae933b]
- Updated dependencies [a3a74f2]
- Updated dependencies [74d3d83]
- Updated dependencies [227a16a]
- Updated dependencies [598a34d]
- Updated dependencies [0585797]
- Updated dependencies [811858c]
- Updated dependencies [fac1e7d]
- Updated dependencies [4609c48]
- Updated dependencies [8500ee7]
- Updated dependencies [a6607c7]
- Updated dependencies [c00be39]
- Updated dependencies [af566c2]
- Updated dependencies [f909734]
- Updated dependencies [f51578e]
- Updated dependencies [6b360ab]
- Updated dependencies [c7174c3]
- Updated dependencies [1d7015a]
- Updated dependencies [5a68b57]
- Updated dependencies [7de1bad]
- Updated dependencies [bc9ace2]
- Updated dependencies [d6be99d]
- Updated dependencies [dea68e9]
- Updated dependencies [b113178]
- Updated dependencies [138faaa]
- Updated dependencies [6b51822]
- Updated dependencies [52fb30c]
- Updated dependencies [9ed18a5]
- Updated dependencies [32409a9]
- Updated dependencies [f548bdc]
- Updated dependencies [9a98a46]
- Updated dependencies [96b66ca]
- Updated dependencies [8c8ff0f]
- Updated dependencies [eb53d63]
- Updated dependencies [a23164e]
- Updated dependencies [b89f1b5]
- Updated dependencies [7d3b8d6]
- Updated dependencies [15f8357]
- Updated dependencies [378c955]
- Updated dependencies [56fa31b]
- Updated dependencies [d280de9]
  - @object-ui/i18n@18.7.0
  - @object-ui/fields@18.7.0
  - @object-ui/types@18.7.0
  - @object-ui/core@18.7.0
  - @object-ui/components@18.7.0
  - @object-ui/react@18.7.0
  - @object-ui/permissions@18.7.0

## 18.6.0

### Minor Changes

- 4240719: feat(ui): timesheet list view, an editable row × weekday entry grid
  
  Clause-②: yes (widening — new list view type `timesheet`, its `timesheet` block and the `VisualizationType` member; new locale keys)
  Metadata-protocol: added
  
  A list view can now be `type: 'timesheet'`. It pivots detail records into rows × the seven days of one week, and every cell is editable:
  
  ```ts
  type: 'timesheet',
  timesheet: {
    rowFields: ['project', 'task'], // 1–3 fields; one row per distinct combination
    dateField: 'work_date',         // date or datetime
    valueField: 'hours',            // number, currency or percent
  }
  ```
  
  - Typing into an empty cell creates a record carrying the row's field values, the day and the number. Changing a cell updates that record, and clearing it deletes the record. Each cell is one call on the record API, so hooks, validation rules and permissions judge it; a refusal stays on that cell with the server's message.
  - A cell holding several records shows their sum and is read-only.
  - The grid offers each write only to a caller who may make it (the affordance-to-grant map's `gridAddRow`, `listInlineEdit` with the value field's write permission, and `rowDelete`). A cell no granted write can change is read-only, and **Add row** needs the create grant. An interface page's list block relays the view's `timesheet` block.
  - The week starts on the viewer's locale first day, with previous / this / next navigation. Row, day and week totals are always shown.
  - **Add row** asks for the row field values first; typing a day then creates the record. The view's `filter` applies to the week's query.
  - A `timesheet` view with an incomplete block shows "Timesheet configuration required", and `os validate` warns with `view/layout-without-binding`. `view/list-view-field-refs` checks the three field names.
  
  The renderer is the new lazy package `@object-ui/plugin-timesheet` (`object-timesheet`), with its own lazy locale namespace `timesheet.*`. The view switcher, the create-view dialog and the Studio list-view type section offer the new type.

### Patch Changes

- Updated dependencies [e53e02e]
- Updated dependencies [0e2ead3]
- Updated dependencies [ffa6db1]
- Updated dependencies [c493adb]
- Updated dependencies [84e6bbb]
- Updated dependencies [3372da0]
- Updated dependencies [b019048]
- Updated dependencies [b005638]
- Updated dependencies [a78781a]
- Updated dependencies [1078c73]
- Updated dependencies [39fa82b]
- Updated dependencies [b4eea88]
- Updated dependencies [8436f67]
- Updated dependencies [4c0cf65]
- Updated dependencies [31eb2ae]
- Updated dependencies [2c296cf]
- Updated dependencies [5a75579]
- Updated dependencies [6a7403b]
- Updated dependencies [04e7b90]
- Updated dependencies [3b1307e]
- Updated dependencies [842637a]
- Updated dependencies [227ae36]
- Updated dependencies [dc54c60]
- Updated dependencies [a8e794f]
- Updated dependencies [d57d6ee]
- Updated dependencies [bdd5176]
- Updated dependencies [2b267b7]
- Updated dependencies [4240719]
- Updated dependencies [518baca]
- Updated dependencies [066177b]
- Updated dependencies [6c7d730]
- Updated dependencies [b86331d]
- Updated dependencies [e2d3514]
- Updated dependencies [e95210d]
- Updated dependencies [26cab15]
- Updated dependencies [e9f65a3]
- Updated dependencies [13c62a6]
- Updated dependencies [77b42a1]
- Updated dependencies [4db3750]
- Updated dependencies [2e29287]
- Updated dependencies [8bc0808]
- Updated dependencies [e61af97]
- Updated dependencies [b1da9f5]
- Updated dependencies [a931063]
- Updated dependencies [14619f5]
- Updated dependencies [e47c1cb]
- Updated dependencies [758bbe7]
- Updated dependencies [81ea504]
- Updated dependencies [c81f498]
- Updated dependencies [4bdbdac]
- Updated dependencies [3bbda33]
- Updated dependencies [d656d62]
- Updated dependencies [6c1f9b3]
- Updated dependencies [e05445e]
- Updated dependencies [90f2b1c]
- Updated dependencies [0584eb5]
- Updated dependencies [94c9491]
- Updated dependencies [fff0ad0]
- Updated dependencies [65ec3c5]
- Updated dependencies [4aeeca5]
- Updated dependencies [aa0fde3]
- Updated dependencies [421f180]
- Updated dependencies [2fcc9cf]
- Updated dependencies [7b7272f]
- Updated dependencies [cb7d514]
- Updated dependencies [97cd541]
- Updated dependencies [2487242]
- Updated dependencies [4443014]
- Updated dependencies [343c49c]
- Updated dependencies [6d2db1d]
- Updated dependencies [db1a05c]
- Updated dependencies [d4b2a75]
- Updated dependencies [3c535ee]
- Updated dependencies [59defa0]
  - @object-ui/i18n@18.6.0
  - @object-ui/core@18.6.0
  - @object-ui/types@18.6.0
  - @object-ui/components@18.6.0
  - @object-ui/fields@18.6.0
  - @object-ui/permissions@18.6.0
  - @object-ui/react@18.6.0
