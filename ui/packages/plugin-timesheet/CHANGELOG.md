# @object-ui/plugin-timesheet

## 19.0.0-next.3

### Patch Changes

- Updated dependencies [23cefa0]
- Updated dependencies [6123f2b]
- Updated dependencies [58b513a]
- Updated dependencies [fe0473d]
- Updated dependencies [079edad]
- Updated dependencies [9609c13]
- Updated dependencies [32dc5d8]
- Updated dependencies [d528ebc]
- Updated dependencies [ccdfe62]
- Updated dependencies [7b90456]
- Updated dependencies [03f39cc]
- Updated dependencies [9603893]
  - @object-ui/i18n@19.0.0-next.3
  - @object-ui/types@19.0.0-next.3
  - @object-ui/core@19.0.0-next.3
  - @object-ui/components@19.0.0-next.3
  - @object-ui/fields@19.0.0-next.3
  - @object-ui/react@19.0.0-next.3
  - @object-ui/permissions@19.0.0-next.3

## 19.0.0-next.2

### Patch Changes

- Updated dependencies [5b32625]
- Updated dependencies [5f48cb0]
- Updated dependencies [34f7078]
- Updated dependencies [74cd5b6]
- Updated dependencies [0b539b6]
- Updated dependencies [ab04434]
- Updated dependencies [27ee984]
- Updated dependencies [8361dfc]
- Updated dependencies [4af32b9]
- Updated dependencies [3df181b]
- Updated dependencies [bb13a30]
- Updated dependencies [7e4df28]
  - @object-ui/i18n@19.0.0-next.2
  - @object-ui/react@19.0.0-next.2
  - @object-ui/components@19.0.0-next.2
  - @object-ui/fields@19.0.0-next.2
  - @object-ui/core@19.0.0-next.2
  - @object-ui/permissions@19.0.0-next.2
  - @object-ui/types@19.0.0-next.2

## 19.0.0-next.1

### Minor Changes

- c3da753: feat(ui): the field hand lock (`uiReadonly` / `uiReadonlyWhen`) holds on the Gantt, the timesheet cell, the calendar quick-create and the palette prefill
  
  Clause-②: no
  Metadata-protocol: semantic
  
  A field a person may not edit by hand (`uiReadonly: true`, or `uiReadonlyWhen` true over the record) now stays locked on the console surfaces that still wrote it:
  
  - **Gantt.** A bar's drag and edge resize, the progress handle, the title and dates edited in place, the auto-schedule and the conflict reschedule, undo and redo, and a drawn dependency link all read the one verdict of `@object-ui/core` (`fieldReadOnlyByHand`) over the stored record, with the shell's predicate scope. A write that would change a locked field is refused: nothing is sent, the bar goes back and a toast gives the read-only reason. A locked field the write only echoes back (an in-place title edit carries the dates and progress too) is dropped from the write, so the rest still saves. A field locked on every record also closes the gesture before it starts: a move closes when either date is locked, a resize only when both are (the locked edge is refused on the write), and the progress handle and the link tool close with their own field.
  - **Timesheet.** A cell whose record's value field is locked by hand is drawn read-only, so it cannot be edited or cleared. A row, date or value field locked on every record closes the create, so the empty cells and **Add row** are not offered.
  - **Calendar quick-create.** A click on an empty day or a range drag no longer writes a field locked by hand on every record. Where the title or a date field the dialog writes is locked, the gesture opens the full create form instead (a locked date field is not prefilled there). A required locked field is left out of the dialog's write so the server applies its `defaultValue`; one with no default sends the gesture to the full form too.
  - **Command palette.** The create-as prefill skips a field that is `uiReadonly`, as it already skipped a `readonly` one; a create is judged by the static half only, as the create dialog judges it.
  - **List view.** A kanban board whose block names no `groupByField` takes the object's lifecycle field as its lanes; the operands of that field's lock predicates are now read with the rows too, so a card drag is judged over the whole record.
  
  A kanban drag on the swimlane layout writes only the lane (column) field, never the swimlane field; that is now pinned.
  
  Not yet covered: the in-app assistant acting for a person. Its writes run in the AI service, which does not read the hand lock, and the field descriptions now say so. Every other console surface a person edits through honours the hand lock, and the `uiReadonly` / `uiReadonlyWhen` descriptions and the MCP `describe_object` guidance say that. Writes through the API, import, actions and flows are unchanged: only the server lock (`readonly` / `readonlyWhen`) binds them.

