// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6795 part C, site 3 — the actions detail pane must not read as
 * "this action has no properties".
 *
 * With `getMetadataDefaultInspector('action')` undefined the pane rendered the
 * action's own label and nothing else ("Send Email"), which looks like a
 * finished answer rather than a missing editor. The repair keeps the label (it
 * says WHICH action is selected) and adds the reason there is no form under it.
 *
 * ⛔ The message must not promise recovery. When this pin was written that read
 * was a plain `Map` lookup during render with no subscription, and the card
 * measured that a registration landing later never reached the component
 * (`late inspector rendered: false`). objectui#11939 made the read observable,
 * so a late registration now does replace the pane (pinned in
 * `ObjectPanels.lateRegistration-11939.test.tsx`); "Loading…" / "try again"
 * would still promise something nothing here knows is coming.
 *
 * ⚠️ Sibling panels in this pillar are deliberately NOT pinned here, because the
 * measurement found them already correct and the ruling put them out of scope:
 * `ObjectSettingsPanel` already prints "No default object inspector
 * registered.", and `ObjectHooksPanel` already falls back to a working generic
 * `SchemaForm`. Both were "silently empty" on the card and neither is.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { ObjectActionsPanel } from './ObjectActionsPanel';
import { getMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { getStudioCanvasPreview } from './studio-canvas-preview';

const draft = {
  name: 'showcase_task',
  label: 'Task',
  actions: [{ name: 'send_email', label: 'Send Email', type: 'quick' }],
};

afterEach(cleanup);

describe('ObjectActionsPanel — no action editor registered (#6795 C, site 3)', () => {
  it('names the missing editor beside the action label', async () => {
    // CONTROL — `studio-canvas-preview` self-registers `object` at module scope,
    // so this MUST hit. It proves the module graph loaded and the lookup works;
    // only then is the `undefined` below a reading rather than a failed import.
    expect(getStudioCanvasPreview('object')).toBeTypeOf('function');
    expect(getMetadataDefaultInspector('action')).toBeUndefined();

    render(<ObjectActionsPanel draft={draft as Record<string, unknown>} onPatch={() => {}} />);

    // The label survives — it is the only thing identifying the selection.
    expect(await screen.findAllByText('Send Email')).not.toHaveLength(0);
    // ...and no longer stands alone, which is what read as "no properties".
    await screen.findByText(
      'No action editor is registered in this session, so this action’s properties cannot be edited here.',
    );
    expect(document.body.textContent ?? '').not.toMatch(/loading|try again/i);
  });
});
