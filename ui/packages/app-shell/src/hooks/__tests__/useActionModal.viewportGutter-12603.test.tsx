/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The action modal's bounded wide sizes keep the shared viewport gutter
 * (objectui#12603).
 *
 * A `type: 'modal'` action with a page target and no size opens at `xl`
 * (`resolveModalTarget`), the centred dialog's `sm:max-w-5xl`. Before
 * objectui#12603 that dialog ran edge to edge in every window between `sm`
 * and 1024px. `lg` and `xl` now also read `DIALOG_VIEWPORT_GUTTER`, so the
 * dialog keeps 1rem either side from `sm` up and is as wide as before above
 * its max width plus 2rem.
 *
 * CONTROLs: `full` keeps its own `95vw` and reads no gutter; `default` never
 * reaches the edge at or above `sm` and reads none either; a `side` placement
 * is a sheet, edge-anchored by design, and is unchanged.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DIALOG_VIEWPORT_GUTTER } from '@object-ui/components';
import { useActionModal } from '../useActionModal';

afterEach(cleanup);

type Handler = (schema: unknown) => Promise<unknown>;

function Harness({ onReady }: { onReady: (h: Handler) => void }) {
  const { modalHandler, modalElement } = useActionModal();
  React.useEffect(() => onReady(modalHandler), [onReady, modalHandler]);
  return <>{modalElement}</>;
}

async function open(descriptor: Record<string, unknown>): Promise<string[]> {
  let handler: Handler | null = null;
  render(<Harness onReady={(h) => { handler = h; }} />);
  await act(async () => {
    void handler!({ title: 'Quick view', content: { type: 'box' }, ...descriptor });
  });
  const surface = screen.getByRole('dialog');
  return (surface.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

describe('useActionModal: the wide sizes keep the shared viewport gutter (objectui#12603)', () => {
  it('xl, the size a page target with no size opens at, reads the gutter beside its cap', async () => {
    const classes = await open({ size: 'xl' });
    expect(classes).toContain('sm:max-w-5xl');
    expect(classes).toContain(DIALOG_VIEWPORT_GUTTER);
  });

  it('lg reads the same gutter', async () => {
    const classes = await open({ size: 'lg' });
    expect(classes).toContain('sm:max-w-2xl');
    expect(classes).toContain(DIALOG_VIEWPORT_GUTTER);
  });

  it('CONTROL: full keeps its own 95vw and default reads no gutter', async () => {
    const full = await open({ size: 'full' });
    expect(full).toContain('sm:max-w-[95vw]');
    expect(full).toContain('sm:w-full');
    expect(full).not.toContain(DIALOG_VIEWPORT_GUTTER);
    cleanup();
    const plain = await open({});
    expect(plain).not.toContain(DIALOG_VIEWPORT_GUTTER);
  });

  it('CONTROL: a side placement is a sheet and reads no gutter', async () => {
    const classes = await open({ size: 'xl', placement: 'side' });
    expect(classes).toContain('sm:max-w-3xl');
    expect(classes).not.toContain(DIALOG_VIEWPORT_GUTTER);
  });
});
