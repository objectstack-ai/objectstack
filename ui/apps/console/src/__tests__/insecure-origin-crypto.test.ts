/**
 * objectui#4563 — `crypto.randomUUID` on insecure origins.
 *
 * These tests grade THE SHIPPED ARTIFACT. The fix is an inline classic script
 * in `apps/console/index.html` (it must run during parse, before any module
 * chunk — see that file's comment for the measurement that ruled out a
 * `type="module"` shim), so the tests extract that script's text and execute
 * it. There is deliberately no second copy of the logic in TypeScript: a
 * testable duplicate that can drift from the one that ships would be graded
 * green while the real bootstrap rots.
 *
 * The red-first cases drive REAL in-repo consumers through
 * `@object-ui/plugin-view`'s public API — `toFilterGroup` (which reaches
 * `parseTriplet`'s unguarded `crypto.randomUUID()` on the list-view filter
 * path, view-config-utils.ts:146) and `toSortItems` (which calls it directly,
 * :294) — against a crypto object shaped exactly like an insecure origin's,
 * and pin the resulting message verbatim against the string the report quotes.
 */
import indexHtml from '../../index.html?raw';
import { toFilterGroup, toSortItems } from '@object-ui/plugin-view';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The real entropy source, BOUND once at module load.
 *
 * Binding matters: a `(buffer) => globalThis.crypto.getRandomValues(buffer)`
 * wrapper re-reads the global at call time, so the moment a test stubs
 * `globalThis.crypto` with an object whose `getRandomValues` IS that wrapper it
 * recurses into itself until the stack blows. Capturing the native function up
 * front makes the helper immune to every stub below.
 */
const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);

/** Canonical RFC 4122 v4, lowercase: version nibble `4`, variant `8|9|a|b`. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The shim exactly as it ships: the body of the one inline script in
 * `index.html` that installs the fallback. Extraction is by the IIFE's name, so
 * renaming or deleting the script fails here rather than silently testing
 * nothing.
 */
function extractShimSource(html: string = indexHtml): string {
  // Comments stripped first — prose describing a script tag parses as one.
  const scripts = [
    ...html
      .replace(/<!--[\s\S]*?-->/g, '')
      .matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  const shim = scripts.filter((match) =>
    match[1]?.includes('installInsecureOriginRandomUuid')
  );
  if (shim.length !== 1) {
    throw new Error(
      `expected exactly 1 inline shim script in index.html, found ${shim.length}`
    );
  }
  return shim[0]?.[1] ?? '';
}

/**
 * Run the shipped shim against whatever `globalThis.crypto` currently is.
 *
 * Executing the extracted text is the point: it is the only way to grade the
 * bootstrap that actually ships, and the input is this repository's own
 * `index.html`, not anything a user or a request can reach.
 */
function runShim(): void {
  new Function(extractShimSource())();
}

/** What a browser hands you on `http://LAN-IP`: getRandomValues, no randomUUID. */
function insecureOriginCrypto(): { getRandomValues: typeof realGetRandomValues; randomUUID?: unknown } {
  return { getRandomValues: realGetRandomValues };
}

/** The installed fallback, after running the shim on an insecure-origin crypto. */
function installedRandomUUID(): () => string {
  const cryptoLike = insecureOriginCrypto();
  vi.stubGlobal('crypto', cryptoLike);
  runShim();
  expect(typeof cryptoLike.randomUUID).toBe('function');
  return cryptoLike.randomUUID as () => string;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the shipped shim is findable', () => {
  it('is exactly one inline script in index.html', () => {
    const source = extractShimSource();
    expect(source).toContain('getRandomValues');
    expect(source).toContain('randomUUID');
  });

  it('fails loudly if the script is gone rather than passing vacuously', () => {
    expect(() => extractShimSource('<html></html>')).toThrow(/found 0/);
  });
});

