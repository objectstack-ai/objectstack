// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'sqlite-filename-names-no-database-refused',
  surface:
    'data.Datasource.config.filename on a sqlite or sqlite-wasm datasource (SqliteConfigSchema.filename, '
    + 'SqliteWasmConfigSchema.filename), declared in a stack (defineStack, os validate, os build) or saved through '
    + 'PUT /api/v1/meta/datasource/NAME: an empty string, or a name that starts with a colon without being exactly '
    + ':memory:',
  replacement:
    'filename: \':memory:\' for an ephemeral in-memory database, or the path of a database file with nothing in front '
    + 'of it (a relative path resolves against the server\'s working directory)',
  reason:
    'Every layer reads a filename that starts with a colon as fileless, so a value such as :memory:/srv/data/parts.db '
    + '(the New datasource dialog\'s prefilled :memory: with a path typed after it) opened no file: native sqlite '
    + 'opened it as a relative path whose directory does not exist, so every statement failed, and sqlite-wasm opened '
    + 'a throwaway in-memory database whose writes were gone at the next connect. An empty filename named no file '
    + 'either. The datasource admin doors (Test connection, create, update) already refused both; the stack parse and '
    + 'the metadata save door now refuse them too, at config.filename, naming the value. There is no mechanical '
    + 'rewrite: whether the author meant an ephemeral database or the path typed after the prefix is a judgement '
    + 'about the datasource, and choosing the wrong one either loses data or opens a database nobody declared.',
  acceptanceCriteria:
    'os validate on the stack answers no config.filename finding; PUT /api/v1/meta/datasource/NAME with the '
    + 'corrected config answers 200; POST /api/v1/datasources/test for the datasource answers ok: true for :memory: '
    + 'or an existing database file.',
};
