// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addObjectField,
  reorderObjectFields,
  patchObjectFieldFile,
} from '../src/utils/studio-field-patch.js';

let dir: string;
let file: string;

function write(src: string) {
  writeFileSync(file, src, 'utf8');
}
function read() {
  return readFileSync(file, 'utf8');
}

const FOUR_SPACE_SAMPLE = `import { defineObject, Field } from '@objectstack/spec';

export const account = defineObject({
    name: 'account',
    label: 'Account',
    fields: {
        // Basic Information
        name: Field.text({ label: 'Name', required: true }),
        industry: Field.text({ label: 'Industry' }),

        // Contact
        email: Field.email({ label: 'Email' }),
    },
});
`;

const TWO_SPACE_SAMPLE = `import { defineObject, Field } from '@objectstack/spec';

export const task = defineObject({
  name: 'task',
  fields: {
    title: Field.text({ label: 'Title' }),
    done: Field.boolean({ label: 'Done' }),
  },
});
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-field-patch-'));
  file = join(dir, 'account.object.ts');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('addObjectField', () => {
  it('appends with matching 4-space indentation, preserves comments & blank lines', async () => {
    write(FOUR_SPACE_SAMPLE);
    const r = await addObjectField(file, 'phone', "Field.text({ label: 'Phone' })");
    expect(r).toEqual({ ok: true });
    const out = read();
    // Existing lines untouched (no reindent).
    expect(out).toContain('        // Basic Information');
    expect(out).toContain("        name: Field.text({ label: 'Name', required: true }),");
    expect(out).toContain('        // Contact');
    expect(out).toContain("        email: Field.email({ label: 'Email' }),");
    // New field present with same indent.
    expect(out).toContain("        phone: Field.text({ label: 'Phone' }),");
    // Closing brace stayed at one indent level less than props.
    expect(out).toMatch(/\n    \},\n\}\);\n$/);
  });

  it('honors 2-space indent style', async () => {
    write(TWO_SPACE_SAMPLE);
    const r = await addObjectField(file, 'note', "Field.textarea({ label: 'Note' })");
    expect(r).toEqual({ ok: true });
    const out = read();
    expect(out).toContain("    note: Field.textarea({ label: 'Note' }),");
    // 2-space close brace
    expect(out).toMatch(/\n  \},\n\}\);\n$/);
  });

  it('rejects non-snake_case names', async () => {
    write(TWO_SPACE_SAMPLE);
    const r = await addObjectField(file, 'TitleCase', "Field.text({})");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/snake_case/);
  });

  it('refuses to overwrite an existing field', async () => {
    write(TWO_SPACE_SAMPLE);
    const r = await addObjectField(file, 'title', "Field.text({})");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already exists/);
    // File untouched.
    expect(read()).toBe(TWO_SPACE_SAMPLE);
  });

  it('errors when no schema call present', async () => {
    write(`export const x = 1;\n`);
    const r = await addObjectField(file, 'foo', "Field.text({})");
    expect(r.ok).toBe(false);
  });

  it('produces a small diff (one line added)', async () => {
    write(TWO_SPACE_SAMPLE);
    await addObjectField(file, 'note', "Field.text({})");
    const out = read();
    const before = TWO_SPACE_SAMPLE.split('\n');
    const after = out.split('\n');
    // Exactly one new line introduced.
    expect(after.length - before.length).toBe(1);
    // All original lines still present in order.
    let i = 0;
    for (const line of before) {
      const idx = after.indexOf(line, i);
      expect(idx).toBeGreaterThanOrEqual(0);
      i = idx + 1;
    }
  });
});

describe('reorderObjectFields', () => {
  it('reorders fields without reformatting unchanged neighbours', async () => {
    write(TWO_SPACE_SAMPLE);
    const r = await reorderObjectFields(file, ['done', 'title']);
    expect(r).toEqual({ ok: true });
    const out = read();
    expect(out.indexOf('done:')).toBeLessThan(out.indexOf('title:'));
    // Both lines preserved verbatim.
    expect(out).toContain("    title: Field.text({ label: 'Title' }),");
    expect(out).toContain("    done: Field.boolean({ label: 'Done' }),");
  });

  it('keeps a comment glued to the field it precedes', async () => {
    write(FOUR_SPACE_SAMPLE);
    // Move `email` (currently last, after the "// Contact" comment) to the
    // front; the comment should travel with it.
    const r = await reorderObjectFields(file, ['email', 'name', 'industry']);
    expect(r).toEqual({ ok: true });
    const out = read();
    // "// Contact" still immediately precedes `email:`.
    const lines = out.split('\n');
    const contactIdx = lines.findIndex((l) => l.includes('// Contact'));
    expect(contactIdx).toBeGreaterThanOrEqual(0);
    // The next non-empty line should be the email field.
    let j = contactIdx + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    expect(lines[j]).toContain('email:');
  });

  it('appends fields missing from the order array (never drops anything)', async () => {
    write(TWO_SPACE_SAMPLE);
    const r = await reorderObjectFields(file, ['done']); // omit `title`
    expect(r).toEqual({ ok: true });
    const out = read();
    expect(out).toContain('title:');
    expect(out).toContain('done:');
    // `done` now appears before `title`.
    expect(out.indexOf('done:')).toBeLessThan(out.indexOf('title:'));
  });

  it('errors when order is not an array', async () => {
    write(TWO_SPACE_SAMPLE);
    // @ts-expect-error testing runtime guard
    const r = await reorderObjectFields(file, 'nope');
    expect(r.ok).toBe(false);
  });

  it('is a no-op (idempotent) when order matches current', async () => {
    write(TWO_SPACE_SAMPLE);
    const r = await reorderObjectFields(file, ['title', 'done']);
    expect(r).toEqual({ ok: true });
    // Source byte-for-byte unchanged.
    expect(read()).toBe(TWO_SPACE_SAMPLE);
  });
});

describe('patchObjectFieldFile', () => {
  it('updates label on a Field.X(...) call (preserves single-quote style)', async () => {
    write(TWO_SPACE_SAMPLE);
    const r = await patchObjectFieldFile(file, 'title', { label: 'Renamed' });
    expect(r).toEqual({ ok: true });
    const out = read();
    // Source uses single quotes — patch should match.
    expect(out).toContain("label: 'Renamed'");
    expect(out).not.toContain('label: "Renamed"');
  });

  it('uses double quotes when the surrounding field already uses them', async () => {
    write(`import { defineObject, Field } from '@objectstack/spec';