describe('the generator', () => {
  it('renders the canonical 8-4-4-4-12 shape', () => {
    expect(installedRandomUUID()()).toMatch(UUID_V4);
  });

  it('forces the version nibble and variant bits regardless of the entropy', () => {
    // All-ones and all-zeros entropy pin the SIX fixed bits exactly: only the
    // version nibble (octet 6 high half) and the variant (octet 8 top two bits)
    // may differ from the raw bytes.
    const ones = { getRandomValues: (b: Uint8Array<ArrayBuffer>) => b.fill(0xff) };
    vi.stubGlobal('crypto', ones);
    runShim();
    expect((ones as { randomUUID?: () => string }).randomUUID?.()).toBe(
      'ffffffff-ffff-4fff-bfff-ffffffffffff'
    );

    const zeros = { getRandomValues: (b: Uint8Array<ArrayBuffer>) => b.fill(0x00) };
    vi.stubGlobal('crypto', zeros);
    runShim();
    expect((zeros as { randomUUID?: () => string }).randomUUID?.()).toBe(
      '00000000-0000-4000-8000-000000000000'
    );
  });

  it('always reports version 4 and the RFC 4122 variant', () => {
    const randomUUID = installedRandomUUID();
    for (let i = 0; i < 200; i++) {
      const uuid = randomUUID();
      expect(uuid).toMatch(UUID_V4);
      expect(uuid[14]).toBe('4');
      expect(['8', '9', 'a', 'b']).toContain(uuid[19]);
    }
  });

  it('draws 16 bytes and does not repeat itself across a sample', () => {
    const widths: number[] = [];
    const spy = {
      getRandomValues: (b: Uint8Array<ArrayBuffer>) => {
        widths.push(b.length);
        return realGetRandomValues(b);
      },
    };
    vi.stubGlobal('crypto', spy);
    runShim();
    const randomUUID = (spy as { randomUUID?: () => string }).randomUUID as () => string;

    const sample = new Set(Array.from({ length: 1000 }, () => randomUUID()));
    expect(sample.size).toBe(1000);
    expect(widths).toHaveLength(1000);
    expect(new Set(widths)).toEqual(new Set([16]));
  });
});

describe('the installer', () => {
  it('installs onto an insecure-origin crypto that lacks randomUUID', () => {
    const cryptoLike = insecureOriginCrypto();
    expect('randomUUID' in cryptoLike).toBe(false);

    vi.stubGlobal('crypto', cryptoLike);
    runShim();

    expect(typeof cryptoLike.randomUUID).toBe('function');
    expect((cryptoLike.randomUUID as () => string)()).toMatch(UUID_V4);
  });

  it('MUST NOT touch a native implementation — identity is preserved', () => {
    const native = (): string => '11111111-2222-4333-8444-555555555555';
    const cryptoLike = { randomUUID: native, getRandomValues: realGetRandomValues };

    vi.stubGlobal('crypto', cryptoLike);
    runShim();

    // Identity, not behaviour: the native function object itself is still there.
    expect(cryptoLike.randomUUID).toBe(native);
  });

  it('is idempotent — a second run keeps the first fallback', () => {
    const cryptoLike = insecureOriginCrypto();
    vi.stubGlobal('crypto', cryptoLike);
    runShim();
    const first = cryptoLike.randomUUID;

    runShim();

    expect(cryptoLike.randomUUID).toBe(first);
  });

  it('refuses to install without an entropy source instead of degrading', () => {
    // No getRandomValues => no cryptographic randomness available. We do NOT
    // fall back to Math.random. Surfacing this state to the user is
    // objectui#4570, deliberately not this shim's job.
    const cryptoLike: { randomUUID?: unknown } = {};
    vi.stubGlobal('crypto', cryptoLike);

    expect(() => runShim()).not.toThrow();
    expect('randomUUID' in cryptoLike).toBe(false);
  });

  it('does not throw when there is no crypto global at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => runShim()).not.toThrow();
  });
});

describe('the real consumer path (objectui#4563 repro)', () => {
  it('throws the card verbatim TypeError with no shim installed', () => {
    vi.stubGlobal('crypto', insecureOriginCrypto());

    let caught: unknown;
    try {
      toFilterGroup(['name', '=', 'x']);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as TypeError).message).toBe('crypto.randomUUID is not a function');
  });

  it('throws the same TypeError from the sort path with no shim installed', () => {
    vi.stubGlobal('crypto', insecureOriginCrypto());

    let caught: unknown;
    try {
      toSortItems([{ field: 'name', order: 'asc' }]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as TypeError).message).toBe('crypto.randomUUID is not a function');
  });

  it('renders the same filter and sort normally once the shim has run', () => {
    vi.stubGlobal('crypto', insecureOriginCrypto());
    runShim();

    const group = toFilterGroup(['name', '=', 'x']);
    expect(group.conditions).toHaveLength(1);
    expect(group.conditions[0]?.field).toBe('name');
    expect(group.conditions[0]?.id).toMatch(UUID_V4);

    const sorts = toSortItems([{ field: 'name', order: 'asc' }]);
    expect(sorts).toHaveLength(1);
    expect(sorts[0]?.field).toBe('name');
    expect(sorts[0]?.id).toMatch(UUID_V4);
  });
});
