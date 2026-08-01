// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDatasource } from '@objectstack/spec/data';

/**
 * Primary CRM datasource — in-memory SQLite for the example.
 * In production, swap `driver` to 'postgres' and supply real `config`.
 */
export const CrmDatasource = defineDatasource({
  name: 'crm_primary',
  label: 'CRM Primary Database',
  driver: 'sqlite',
  config: {
    filename: ':memory:',
  },
  pool: {
    min: 1,
    max: 5,
  },
  active: true,
});

/**
 * Read-replica for analytics queries — demonstrates datasource routing.
 *
 * `readOnly` is a datasource CAPABILITY, not sqlite config. It sat inside
 * `config` here until #4410 gave that slot a gate — a key no driver read, so
 * the "read replica" was writable while every signal said it was not.
 */
export const CrmAnalyticsDatasource = defineDatasource({
  name: 'crm_analytics',
  label: 'CRM Analytics Read Replica',
  driver: 'sqlite',
  config: {
    filename: ':memory:',
  },
  capabilities: {
    readOnly: true,
  },
  active: true,
});