export const t = defineObject({
  name: 't',
  fields: {
    title: Field.text({ label: "Original" }),
  },
});
`);
    const r = await patchObjectFieldFile(file, 'title', { label: 'Renamed' });
    expect(r).toEqual({ ok: true });
    expect(read()).toContain('label: "Renamed"');
  });

  it('escapes single quotes when value contains one', async () => {
    write(TWO_SPACE_SAMPLE);
    const r = await patchObjectFieldFile(file, 'title', { label: "It's fine" });
    expect(r).toEqual({ ok: true });
    // Falls back to double-quoted since value contains apostrophe.
    expect(read()).toContain('label: "It\'s fine"');
  });

  it('removes label when value is empty string', async () => {
    write(TWO_SPACE_SAMPLE);
    const r = await patchObjectFieldFile(file, 'title', { label: '' });
    expect(r).toEqual({ ok: true });
    const out = read();
    // The label prop on title should be gone.
    const titleLine = out.split('\n').find((l) => l.startsWith('    title:')) ?? '';
    expect(titleLine).not.toContain('label');
  });

  it('returns error for unknown field', async () => {
    write(TWO_SPACE_SAMPLE);
    const r = await patchObjectFieldFile(file, 'missing', { label: 'x' });
    expect(r.ok).toBe(false);
  });
});
