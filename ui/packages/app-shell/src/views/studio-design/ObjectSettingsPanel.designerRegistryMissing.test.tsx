// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6846 — the Settings panel on an EMPTY default-inspector registry.
 *
 * #7120 (#6795 part C) repaired the three studio-design consumers that went
 * silent or stated a false reason when the designer registries are
 * unpopulated, and pinned each of them. It deliberately left the two consumers
 * the measurement found ALREADY honest unpinned — this panel and
 * `ObjectHooksPanel`. Without a pin, one refactor moves either of them into the
 * silent class with nothing going red; #6846 calls that the cheap half of the
 * card and where its durability lives.
 *
 * ## What is pinned
 *
 * Two halves, both load-bearing:
 *
 *   1. the Basics section names the missing editor — "No default object
 *      inspector registered." — exactly once, inside the ONE section whose
 *      editor is missing;
 *   2. the panel's other sections (sharing model, semantic roles, capabilities)
 *      do not read the registry and still render.
 *
 * A consumer that answered every state with one constant string would keep (1)
 * and fail (2); a consumer that dropped the message and rendered an empty
 * Basics section — the silent class this card exists to keep it out of — would
 * fail (1). The populated contrast, where the real `ObjectDefaultInspector`
 * mounts and this message must NOT appear, is
 * {@link file://./DataPillar.designerRegistryPopulated.test.tsx}.
 *
 * ⛔ No message may promise recovery ("loading…", "try again"). When this pin
 * was written the registry was a plain `Map` read during render with no
 * subscription, so a later registration never reached this component (measured
 * on #6795). Since objectui#11939 it does (pinned in
 * `ObjectPanels.lateRegistration-11939.test.tsx`), but nothing here knows a
 * registration is on its way, so the message still promises nothing.
 *
 * ⚠️ This file must never register a designer — its subject is the empty
 * branch, and the registries are module state shared by every test in a file.
 * Emptiness is asserted FIRST, with a control that must hit: a zero that is
 * not asserted is not a reading.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

import { ObjectSettingsPanel } from './ObjectSettingsPanel';
import { listMetadataPreviewTypes } from '../metadata-admin/preview-registry';
import { listMetadataInspectorTypes } from '../metadata-admin/inspector-registry';
import { getMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { getStudioCanvasPreview } from './studio-canvas-preview';

const NO_INSPECTOR = 'No default object inspector registered.';

const draft = {
  name: 'showcase_task',
  label: 'Task',
  fields: { title: { type: 'text', label: 'Title' } },
};

afterEach(cleanup);

/**
 * Assert the registries really are empty — with a control that MUST hit.
 * `studio-canvas-preview` self-registers `object` at module scope, so a defined
 * control proves the module graph loaded and the lookup works; only then are
 * the zeros below readings rather than a failed import.
 */
function assertRegistriesEmptyWithControl(): void {
  expect(getStudioCanvasPreview('object')).toBeTypeOf('function'); // control — MUST hit
  expect(listMetadataPreviewTypes()).toEqual([]);
  expect(listMetadataInspectorTypes()).toEqual([]);
  expect(getMetadataDefaultInspector('object')).toBeUndefined();
  expect(getMetadataDefaultInspector('hook')).toBeUndefined();
  expect(getMetadataDefaultInspector('action')).toBeUndefined();
}

describe('ObjectSettingsPanel — no default object inspector registered (#6846)', () => {
  it('names the missing editor in Basics, once, and keeps the rest of the panel', () => {
    assertRegistriesEmptyWithControl();

    render(<ObjectSettingsPanel name="showcase_task" draft={draft} onPatch={() => {}} locale="en-US" />);

    // Exactly one — `queryAllByText` rather than `getByText`, which throws on a
    // duplicate too and would read a repeated string as a missing one.
    expect(screen.queryAllByText(NO_INSPECTOR)).toHaveLength(1);
    // …and it sits in the Basics section, the one whose editor is missing.
    const basics = screen.getByText('Basics').closest('section') as HTMLElement;
    expect(basics).toBeTruthy();
    expect(within(basics).getByText(NO_INSPECTOR)).toBeInTheDocument();
    // The sections that do not read the registry still render — the empty
    // state is scoped to one section, not a curtain over the whole panel.
    expect(screen.getByText('Record sharing (OWD)')).toBeInTheDocument();
    expect(screen.getByTestId('owd-internal-select')).toBeInTheDocument();
    // ⛔ The measured mechanism forbids promising recovery.
    expect(document.body.textContent ?? '').not.toMatch(/loading|try again/i);
  });
});