### Patch Changes

- Updated dependencies [81c68b3]
- Updated dependencies [f722411]
- Updated dependencies [ea1b70a]
- Updated dependencies [adb65d1]
- Updated dependencies [d58bf7a]
- Updated dependencies [c3da753]
- Updated dependencies [4e10d4b]
- Updated dependencies [4111380]
- Updated dependencies [712df42]
- Updated dependencies [c2bfa3e]
- Updated dependencies [68aa1be]
- Updated dependencies [d92684a]
- Updated dependencies [3eb778d]
- Updated dependencies [6e8f663]
- Updated dependencies [6e8f663]
- Updated dependencies [2980483]
- Updated dependencies [1028438]
- Updated dependencies [8fbae19]
- Updated dependencies [e50ab8f]
- Updated dependencies [21ad7c5]
- Updated dependencies [0a3ea67]
- Updated dependencies [1f97fce]
- Updated dependencies [d1139f9]
  - @object-ui/i18n@19.0.0-next.1
  - @object-ui/fields@19.0.0-next.1
  - @object-ui/core@19.0.0-next.1
  - @object-ui/react@19.0.0-next.1
  - @object-ui/components@19.0.0-next.1
  - @object-ui/types@19.0.0-next.1
  - @object-ui/permissions@19.0.0-next.1

