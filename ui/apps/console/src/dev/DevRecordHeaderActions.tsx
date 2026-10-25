/**
 * Dev-only harness for record-header `type:'api'` actions (objectui#3391).
 *
 * Reproduces the issue's exact declaration: an object action on
 * `locations:['record_header']` whose target is
 * `/api/v1/data/os_tianshun_ehr_production_plan/{id}`, with a required
 * field-backed param, `bodyExtra` and a confirm dialog. Before the fix the
 * header executor never stashed the record under `params._rowRecord`, so the
 * PATCH went out with the literal `{id}` (`%7Bid%7D` on the wire → 400).
 *
 * After the fix, clicking 复制 → confirming → filling the param must produce
 *   PATCH /api/v1/data/os_tianshun_ehr_production_plan/plan-42
 * with `{ copy_ovr_start: …, copy_now: true }` in the body — observable in
 * DevTools' Network panel (the request 404s/ECONNREFUSEDs without a backend;
 * only the URL + body matter here). Not part of the product nav.
 */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx, SchemaRendererProvider } from '@object-ui/react';
import { RecordDetailView } from '@object-ui/app-shell';

const OBJECT_NAME = 'os_tianshun_ehr_production_plan';
const RECORD_ID = 'plan-42';

const RECORD = {
  id: RECORD_ID,
  name: 'August production plan',
  copy_ovr_start: '2026-08-01',
};

const OBJECT_DEF = {
  name: OBJECT_NAME,
  label: 'Production Plan',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    copy_ovr_start: { type: 'date', label: 'Copy Start' },
  },
  actions: [
    {
      name: 'copy_plan_row',
      label: '复制',
      locations: ['record_header'],
      type: 'api',
      method: 'PATCH',
      target: `/api/v1/data/${OBJECT_NAME}/{id}`,
      params: [{ field: 'copy_ovr_start', required: true }],
      bodyExtra: { copy_now: true },
      confirmText: '确认复制该生产计划?',
    },
  ],
};

const dataSource: any = {
  find: async () => ({ data: [] }),
  findOne: async () => RECORD,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => ({}),
};

const METADATA: any = {
  objects: [OBJECT_DEF],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
};

export const DevRecordHeaderActions: React.FC = () => (
  <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
    <MetadataCtx.Provider value={METADATA}>
      <SchemaRendererProvider dataSource={dataSource}>
        <div className="h-screen" data-testid="record-header-harness">
          <RecordDetailView
            dataSource={dataSource}
            objects={[OBJECT_DEF] as any}
            onEdit={() => {}}
            objectNameOverride={OBJECT_NAME}
            recordIdOverride={RECORD_ID}
            embedded
          />
        </div>
      </SchemaRendererProvider>
    </MetadataCtx.Provider>
  </MemoryRouter>
);

export default DevRecordHeaderActions;
