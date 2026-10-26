/**
 * DEV-ONLY row-action overflow preview.
 *
 * Renders the `DevRowActions` harness (an ObjectGrid list whose rows declare
 * two `variant:'primary'` actions, like cloud's Environments list) with no
 * backend and no auth, so the inline-overflow fix can be browser-verified.
 *
 * Served as a standalone Vite entry: open /row-actions-preview.html.
 * Excluded from the production build (no route references it).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { I18nProvider } from '@object-ui/i18n';

// Register the grid renderer the harness renders through (side-effect import).
import '@object-ui/plugin-grid';

import { DevRowActions } from './dev/DevRowActions';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <DevRowActions />
    </I18nProvider>
  </React.StrictMode>,
);
