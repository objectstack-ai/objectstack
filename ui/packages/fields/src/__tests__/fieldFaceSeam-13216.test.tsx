/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13216 — this package fills `@object-ui/components`' field-face
 * seam when it loads, so `page:header` draws a widget-hinted `nameField`
 * through the face the grid's cells draw it with.
 *
 * `@object-ui/components` cannot import this package (this package depends on
 * that one), so it owns the slot (`setFieldReadFaceResolver` /
 * `resolveFieldReadFace`) and this package's entry fills it. The answer is the
 * registry's own lookup, `getCellRenderer(resolveCellRendererType(field))`,
 * bounded to the keys a declared `widget` promotes to, and only once a host
 * has registered a face there: the key's default face is the stored text, the
 * text the heading already prints.
 *
 * The end-to-end pin renders the real `page:header` over a record shaped like
 * `sys_record_share` (`nameField: 'recipient_id'`, which declares
 * `widget: 'recipient-picker'` and `dependsOn: ['recipient_type']`) with a
 * host face registered under the key, as the console registers its own. The
 * console's face itself is pinned in `@object-ui/app-shell`
 * (`WidgetRefCellFaces-12613.test.tsx`); the one here stands in for it and,
 * like it, names the value only after an asynchronous read.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { resolveFieldReadFace } from '@object-ui/components';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import {
  getCellRenderer,
  registerFieldRenderer,
  resolveCellRendererType,
  TextCellRenderer,
  type CellRendererProps,
} from '../index';

/** The user directory the stand-in host face reads a `user` recipient from. */
const USERS: Record<string, string> = { usr_9f3: 'Ada Lovelace' };

/**
 * Stands in for a host's `recipient-picker` face: the stored text until its
 * label read lands, then the name the row's `recipient_type` says to read.
 */
function HostRecipientFace({ value, dependentValues }: CellRendererProps) {
  const [label, setLabel] = React.useState<string | undefined>(undefined);
  const kind = dependentValues?.recipient_type;
  React.useEffect(() => {
    let live = true;
    void Promise.resolve(kind === 'user' ? USERS[String(value)] : undefined).then((read) => {
      if (live) setLabel(read);
    });
    return () => {
      live = false;
    };
  }, [value, kind]);
  return <span data-testid="host-recipient-face">{label ?? String(value)}</span>;
}

function HostObjectRefFace({ value }: CellRendererProps) {
  return <span>object {String(value)}</span>;
}

afterEach(() => {
  cleanup();
  // Back to this package's defaults: the stored text under both keys.
  registerFieldRenderer('recipient-picker', TextCellRenderer);
  registerFieldRenderer('object-ref', TextCellRenderer);
});

const recipientField = { name: 'recipient_id', type: 'text', widget: 'recipient-picker', dependsOn: ['recipient_type'] } as any;

describe('objectui#13216 — the field-face seam answers the registry face of a widget promotion', () => {
  it("answers no face while the widget's key still draws its default face (the stored text)", () => {
    expect(getCellRenderer('recipient-picker')).toBe(TextCellRenderer);

    expect(resolveFieldReadFace(recipientField)).toBeUndefined();
  });

  it('answers the face a host registered under the key, the one the grid cell draws', () => {
    registerFieldRenderer('recipient-picker', HostRecipientFace);
    registerFieldRenderer('object-ref', HostObjectRefFace);

    expect(resolveFieldReadFace(recipientField)).toBe(HostRecipientFace);
    expect(resolveFieldReadFace(recipientField)).toBe(getCellRenderer(resolveCellRendererType(recipientField)));
    expect(resolveFieldReadFace({ name: 'object_name', type: 'text', widget: 'object-ref' } as any)).toBe(HostObjectRefFace);
  });

  it('CONTROL — answers no face for a field whose key is not a widget promotion', () => {
    registerFieldRenderer('recipient-picker', HostRecipientFace);
    registerFieldRenderer('object-ref', HostObjectRefFace);

    // No widget.
    expect(resolveFieldReadFace({ name: 'subject', type: 'text' } as any)).toBeUndefined();
    // A widget with no read face of its own draws as its type.
    expect(resolveFieldReadFace({ name: 'criteria', type: 'textarea', widget: 'filter-condition' } as any)).toBeUndefined();
    // A non-textual base type keeps its own key, so the widget does not promote.
    expect(resolveFieldReadFace({ name: 'kind', type: 'select', widget: 'object-ref' } as any)).toBeUndefined();
    // A `format` hint promotes to a richer cell, but it is not a widget's face.
    expect(resolveCellRendererType({ type: 'text', format: 'email' })).toBe('email');
    expect(resolveFieldReadFace({ name: 'contact', type: 'text', format: 'email' } as any)).toBeUndefined();
  });
});

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const recordShare = {
  name: 'sys_record_share',
  label: 'Record Share',
  nameField: 'recipient_id',
  fields: {
    recipient_type: {
      type: 'select',
      label: 'Recipient Type',
      options: [
        { value: 'user', label: 'User' },
        { value: 'group', label: 'Group' },
      ],
    },
    recipient_id: { type: 'text', label: 'Recipient', widget: 'recipient-picker', dependsOn: ['recipient_type'] },
  },
};

const share = { id: 'shr_1', recipient_type: 'user', recipient_id: 'usr_9f3' };

function renderHeader() {
  return render(
    <ActionProvider>
      <RecordContextProvider objectName="sys_record_share" recordId={share.id} data={share} objectSchema={recordShare}>
        <PageHeader schema={{ type: 'page:header' }} />
      </RecordContextProvider>
    </ActionProvider>,
  );
}

describe("objectui#13216 — the record share's H1 is the recipient's name, not the stored id", () => {
  it("THE CARD — a `recipient-picker` nameField heads with the host face's name", async () => {
    registerFieldRenderer('recipient-picker', HostRecipientFace);

    const { container } = renderHeader();

    await waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Ada Lovelace'));
    expect(container.querySelector('h1 [data-testid="host-recipient-face"]')).not.toBeNull();
  });

  it('CONTROL — with no host face under the key, the H1 is the stored text, as before', () => {
    const { container } = renderHeader();

    expect(container.querySelector('h1')?.textContent).toBe('usr_9f3');
    expect(container.querySelector('h1 [data-testid="host-recipient-face"]')).toBeNull();
  });
});
