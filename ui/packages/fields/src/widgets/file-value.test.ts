import { describe, it, expect } from 'vitest';
import {
  isFileIdToken,
  fileIdOf,
  readFileValue,
  readFileValues,
  isImageValue,
  fileValueForSubmit,
  UploadIncompleteError,
  uploadResultView,
  withRecentUploads,
} from './file-value';

const uploadResult = (over: Record<string, unknown> = {}) => ({
  url: 'https://app.example.com/api/v1/storage/files/file_a',
  name: 'a.png',
  size: 1024,
  mimeType: 'image/png',
  ...over,
});

describe('isFileIdToken', () => {
  it.each(['file_a', 'abc123', '0e2f4c1a-9b7d-4e3f-8a1b-2c3d4e5f6a7b', 'A-_9'])(
    'accepts the minted id %s',
    (v) => expect(isFileIdToken(v)).toBe(true),
  );

  it.each([
    'https://cdn.example.com/a.png',
    '/api/v1/storage/files/file_a',
    'data:image/png;base64,aGk=',
    'blob:http://localhost/abc',
    'a.png',
    '',
  ])('rejects the URL-shaped or dotted value %s', (v) => expect(isFileIdToken(v)).toBe(false));

  it('rejects non-strings and over-long values', () => {
    expect(isFileIdToken(null)).toBe(false);
    expect(isFileIdToken(42)).toBe(false);
    expect(isFileIdToken('a'.repeat(65))).toBe(false);
  });
});

describe('fileIdOf', () => {
  it('reads a bare reference', () => {
    expect(fileIdOf('file_a')).toBe('file_a');
  });

  it('prefers file_id, then id', () => {
    expect(fileIdOf({ file_id: 'legacy', id: 'expanded' })).toBe('legacy');
    expect(fileIdOf({ id: 'expanded' })).toBe('expanded');
  });

  it('returns undefined when there is no id to read', () => {
    expect(fileIdOf({ url: 'https://cdn.example.com/a.png', name: 'a.png' })).toBeUndefined();
    expect(fileIdOf('https://cdn.example.com/a.png')).toBeUndefined();
    expect(fileIdOf(null)).toBeUndefined();
  });
});

