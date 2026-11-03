/**
 * The Console manifest's icons, by branding favicon (objectstack#29332): each
 * icon declares its real type and size, and a branding without a large enough
 * square raster gains the Console's 192 px and 512 px PNGs, so the Console
 * stays installable.
 */
import { describe, it, expect, vi } from 'vitest';
import { generatePWAManifest } from '@object-ui/mobile';
import {
  iconTypeOf,
  measureIconInBrowser,
  resolveManifestIcons,
  type IconSize,
  type MeasureIcon,
} from './pwaManifestIcons';

const BASE = 'https://acme.example/_console/';

const DEFAULT_PNGS = [
  { src: `${BASE}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: `${BASE}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
];

/** A measurement stub that answers `size` for every source. */
function measuring(size: IconSize | null) {
  return vi.fn<MeasureIcon>(async () => size);
}

/** The icons of the manifest the Console generates for a favicon. */
async function manifestIcons(faviconUrl: string | undefined, measure: MeasureIcon) {
  const icons = await resolveManifestIcons(faviconUrl, BASE, measure);
  return generatePWAManifest({ enabled: true, name: 'Acme', shortName: 'Acme', icons }).icons;
}

describe('Console PWA manifest icons', () => {
  it('no branding: the default SVG, scalable, nothing measured', async () => {
    const measure = measuring(null);
    expect(await manifestIcons(undefined, measure)).toEqual([
      { src: `${BASE}favicon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ]);
    expect(measure).not.toHaveBeenCalled();
  });

  it('SVG branding: the branded SVG, scalable, nothing measured', async () => {
    const measure = measuring(null);
    expect(await manifestIcons('/runtime/assets/brand.svg?v=3', measure)).toEqual([
      {
        src: 'https://acme.example/runtime/assets/brand.svg?v=3',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ]);
    expect(measure).not.toHaveBeenCalled();
  });

  it('small PNG branding: declared as a PNG at its measured size, plus the default PNGs', async () => {
    const measure = measuring({ width: 32, height: 32 });
    expect(await manifestIcons('https://cdn.acme.example/favicon.png', measure)).toEqual([
      { src: 'https://cdn.acme.example/favicon.png', sizes: '32x32', type: 'image/png', purpose: 'any' },
      ...DEFAULT_PNGS,
    ]);
    expect(measure).toHaveBeenCalledWith('https://cdn.acme.example/favicon.png');
  });

  it('PNG branding of at least 192 px square: the branded PNG alone', async () => {
    expect(await manifestIcons('/brand/icon.PNG', measuring({ width: 256, height: 256 }))).toEqual([
      { src: 'https://acme.example/brand/icon.PNG', sizes: '256x256', type: 'image/png', purpose: 'any' },
    ]);
  });

  it('a large but non-square PNG still gets the default PNGs', async () => {
    expect(await manifestIcons('/brand/wide.png', measuring({ width: 600, height: 200 }))).toEqual([
      { src: 'https://acme.example/brand/wide.png', sizes: '600x200', type: 'image/png', purpose: 'any' },
      ...DEFAULT_PNGS,
    ]);
  });

  it('ICO branding: declared as an icon file at its measured size, plus the default PNGs', async () => {
    expect(await manifestIcons('/favicon.ico', measuring({ width: 48, height: 48 }))).toEqual([
      { src: 'https://acme.example/favicon.ico', sizes: '48x48', type: 'image/x-icon', purpose: 'any' },
      ...DEFAULT_PNGS,
    ]);
  });

  it('a raster favicon that cannot be measured is left out, the default PNGs stand in', async () => {
    expect(await manifestIcons('/favicon.ico', measuring(null))).toEqual(DEFAULT_PNGS);
  });

  it('a favicon of unknown type is left out unmeasured, the default PNGs stand in', async () => {
    const measure = measuring({ width: 512, height: 512 });
    expect(await manifestIcons('/api/branding/favicon', measure)).toEqual(DEFAULT_PNGS);
    expect(measure).not.toHaveBeenCalled();
  });
});

describe('iconTypeOf', () => {
  it.each([
    ['https://a.example/x.svg', 'image/svg+xml'],
    ['https://a.example/x.svg#frag', 'image/svg+xml'],
    ['https://a.example/x.png?v=2', 'image/png'],
    ['https://a.example/x.ico', 'image/x-icon'],
    ['https://a.example/x.webp', 'image/webp'],
    ['https://a.example/x.jpeg', 'image/jpeg'],
    ['data:image/png;base64,AAAA', 'image/png'],
    ['data:image/svg+xml,%3Csvg%2F%3E', 'image/svg+xml'],
    ['https://a.example/x.svg.txt', undefined],
    ['https://a.example/favicon', undefined],
    ['data:text/plain,hi', undefined],
    ['not a url', undefined],
  ])('%s -> %s', (src, type) => {
    expect(iconTypeOf(src)).toBe(type);
  });
});

describe('measureIconInBrowser', () => {
  /** Replaces `Image` with one whose load the test drives. */
  function stubImage(outcome: { width: number; height: number } | 'error' | 'hang') {
    class FakeImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => {
          if (outcome === 'hang') return;
          if (outcome === 'error') {
            this.onerror?.();
            return;
          }
          this.naturalWidth = outcome.width;
          this.naturalHeight = outcome.height;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal('Image', FakeImage);
  }

  it('resolves the natural size of a loaded image', async () => {
    stubImage({ width: 64, height: 64 });
    await expect(measureIconInBrowser('/x.png')).resolves.toEqual({ width: 64, height: 64 });
    vi.unstubAllGlobals();
  });

  it('settles null on a load error or a zero size', async () => {
    stubImage('error');
    await expect(measureIconInBrowser('/x.png')).resolves.toBeNull();
    stubImage({ width: 0, height: 0 });
    await expect(measureIconInBrowser('/x.png')).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it('settles null when the image never answers, after the timeout', async () => {
    vi.useFakeTimers();
    stubImage('hang');
    const pending = measureIconInBrowser('/x.png', 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
