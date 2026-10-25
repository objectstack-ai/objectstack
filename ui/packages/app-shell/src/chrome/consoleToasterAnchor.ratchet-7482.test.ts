/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7482 ratchet — no console may re-anchor the toaster onto the corner
 * the assistant lives in.
 *
 * `ConsoleToaster.autoDismiss-7482` next door pins the COMPONENT: its default
 * is top-right, and a success toast dismisses itself inside the 3–5s band the
 * card asked for. Neither assertion can see the MOUNT, and the mount is where
 * the defect actually was — `apps/console/src/App.tsx` carried a
 * `position="bottom-right"` override that predates ADR-0057 P3a, which dropped
 * every toast onto the ChatDock composer's send button. That both covered the
 * button and, because sonner pauses a toast's dismiss timer while the pointer
 * is inside the toaster region (`expanded || interacting || isDocumentHidden`),
 * stopped the 4s default from ever running. One defect, two symptoms.
 *
 * Read from SOURCE rather than by rendering `<App>`: answering a question about
 * one prop should not need the router, the auth provider and the whole console
 * graph. Same shape as `providers/expressionUser.mountSites.ratchet`.
 *
 * If this fails: the toaster may be moved, but only onto a corner nothing
 * interactive occupies. Bottom-right is the FAB and the assistant composer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/** Every `<ConsoleToaster …>` element in a file, as written. */
const MOUNT_RE = /<ConsoleToaster\b[^>]*\/?>/g;

/** The consoles that mount the toaster. One today; the list is the point. */
const MOUNT_FILES = ['apps/console/src/App.tsx'] as const;

describe('console toaster anchor (objectui#7482)', () => {
  it.each(MOUNT_FILES)('%s mounts exactly one ConsoleToaster', (rel) => {
    const source = readFileSync(path.join(repoRoot, rel), 'utf8');
    expect(source.match(MOUNT_RE) ?? []).toHaveLength(1);
  });

  it.each(MOUNT_FILES)('%s passes no `position` — the component owns the anchor', (rel) => {
    const source = readFileSync(path.join(repoRoot, rel), 'utf8');
    const mount = (source.match(MOUNT_RE) ?? [])[0];
    expect(mount, 'the assistant composer and the FAB own bottom-right').not.toMatch(/bottom-right/);
    expect(mount).not.toMatch(/\bposition\s*=/);
  });

  it('the control: the matcher WOULD have caught the override it replaced', () => {
    // Non-vacuity — a matcher that has silently stopped matching passes both
    // assertions above while checking nothing.
    const retired = '      <ConsoleToaster position="bottom-right" />';
    const found = retired.match(MOUNT_RE) ?? [];
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/bottom-right/);
    expect(found[0]).toMatch(/\bposition\s*=/);
  });
});