describe('readFileValue', () => {
  /**
   * The casing split is the reason this module exists: the platform's expanded
   * form is camelCase `mimeType`, the legacy inline blob is snake_case
   * `mime_type`. A widget reading only one silently stops recognising images
   * the moment the backend switches form.
   */
  it('reads the expanded form (camelCase mimeType)', () => {
    const view = readFileValue({
      id: 'file_a',
      name: 'a.png',
      size: 1024,
      mimeType: 'image/png',
      url: '/api/v1/storage/files/file_a',
    });

    expect(view).toMatchObject({
      id: 'file_a',
      name: 'a.png',
      size: 1024,
      mimeType: 'image/png',
      url: '/api/v1/storage/files/file_a',
    });
    expect(isImageValue(view)).toBe(true);
  });

  it('reads the legacy inline blob (snake_case mime_type)', () => {
    const view = readFileValue({
      file_id: 'file_a',
      name: 'a.png',
      original_name: 'original.png',
      size: 1024,
      mime_type: 'image/png',
      url: 'https://cdn.example.com/a.png',
    });

    expect(view).toMatchObject({ id: 'file_a', name: 'a.png', mimeType: 'image/png' });
    expect(isImageValue(view)).toBe(true);
  });

  it('falls back to original_name when name is absent', () => {
    expect(readFileValue({ original_name: 'orig.pdf' }).name).toBe('orig.pdf');
  });

  it('derives a name from the URL when the value carries none', () => {
    expect(readFileValue({ url: 'https://cdn.example.com/docs/report%20v2.pdf' }).name).toBe(
      'report v2.pdf',
    );
    expect(readFileValue('https://cdn.example.com/a.png').name).toBe('a.png');
  });

  /**
   * objectui#10493: a `data:` URI has no path, so its "last segment" was the
   * MIME tail plus the base64 payload (`png;base64,…`), which then named the
   * image cell's `<img>`. It carries no file name, so the caller's fallback
   * applies; the URL itself is kept byte-for-byte.
   */
  describe('a data: URI carries no file name (objectui#10493)', () => {
    const DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';

    it('a data: string gets the fallback name and keeps its URL', () => {
      expect(readFileValue(DATA_URI)).toEqual({ url: DATA_URI, name: 'File', raw: DATA_URI });
      expect(readFileValue(DATA_URI, 'Fichier').name).toBe('Fichier');
    });

    it('a { url: data: } object gets the fallback name and keeps its URL', () => {
      const view = readFileValue({ url: DATA_URI }, 'Fichier');
      expect(view.name).toBe('Fichier');
      expect(view.url).toBe(DATA_URI);
    });

    it('a name the object carries still wins over the fallback', () => {
      expect(readFileValue({ url: DATA_URI, name: 'sig.png' }, 'Fichier').name).toBe('sig.png');
    });

    it('a payload holding a `/`, or an upper-case scheme, names nothing either', () => {
      // Base64 uses `/`, so the old "last segment" was then a payload fragment.
      expect(readFileValue('data:image/png;base64,ab/cd+ef==', 'Fichier').name).toBe('Fichier');
      expect(readFileValue('DATA:image/png;base64,iVBORw0KGgo=', 'Fichier').name).toBe('Fichier');
    });

    it('THE LIT CONTROL: https and blob: URLs keep their last segment', () => {
      expect(readFileValue('https://cdn.example.com/a/photo.png', 'Fichier').name).toBe('photo.png');
      expect(readFileValue({ url: 'https://cdn.example.com/a/photo.png' }, 'Fichier').name).toBe('photo.png');
      expect(readFileValue('blob:http://localhost/abc-123', 'Fichier').name).toBe('abc-123');
    });
  });

  /**
   * objectui#10614: a last segment that is not a valid percent-encoding made
   * `decodeURIComponent` throw `URIError: URI malformed`, and `readFileValue`
   * threw with it, during render. `FileValueSchema.url` is a plain string, so
   * both values below pass the contract. The name is now the raw segment.
   */
  describe('a last segment holding a bare `%` names the file by its raw segment (objectui#10614)', () => {
    it('a URL string whose last segment holds a bare `%` does not throw', () => {
      const url = 'https://cdn.example.com/100%.png';
      expect(() => readFileValue(url)).not.toThrow();
      expect(readFileValue(url)).toEqual({ url, name: '100%.png', raw: url });
    });

    it('a { url } object whose last segment holds an invalid escape does not throw', () => {
      const value = { url: 'https://cdn.example.com/a%zz.pdf' };
      expect(() => readFileValue(value)).not.toThrow();
      const view = readFileValue(value);
      expect(view.name).toBe('a%zz.pdf');
      expect(view.url).toBe(value.url);
    });

    it('readFileValues reads both values in one field without throwing', () => {
      expect(
        readFileValues(['https://cdn.example.com/100%.png', { url: 'https://cdn.example.com/a%zz.pdf' }]).map(
          (v) => v.name,
        ),
      ).toEqual(['100%.png', 'a%zz.pdf']);
    });

    it('THE CONTROL: a valid escape still decodes', () => {
      expect(readFileValue('https://cdn.example.com/report%20q3.pdf').name).toBe('report q3.pdf');
      expect(readFileValue({ url: 'https://cdn.example.com/report%20q3.pdf' }).name).toBe('report q3.pdf');
    });
  });

  it('resolves a bare reference to the stable download URL', () => {
    const view = readFileValue('file_a', 'File');

    // The read path may leave a value in its bare-reference form (seen on the
    // edit-form data path); the stable endpoint is derivable from the id, so a
    // thumbnail still renders instead of a broken `<img src="">`.
    expect(view).toMatchObject({ id: 'file_a', name: 'File' });
    expect(view.url).toBe('/api/v1/storage/files/file_a');
  });

  it('derives the URL of an object that carries an id but no url', () => {
    const view = readFileValue({ id: 'file_b', name: 'b.png' });
    expect(view.url).toBe('/api/v1/storage/files/file_b');
  });

  it('treats a URL string as a URL, never as a reference', () => {
    const view = readFileValue('/api/v1/storage/files/file_a');
    expect(view.id).toBeUndefined();
    expect(view.url).toBe('/api/v1/storage/files/file_a');
  });

  it('uses the supplied fallback name so widgets stay localised', () => {
    expect(readFileValue({}, '文件').name).toBe('文件');
    expect(readFileValue(null, '文件').name).toBe('文件');
  });

  it('is not an image when the MIME type says otherwise or is missing', () => {
    expect(isImageValue(readFileValue({ mimeType: 'application/pdf' }))).toBe(false);
    expect(isImageValue(readFileValue({ name: 'a.png' }))).toBe(false);
  });
});

