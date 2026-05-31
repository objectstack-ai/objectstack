// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/** Primary datasource — in-memory SQLite for the example. */
export const ShowcaseDatasource = {
  name: 'showcase_primary',
  label: 'Showcase Primary Database',
  driver: 'sqlite',
  config: { filename: ':memory:' },
  pool: { min: 1, max: 5 },
  active: true,
};

export const allDatasources = [ShowcaseDatasource];
