// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Primary datasource — in-memory SQLite for the example.
 *
 * No `pool` block: a SQLite connection strategy is owned by the driver, so the
 * `pool: { min: 1, max: 5 }` this used to declare reached nothing and the
 * datasource ran on the dialect's single connection. Declaring it is a loud
 * rejection since #5714 rather than a silent drop.
 */
export const ShowcaseDatasource = {
  name: 'showcase_primary',
  label: 'Showcase Primary Database',
  driver: 'sqlite',
  config: { filename: ':memory:' },
  active: true,
};

export const allDatasources = [ShowcaseDatasource];
