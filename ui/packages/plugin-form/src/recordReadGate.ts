/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The first-record-read gate, shared by the two overlay containers
 * (`DrawerForm`, objectui#10190; `ModalForm`, objectui#10659).
 *
 * Each container builds its fields and reads its record in two effects, and
 * both key on `objectSchema`. The commit that publishes the schema therefore
 * runs both, fetch first: the fetch effect enters the loading state and fires
 * `findOne`, and a fields effect that ended the loading state unconditionally
 * then won. That painted an empty, EDITABLE form while the read was in flight,
 * and the landing record replaced whatever had been typed. The save that
 * followed compared the record with itself and sent it whole, with its
 * original values.
 *
 * So the fields effect ends the loading state only when this answers `false`.
 * A load the fetch effect started is ended by the fetch effect. The condition
 * mirrors that effect's own branches: create mode, no `recordId`, or no
 * `dataSource` never read a record. `loadedRecordId` is the id of the record
 * the form currently holds, which the fetch effect sets when its read lands,
 * so this covers the FIRST load and a record swap alike.
 */
export function isRecordReadOutstanding(state: {
  mode?: string;
  recordId?: string | number;
  dataSource: unknown;
  loadedRecordId: string | number | undefined;
}): boolean {
  return (
    state.mode !== 'create' &&
    !!state.recordId &&
    !!state.dataSource &&
    state.loadedRecordId !== state.recordId
  );
}