## 19.0.0-next.0

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
- Updated dependencies [fd471d3]
- Updated dependencies [1b2cd80]
- Updated dependencies [6ffa816]
- Updated dependencies [7702f09]
- Updated dependencies [05e0eb8]
- Updated dependencies [c890070]
- Updated dependencies [5bd7257]
- Updated dependencies [58d00db]
- Updated dependencies [3819afe]
- Updated dependencies [61722e9]
- Updated dependencies [3d6dea2]
- Updated dependencies [e6fa510]
- Updated dependencies [285ad8d]
- Updated dependencies [bfd1049]
- Updated dependencies [6a35635]
- Updated dependencies [9212119]
- Updated dependencies [cda16d4]
- Updated dependencies [9b3227f]
- Updated dependencies [fe75349]
- Updated dependencies [dab4712]
- Updated dependencies [141a826]
- Updated dependencies [8145424]
- Updated dependencies [83a79e6]
- Updated dependencies [dda665f]
- Updated dependencies [98b3f87]
- Updated dependencies [f71d488]
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
- Updated dependencies [f98f18c]
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
- Updated dependencies [1c87956]
- Updated dependencies [5345905]
- Updated dependencies [af566c2]
- Updated dependencies [f909734]
- Updated dependencies [c9b0a23]
- Updated dependencies [f51578e]
- Updated dependencies [6b360ab]
- Updated dependencies [c7174c3]
- Updated dependencies [78f7160]
- Updated dependencies [1d7015a]
- Updated dependencies [40e22f1]
- Updated dependencies [5a68b57]
- Updated dependencies [5dbcc02]
- Updated dependencies [7de1bad]
- Updated dependencies [bc9ace2]
- Updated dependencies [d6be99d]
- Updated dependencies [0a1b69c]
- Updated dependencies [dea68e9]
- Updated dependencies [b113178]
- Updated dependencies [138faaa]
- Updated dependencies [411fe24]
- Updated dependencies [6b51822]
- Updated dependencies [48c732c]
- Updated dependencies [52fb30c]
- Updated dependencies [8807dcb]
- Updated dependencies [8df7bf2]
- Updated dependencies [d33bf5a]
- Updated dependencies [9ed18a5]
- Updated dependencies [c261a7c]
- Updated dependencies [76cb366]
- Updated dependencies [32409a9]
- Updated dependencies [f548bdc]
- Updated dependencies [9f6f306]
- Updated dependencies [c757e07]
- Updated dependencies [a5a5312]
- Updated dependencies [c1b35c3]
- Updated dependencies [9a98a46]
- Updated dependencies [96b66ca]
- Updated dependencies [8c8ff0f]
- Updated dependencies [27e414b]
- Updated dependencies [eb53d63]
- Updated dependencies [dda5e74]
- Updated dependencies [f2a990b]
- Updated dependencies [035a12c]
- Updated dependencies [33d0169]
- Updated dependencies [a23164e]
- Updated dependencies [f3d0a9f]
- Updated dependencies [6aacad9]
- Updated dependencies [8aed508]
- Updated dependencies [a60740a]
- Updated dependencies [43580a3]
- Updated dependencies [cc05e60]
- Updated dependencies [dc10b3b]
- Updated dependencies [dca608a]
- Updated dependencies [baf2678]
- Updated dependencies [13d1e95]
- Updated dependencies [15b7f51]
- Updated dependencies [c297dff]
- Updated dependencies [1cd4762]
- Updated dependencies [6db1dc2]
- Updated dependencies [9ae874a]
- Updated dependencies [3ae62ac]
- Updated dependencies [6c7c6db]
- Updated dependencies [eebb893]
- Updated dependencies [493ad09]
- Updated dependencies [3543b51]
- Updated dependencies [4ab2c82]
- Updated dependencies [04f9861]
- Updated dependencies [c30ce97]
- Updated dependencies [e605773]
- Updated dependencies [0628e08]
- Updated dependencies [713545f]
- Updated dependencies [cbd582f]
- Updated dependencies [031325d]
- Updated dependencies [1705ec9]
- Updated dependencies [a2dc858]
- Updated dependencies [a6756a2]
- Updated dependencies [b3bcfef]
- Updated dependencies [aad35e6]
- Updated dependencies [0b2118f]
- Updated dependencies [71e02ff]
- Updated dependencies [d12ac84]
- Updated dependencies [5e8e243]
- Updated dependencies [4099ef2]
- Updated dependencies [6a73185]
- Updated dependencies [bb89b2d]
- Updated dependencies [8da2b7e]
- Updated dependencies [740720c]
- Updated dependencies [6e643cc]
- Updated dependencies [f3a8a13]
- Updated dependencies [96b7975]
- Updated dependencies [e8b494a]
- Updated dependencies [bbc7e03]
- Updated dependencies [27895d7]
- Updated dependencies [543585d]
- Updated dependencies [7e89bc6]
- Updated dependencies [42e4096]
- Updated dependencies [a10422d]
- Updated dependencies [1a2a8a9]
- Updated dependencies [24366ff]
- Updated dependencies [f2ef7d8]
- Updated dependencies [17dbea4]
- Updated dependencies [ff60149]
- Updated dependencies [ee651ce]
- Updated dependencies [dad9b55]
- Updated dependencies [d076975]
- Updated dependencies [70d07fd]
- Updated dependencies [73f2cf4]
- Updated dependencies [8a741ab]
- Updated dependencies [60e79ed]
- Updated dependencies [3cf6a44]
- Updated dependencies [5fecc22]
- Updated dependencies [6cfa758]
- Updated dependencies [4f19091]
- Updated dependencies [e377918]
- Updated dependencies [3b58921]
- Updated dependencies [9c283a1]
- Updated dependencies [c45dd80]
- Updated dependencies [52971ff]
- Updated dependencies [06c3e5a]
- Updated dependencies [2da2979]
- Updated dependencies [ad50d61]
- Updated dependencies [50bfbb8]
- Updated dependencies [f26469a]
- Updated dependencies [7501d0c]
- Updated dependencies [4ef1ea9]
- Updated dependencies [41dd132]
- Updated dependencies [d7411fa]
- Updated dependencies [c6075a7]
- Updated dependencies [cd51dbb]
- Updated dependencies [3f568c1]
- Updated dependencies [573a376]
- Updated dependencies [5c2d5cf]
- Updated dependencies [43916f3]
- Updated dependencies [f590f3e]
- Updated dependencies [9fa05c6]
- Updated dependencies [ed0edb1]
- Updated dependencies [a10987a]
- Updated dependencies [8f141a2]
- Updated dependencies [d24e4ab]
- Updated dependencies [fed637c]
- Updated dependencies [f77d078]
- Updated dependencies [3110de5]
- Updated dependencies [1948c5f]
- Updated dependencies [0e83fe0]
- Updated dependencies [7a7ab47]
- Updated dependencies [70f454a]
- Updated dependencies [9f84e5f]
- Updated dependencies [368deee]
- Updated dependencies [6156fdd]
- Updated dependencies [0d6589d]
- Updated dependencies [c54aa57]
- Updated dependencies [53257a5]
- Updated dependencies [115d387]
- Updated dependencies [e0050ba]
- Updated dependencies [14f4d8f]
- Updated dependencies [183ed23]
- Updated dependencies [08bf7d2]
- Updated dependencies [4d4ec16]
- Updated dependencies [d763ee7]
- Updated dependencies [8018e00]
- Updated dependencies [844218f]
- Updated dependencies [8cce05b]
- Updated dependencies [0d727b7]
- Updated dependencies [ff0d1f1]
- Updated dependencies [021524c]
- Updated dependencies [4f7d6f7]
- Updated dependencies [b848b47]
- Updated dependencies [129e637]
- Updated dependencies [47ed85d]
- Updated dependencies [0819cab]
- Updated dependencies [97e0f93]
- Updated dependencies [c8d4b90]
- Updated dependencies [69c3dc4]
- Updated dependencies [76eea0f]
- Updated dependencies [62692b7]
- Updated dependencies [8695703]
- Updated dependencies [49c6bf3]
- Updated dependencies [4ed453d]
- Updated dependencies [81c1ae9]
- Updated dependencies [66452df]
- Updated dependencies [00dd362]
- Updated dependencies [bac4864]
- Updated dependencies [8c29b81]
- Updated dependencies [a68b475]
- Updated dependencies [c75453e]
- Updated dependencies [1e96009]
- Updated dependencies [4fb03eb]
- Updated dependencies [ff04943]
- Updated dependencies [ab91323]
- Updated dependencies [fbb62e1]
- Updated dependencies [57445a6]
- Updated dependencies [0212714]
- Updated dependencies [15d2766]
- Updated dependencies [1f3e9f6]
- Updated dependencies [305fe60]
- Updated dependencies [e91149e]
- Updated dependencies [06c1f54]
- Updated dependencies [706c8c6]
- Updated dependencies [c0dd417]
- Updated dependencies [517e415]
- Updated dependencies [6ddb97b]
- Updated dependencies [2af9729]
- Updated dependencies [f339060]
- Updated dependencies [40914bd]
- Updated dependencies [2a6f26a]
- Updated dependencies [b7dee0e]
- Updated dependencies [68250f6]
- Updated dependencies [6161010]
- Updated dependencies [875ae40]
- Updated dependencies [8316d3d]
- Updated dependencies [6cc6177]
- Updated dependencies [5cf9941]
- Updated dependencies [5f34d65]
- Updated dependencies [8fe4eaf]
- Updated dependencies [84a27e7]
- Updated dependencies [7939732]
- Updated dependencies [0ad44a3]
- Updated dependencies [dbc1765]
- Updated dependencies [2d18ba8]
- Updated dependencies [6361b99]
- Updated dependencies [c2f8bff]
- Updated dependencies [68b2430]
- Updated dependencies [bbb4ad3]
- Updated dependencies [276174a]
- Updated dependencies [c385d3b]
- Updated dependencies [061e342]
- Updated dependencies [b89f1b5]
- Updated dependencies [da7c559]
- Updated dependencies [e8740c5]
- Updated dependencies [3aa008d]
- Updated dependencies [7d3b8d6]
- Updated dependencies [15f8357]
- Updated dependencies [378c955]
- Updated dependencies [56fa31b]
- Updated dependencies [39e9a82]
- Updated dependencies [9c5fb3e]
- Updated dependencies [abb5449]
- Updated dependencies [d280de9]
  - @object-ui/i18n@19.0.0-next.0
  - @object-ui/fields@19.0.0-next.0
  - @object-ui/types@19.0.0-next.0
  - @object-ui/core@19.0.0-next.0
  - @object-ui/components@19.0.0-next.0
  - @object-ui/react@19.0.0-next.0
  - @object-ui/permissions@19.0.0-next.0

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
