# @object-ui/plugin-timesheet

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
