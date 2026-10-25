/**
 * DEV-ONLY record-header api-action preview (objectui#3391).
 *
 * Mounts the REAL RecordDetailView with a stub dataSource and no backend so
 * the `record_header` `type:'api'` `{field}`-interpolation fix can be
 * browser-verified: clicking the header action must PATCH
 * `/api/v1/data/os_tianshun_ehr_production_plan/plan-42` — not the literal
 * `{id}` (`%7Bid%7D`) the bug sent.
 *
 * Served as a standalone Vite entry: open /record-header-preview.html.
 * Excluded from the production build (no route references it).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { I18nProvider } from '@object-ui/i18n';

// Register the renderers the synthesized record page resolves through
// (side-effect imports — same set the preview gallery uses).
import '@object-ui/plugin-grid';
import '@object-ui/plugin-form';
import '@object-ui/plugin-view';
import '@object-ui/plugin-list';
import '@object-ui/plugin-detail';

import { DevRecordHeaderActions } from './dev/DevRecordHeaderActions';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <DevRecordHeaderActions />
    </I18nProvider>
  </React.StrictMode>,
);
