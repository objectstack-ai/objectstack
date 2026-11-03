/**
 * The icon entries of the Console's runtime web app manifest, derived from the
 * configured branding favicon (objectstack#29332).
 *
 * Every entry declares what its file really is: an SVG is `image/svg+xml` at
 * `sizes: 'any'`; a raster asset declares its own MIME type and the pixel size
 * it was measured at. An asset whose type or size cannot be established is left
 * out rather than guessed. When the branding offers no square raster of at
 * least 192 px, the Console's own 192 px and 512 px PNGs are added, so a
 * branded Console stays installable: browsers refuse to install an app whose
 * manifest has no large enough icon.
 *
 * Every `src` is absolute, because the manifest is served from a Blob URL,
 * which is no base to resolve a relative path against.
 */
import type { PWAIcon } from '@object-ui/mobile';

/** The Console's default icon, used when no branding favicon is configured. */
export const DEFAULT_ICON_PATH = './favicon.svg';

/** The Console's default raster icons, rendered from `public/favicon.svg`. */
export const DEFAULT_RASTER_ICONS: ReadonlyArray<{ path: string; size: number }> = [
  { path: './icon-192.png', size: 192 },
  { path: './icon-512.png', size: 512 },
];

/** The smallest square raster that makes the default PNGs unnecessary. */
export const MIN_INSTALL_ICON_PX = 192;

/** How long a raster favicon may take to load before it counts as unmeasured. */
export const MEASURE_TIMEOUT_MS = 10_000;

const SVG_TYPE = 'image/svg+xml';

/** MIME type by file extension, for the image formats a browser decodes. */
const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  svg: SVG_TYPE,
  png: 'image/png',
  ico: 'image/x-icon',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  avif: 'image/avif',
};

/** A measured pixel size. */
export interface IconSize {
  width: number;
  height: number;
}

/** Loads an image and resolves its natural size, or `null` if it cannot be measured. */
export type MeasureIcon = (src: string) => Promise<IconSize | null>;

/**
 * The MIME type of an icon URL: the media type of a `data:` URL, otherwise the
 * one its path's extension names. `undefined` when neither says.
 */
export function iconTypeOf(src: string): string | undefined {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return undefined;
  }
  if (url.protocol === 'data:') {
    const mediaType = url.pathname.split(/[;,]/, 1)[0].trim().toLowerCase();
    return Object.values(TYPE_BY_EXTENSION).includes(mediaType) ? mediaType : undefined;
  }
  const lastSegment = url.pathname.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot < 0) return undefined;
  return TYPE_BY_EXTENSION[lastSegment.slice(dot + 1).toLowerCase()];
}

/**
 * Measures an image in the browser through `HTMLImageElement`. Settles with
 * `null` on a load error, a zero size or after `timeoutMs`, so a favicon that
 * never answers cannot hold the manifest back forever.
 */
export function measureIconInBrowser(src: string, timeoutMs: number = MEASURE_TIMEOUT_MS): Promise<IconSize | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => settle(null), timeoutMs);
    function settle(size: IconSize | null) {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(size);
    }
    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      settle(width > 0 && height > 0 ? { width, height } : null);
    };
    image.onerror = () => settle(null);
    image.src = src;
  });
}

/**
 * The manifest icons for a branding favicon (`undefined` = none configured),
 * resolved against `baseURI`. Measures the favicon only when it is a raster
 * image; an SVG or the default icon resolves without loading anything.
 */
export async function resolveManifestIcons(
  faviconUrl: string | undefined,
  baseURI: string,
  measure: MeasureIcon = measureIconInBrowser,
): Promise<PWAIcon[]> {
  const src = new URL(faviconUrl || DEFAULT_ICON_PATH, baseURI).href;
  const type = iconTypeOf(src);
  if (type === SVG_TYPE) {
    return [{ src, sizes: 'any', type, purpose: 'any' }];
  }

  const icons: PWAIcon[] = [];
  const size = type ? await measure(src) : null;
  if (type && size) {
    icons.push({ src, sizes: `${size.width}x${size.height}`, type, purpose: 'any' });
  }
  const installable = size !== null && size.width === size.height && size.width >= MIN_INSTALL_ICON_PX;
  if (!installable) {
    for (const icon of DEFAULT_RASTER_ICONS) {
      icons.push({
        src: new URL(icon.path, baseURI).href,
        sizes: `${icon.size}x${icon.size}`,
        type: 'image/png',
        purpose: 'any',
      });
    }
  }
  return icons;
}
