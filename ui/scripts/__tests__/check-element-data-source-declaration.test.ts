import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper; its types are inferred from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`).
import { HOST_EXEMPTIONS, judgeSite, registersComponent } from '../check-element-data-source-declaration.mjs';
import { maskComments } from '../js-comment-mask.mjs';

/**
 * The named-host exemption of `check:element-data-source-declaration`
 * (objectui#12931, seat ruling 6272155387): `PageView.tsx` consumes the gate to
 * resolve `PageSchema.record` and registers no block, so there is no input for
 * the seam to publish. The exemption names that one file and is SELF-LIMITING:
 * it holds only while the file registers nothing. Both directions are pinned
 * on the real file's text, not on a fixture that could drift from it.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOST = 'packages/app-shell/src/views/PageView.tsx';
const hostCode = maskComments(fs.readFileSync(path.join(repoRoot, HOST), 'utf8'));

describe('check:element-data-source-declaration — the named host exemption (objectui#12931)', () => {
  it('names exactly one file, with a reason', () => {
    expect(Object.keys(HOST_EXEMPTIONS)).toEqual([HOST]);
    expect(HOST_EXEMPTIONS[HOST]).toMatch(/PageSchema\.record/);
  });

  it('the exempted host, as it is today, passes: it registers nothing and is judged a host', () => {
    // Control: the host really consumes the gate and really skips the seam, so
    // without the exemption it is exactly the file the rule names.
    expect(hostCode).toMatch(/<ElementDataSourceGate[\s>]/);
    expect(registersComponent(hostCode)).toBe(false);
    const site = judgeSite(HOST, hostCode);
    expect(site.reachesSeam).toBe(false);
    expect(site.host).toBe(HOST_EXEMPTIONS[HOST]);
  });

  it('the same host plus a registry registration is judged like any consumer: no exemption', () => {
    const code = `${hostCode}\nComponentRegistry.register('page-probe', PageView);\n`;
    expect(registersComponent(code)).toBe(true);
    expect(judgeSite(HOST, code).host).toBeUndefined();
  });

  it('the same host plus a bare `register(` call loses the exemption too', () => {
    const code = `${hostCode}\nregister('page-probe', PageView);\n`;
    expect(registersComponent(code)).toBe(true);
    expect(judgeSite(HOST, code).host).toBeUndefined();
  });

  it('a commented-out registration does not count, because the file is read masked', () => {
    const code = maskComments(`${fs.readFileSync(path.join(repoRoot, HOST), 'utf8')}\n// ComponentRegistry.register('x', X);\n`);
    expect(judgeSite(HOST, code).host).toBe(HOST_EXEMPTIONS[HOST]);
  });

  it('is no pattern: the identical text at another path is not exempt', () => {
    expect(judgeSite('packages/app-shell/src/views/PageViewCopy.tsx', hostCode).host).toBeUndefined();
    expect(judgeSite('packages/app-shell/src/views/other/PageView.tsx', hostCode).host).toBeUndefined();
  });
});