describe('readFileValues', () => {
  it('normalises single, array and empty values', () => {
    expect(readFileValues(null)).toEqual([]);
    expect(readFileValues([])).toEqual([]);
    expect(readFileValues('file_a')).toHaveLength(1);
    expect(readFileValues(['file_a', 'file_b'])).toHaveLength(2);
  });

  it('drops null entries inside an array', () => {
    expect(readFileValues(['file_a', null, 'file_b'])).toHaveLength(2);
  });

  it('handles a mixed-form array during the transition', () => {
    const views = readFileValues([
      'file_a',
      { id: 'file_b', name: 'b.png', mimeType: 'image/png' },
      { name: 'c.png', mime_type: 'image/png', url: 'https://cdn.example.com/c.png' },
    ]);

    expect(views.map((v) => v.id)).toEqual(['file_a', 'file_b', undefined]);
    expect(views.map(isImageValue)).toEqual([false, true, true]);
  });
});

describe('fileValueForSubmit', () => {
  it('submits the bare reference when the adapter surfaced a fileId', () => {
    expect(fileValueForSubmit(uploadResult({ meta: { fileId: 'file_a' } }), 'orig.png')).toBe(
      'file_a',
    );
  });

  /**
   * objectui#7699: the branch that stood here built `{ name, original_name,
   * size, mime_type, url }` when no fileId came back — the one client path in
   * either repo still PRODUCING the pre-D3 inline blob, a shape no deployment's
   * stored contract accepts (`valueSchemaFor(field, 'stored')` is id-only;
   * ADR-0104's 2026-09-05 addendum fixes the column to the bare id too). It is
   * retired: the submit is refused by name, and nothing carrying a URL leaves.
   */
  describe('refuses a completed upload that surfaced no fileId (objectui#7699)', () => {
    const refusalOf = (run: () => unknown): UploadIncompleteError => {
      try {
        run();
      } catch (err) {
        return err as UploadIncompleteError;
      }
      throw new Error('expected fileValueForSubmit to refuse, but it returned a value');
    };

    it('throws the NAMED refusal, carrying the pick name — no blob is built', () => {
      const err = refusalOf(() => fileValueForSubmit(uploadResult(), 'orig.png'));
      expect(err).toBeInstanceOf(UploadIncompleteError);
      expect(err.name).toBe('UploadIncompleteError');
      expect(err.code).toBe('UPLOAD_INCOMPLETE');
      expect(err.fileName).toBe('orig.png');
      expect(err.message).toContain('did not complete');
      // The refusal carries no URL and no MIME type: the adapter's result is
      // not smuggled out through the error either.
      const own = JSON.stringify({ ...err, message: err.message });
      expect(own).not.toContain('https://app.example.com');
      expect(own).not.toContain('image/png');
    });

    it('names the adapter’s stored object name when the caller has no pick name', () => {
      expect(refusalOf(() => fileValueForSubmit(uploadResult())).fileName).toBe('a.png');
    });

    it('treats a meta.fileId that is not id-shaped as no id at all', () => {
      const err = refusalOf(() =>
        fileValueForSubmit(uploadResult({ meta: { fileId: 'https://evil.example/x' } }), 'orig.png'),
      );
      expect(err.code).toBe('UPLOAD_INCOMPLETE');
    });

    it('THE CONTROL: an id-shaped fileId beside the same result still submits the id', () => {
      expect(fileValueForSubmit(uploadResult({ meta: { fileId: 'file_a' } }), 'orig.png')).toBe('file_a');
    });
  });

  it('round-trips through readFileValue', () => {
    const asRef = fileValueForSubmit(uploadResult({ meta: { fileId: 'file_a' } }));
    expect(readFileValue(asRef).id).toBe('file_a');
  });
});

describe('withRecentUploads', () => {
  it('fills in display details for a bare reference just uploaded', () => {
    const view = uploadResultView(uploadResult({ meta: { fileId: 'file_a' } }), 'orig.png');
    const merged = withRecentUploads(readFileValues('file_a'), { file_a: view });

    expect(merged[0]).toMatchObject({
      id: 'file_a',
      name: 'a.png',
      mimeType: 'image/png',
      url: 'https://app.example.com/api/v1/storage/files/file_a',
    });
    // The raw value stays the reference — display enrichment must not change
    // what the field submits.
    expect(merged[0].raw).toBe('file_a');
  });

  it('leaves a value the backend already expanded alone', () => {
    const stale = uploadResultView(uploadResult({ name: 'stale.png', meta: { fileId: 'file_a' } }));
    const expanded = readFileValues([{ id: 'file_a', name: 'fresh.png', url: '/u', mimeType: 'image/png' }]);

    expect(withRecentUploads(expanded, { file_a: stale })[0].name).toBe('fresh.png');
  });

  it('is a no-op with nothing remembered', () => {
    const views = readFileValues('file_a');
    expect(withRecentUploads(views, {})).toBe(views);
  });
});
