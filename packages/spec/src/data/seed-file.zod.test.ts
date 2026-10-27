// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25779] A seed record names a file the package ships with `seedFile(path)`;
 * `os build` bundles the bytes into the dataset's `files` map. These pin the
 * spec half: the path rule, the reference's closed shape inside a record, the
 * bundled bytes' shape, and `defineSeed`'s refusal of a reference in a field
 * that does not store a file.
 */

import { describe, expect, it } from 'vitest';
import { Field } from './field.zod';
import { ObjectSchema } from './object.zod';
import { defineSeed, SeedSchema } from './seed.zod';
import {
  SeedFileContentSchema,
  SeedFilePathSchema,
  SeedFileReferenceSchema,
  isSeedFilePath,
  isSeedFileReference,
  seedFile,
} from './seed-file.zod';

const SHA = 'a'.repeat(64);

describe('seed file paths', () => {
  it.each([
    'fixtures/nda-v1.pdf',
    'a',
    '.hidden/logo.png',
    'dir/file name.pdf',
    '.../odd-but-legal',
  ])('accepts the package-relative path %j', (path) => {
    expect(isSeedFilePath(path)).toBe(true);
    expect(SeedFilePathSchema.safeParse(path).success).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['/etc/passwd', 'absolute'],
    ['C:/files/a.pdf', 'drive letter'],
    ['fixtures\\a.pdf', 'backslash'],
    ['../secret.pdf', 'climbs out'],
    ['fixtures/../../secret.pdf', 'climbs out midway'],
    ['fixtures/./a.pdf', '`.` segment'],
    ['fixtures//a.pdf', 'empty segment'],
    ['fixtures/', 'trailing slash'],
  ])('refuses %j (%s)', (path) => {
    expect(isSeedFilePath(path)).toBe(false);
    const parsed = SeedFilePathSchema.safeParse(path);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain('relative to the package root');
  });
});

describe('seedFile()', () => {
  it('builds the reference, carrying only the options given', () => {
    expect(seedFile('fixtures/nda.pdf')).toEqual({ $file: 'fixtures/nda.pdf' });
    expect(seedFile('fixtures/nda', { name: 'NDA.pdf', contentType: 'application/pdf' })).toEqual({
      $file: 'fixtures/nda',
      name: 'NDA.pdf',
      contentType: 'application/pdf',
    });
  });

  it('is what isSeedFileReference recognises — an own `$file` key, valid or not', () => {
    expect(isSeedFileReference(seedFile('a.pdf'))).toBe(true);
    expect(isSeedFileReference({ $file: '../bad' })).toBe(true);
    expect(isSeedFileReference({ path: 'a.pdf' })).toBe(false);
    expect(isSeedFileReference('a.pdf')).toBe(false);
    expect(isSeedFileReference([seedFile('a.pdf')])).toBe(false);
    expect(isSeedFileReference(null)).toBe(false);
  });

  it('refuses an unknown key on the reference, pointing at the key it meant', () => {
    const parsed = SeedFileReferenceSchema.safeParse({ $file: 'a.pdf', mime: 'application/pdf' });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('contentType');
  });
});

describe('SeedSchema with seed files', () => {
  it('accepts references in records, single and multiple, and the bundled bytes', () => {
    const parsed = SeedSchema.safeParse({
      object: 'clm_contract_version',
      externalId: 'code',
      records: [
        { code: 'V1', file: seedFile('fixtures/v1.pdf') },
        { code: 'V2', scans: [seedFile('fixtures/p1.png'), seedFile('fixtures/p2.png')] },
      ],
      files: {
        'fixtures/v1.pdf': { contentType: 'application/pdf', size: 3, sha256: SHA, data: 'YWJj' },
      },
    });
    expect(parsed.success).toBe(true);
    // The reference reaches the loader as authored.
    expect(parsed.data?.records[0].file).toEqual({ $file: 'fixtures/v1.pdf' });
  });

  it('refuses a malformed reference where it sits in the record', () => {
    const parsed = SeedSchema.safeParse({
      object: 'clm_contract_version',
      records: [{ code: 'V1', scans: [seedFile('ok.png'), { $file: '../escape.png' }] }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['records', 0, 'scans', 1, '$file']);
  });

  it('leaves every other record value alone', () => {
    const parsed = SeedSchema.safeParse({
      object: 'account',
      records: [{ name: 'Acme', meta: { file: 'not a reference' }, tags: ['a', 'b'] }],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a bundled file keyed by a path that is not package-relative, or with a bad digest', () => {
    expect(SeedSchema.safeParse({
      object: 'a',
      records: [],
      files: { '/abs.pdf': { contentType: 'application/pdf', size: 1, sha256: SHA, data: 'YQ==' } },
    }).success).toBe(false);
    expect(SeedFileContentSchema.safeParse({
      contentType: 'application/pdf',
      size: 1,
      sha256: 'ABC',
      data: 'YQ==',
    }).success).toBe(false);
    expect(SeedFileContentSchema.safeParse({
      contentType: 'application/pdf',
      size: 1,
      sha256: SHA,
      data: 'YQ==',
      extra: true,
    }).success).toBe(false);
  });
});

describe('defineSeed with seed files', () => {
  const Version = ObjectSchema.create({
    name: 'clm_contract_version',
    fields: {
      code: Field.text({ label: 'Code' }),
      file: Field.file({ label: 'File', required: true }),
      notes: Field.textarea({ label: 'Notes' }),
    },
  });

  it('accepts seedFile() in a file field', () => {
    const seed = defineSeed(Version, {
      externalId: 'code',
      records: [{ code: 'V1', file: seedFile('fixtures/v1.pdf') }],
    });
    expect(seed.records[0].file).toEqual({ $file: 'fixtures/v1.pdf' });
  });

  it('refuses seedFile() in a field that does not store a file, naming the record and the field', () => {
    let message = '';
    try {
      defineSeed(Version, {
        externalId: 'code',
        records: [{ code: 'V1', file: seedFile('a.pdf'), notes: seedFile('fixtures/notes.txt') }],
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("defineSeed('clm_contract_version'): seedFile(...) written into a field that does not store a file.");
    expect(message).toContain('records[0]: `notes` is a `textarea` field');
  });
});
