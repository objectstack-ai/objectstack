import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Live e2e: a stored file opened from its signed link is rendered in place only
 * when its type is on the storage service's inline allow-list, and an
 * allow-listed type still renders or plays under the answer's sandbox CSP.
 *
 * The storage package pins the response headers
 * (`packages/services/service-storage/src/served-bytes-policy.test.ts`) and a
 * real boot pins them over HTTP
 * (`packages/qa/dogfood/test/stored-bytes-served-disposition.dogfood.test.ts`).
 * Neither can see what a browser does with them; this file can:
 *   • a PNG draws (the image document's image has a width);
 *   • a plain-text file shows its words;
 *   • a WAV plays (the media document's player reaches HAVE_METADATA);
 *   • an HTML file is handed to the browser as a download, not rendered.
 *
 * A PDF is not pinned here: the headless shell this lane runs has no PDF
 * viewer and saves every PDF, so no reading of it here could tell inline from
 * attachment.
 *
 * Live-only (needs the storage service + a real backend).
 */

const API = process.env.LIVE_API_URL || 'http://localhost:3000';

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/** A WAV of `samples` silent 8 kHz mono 8-bit PCM samples. */
function wav(samples: number): Buffer {
  const out = Buffer.alloc(44 + samples, 0x80);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + samples, 4);
  out.write('WAVEfmt ', 8, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(8000, 24);
  out.writeUInt32LE(8000, 28);
  out.writeUInt16LE(1, 32);
  out.writeUInt16LE(8, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(samples, 40);
  return out;
}

const HTML = Buffer.from('<!doctype html><title>stored page</title><p>stored page</p>');

/** Upload through the presigned door, commit, and answer the file's signed download link. */
async function storedFileLink(request: APIRequestContext, filename: string, mimeType: string, body: Buffer): Promise<string> {
  const presign = await request.post(`${API}/api/v1/storage/upload/presigned`, {
    data: { filename, mimeType, size: body.byteLength, scope: 'user' },
  });
  expect(presign.status(), await presign.text()).toBe(200);
  const { data } = await presign.json();

  const put = await request.put(new URL(String(data.uploadUrl), API).toString(), {
    headers: { 'content-type': mimeType },
    data: body,
  });
  expect(put.status(), await put.text()).toBeLessThan(300);

  const complete = await request.post(`${API}/api/v1/storage/upload/complete`, { data: { fileId: data.fileId } });
  expect(complete.status(), await complete.text()).toBe(200);

  const link = await request.get(`${API}/api/v1/storage/files/${encodeURIComponent(data.fileId)}/url`);
  expect(link.status(), await link.text()).toBe(200);
  return new URL(String((await link.json()).data.url), API).toString();
}

test('an allow-listed PNG opened from its link draws in place', async ({ page, request }) => {
  const url = await storedFileLink(request, 'pixel.png', 'image/png', PNG);
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => document.querySelector('img')?.naturalWidth ?? 0)).toBeGreaterThan(0);
});

test('an allow-listed plain-text file opened from its link shows its words in place', async ({ page, request }) => {
  const url = await storedFileLink(request, 'notes.txt', 'text/plain', Buffer.from('plain words\n'));
  await page.goto(url);
  await expect(page.locator('body')).toContainText('plain words');
});

test('an allow-listed WAV opened from its link plays in place under the media policy', async ({ page, request }) => {
  const url = await storedFileLink(request, 'tone.wav', 'audio/wav', wav(8000));
  await page.goto(url);
  // HAVE_METADATA (1) or better: the player loaded the file's own URL.
  await expect
    .poll(() => page.evaluate(() => (document.querySelector('video, audio') as HTMLMediaElement | null)?.readyState ?? -1))
    .toBeGreaterThanOrEqual(1);
});

test('an HTML file opened from its link is saved, not rendered', async ({ page, request }) => {
  const url = await storedFileLink(request, 'page.html', 'text/html', HTML);
  const download = page.waitForEvent('download');
  await page.goto(url).catch(() => {
    // A navigation that turns into a download rejects `goto` ("Download is starting").
  });
  expect((await download).suggestedFilename()).toBe('page.html');
});
