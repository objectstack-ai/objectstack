import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from '@object-ui/i18n';
import './index.css';
import { App } from './App';
import { loadLanguage } from './loadLanguage';

import '@object-ui/plugin-grid';
import '@object-ui/plugin-kanban';
import '@object-ui/plugin-calendar';
import '@object-ui/plugin-charts';
import '@object-ui/plugin-list';
import '@object-ui/plugin-detail';
import '@object-ui/plugin-view';
import '@object-ui/plugin-form';
import '@object-ui/plugin-dashboard';
import '@object-ui/plugin-report';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider loadLanguage={loadLanguage}>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
