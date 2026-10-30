// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flow inspector's help lines (#27356 row 15).
 *
 *   1. A schema description on an objectList column is the column's help, shown
 *      under the column, and never its placeholder: a paragraph squeezed into
 *      an input's placeholder reads as a cut-off example value and vanishes on
 *      the first keystroke.
 *   2. Help longer than `FLOW_HELP_CLAMP_CHARS` opens clamped to two lines with a
 *      "Learn more" toggle; shorter help renders in full with no toggle. The
 *      full text is in the DOM either way.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { z } from 'zod';
import { ApprovalNodeConfigSchema } from '@objectstack/spec/automation';
import { FlowObjectListField } from './FlowObjectListField';
import { FlowNodeConfigField } from './FlowNodeConfigField';
import { FLOW_HELP_CLAMP_CHARS } from './FlowFieldHelp';
import { jsonSchemaToFlowFields } from './json-schema-to-fields';
import type { FlowConfigField } from './flow-node-config';

afterEach(cleanup);

// The approval node's fields as the engine publishes them: the installed
// contract's own JSON Schema, not a copy of it.
const schema = z.toJSONSchema(ApprovalNodeConfigSchema, { io: 'input' });
const served = jsonSchemaToFlowFields(schema)!;
const approvers = served.find((f) => f.id === 'approvers')!;
const orgCol = approvers.columns!.find((c) => c.key === 'organization')!;
const orgDescription = (
  schema as unknown as {
    properties: { approvers: { items: { properties: { organization: { description: string } } } } };
  }
).properties.approvers.items.properties.organization.description;

describe('objectList column descriptions are help, not placeholders (#27356 row 15)', () => {
  it('maps the served approver `organization` description to the column help', () => {
    expect(orgDescription.length).toBeGreaterThan(0);
    expect(orgCol.help).toBe(orgDescription);
    expect(orgCol.placeholder).toBeUndefined();
  });

  it('renders the description under the column, with no input carrying it as a placeholder', () => {
    const { container } = render(
      <FlowObjectListField
        label="Approvers"
        columns={approvers.columns!}
        value={[{ type: 'manager' }]}
        onCommit={vi.fn()}
        addLabel="Add"
        removeLabel="Remove"
        emptyLabel="None"
      />,
    );
    const placeholders = Array.from(container.querySelectorAll('[placeholder]')).map((el) => el.getAttribute('placeholder'));
    expect(placeholders).not.toContain(orgDescription);
    const helps = screen.getAllByTestId('flow-field-help').map((el) => el.querySelector('p')?.textContent);
    expect(helps).toContain(orgDescription);
  });
});

const field = (help: string): FlowConfigField => ({
  id: 'excludeSubmitter',
  path: ['config', 'excludeSubmitter'],
  label: 'Exclude submitter',
  kind: 'boolean',
  help,
});

describe('long help opens clamped behind "Learn more" (#27356 row 15)', () => {
  it('clamps a long help and toggles it open and closed', () => {
    const long = 'Segregation of duties for this step. '.repeat(5).trim();
    expect(long.length).toBeGreaterThan(FLOW_HELP_CLAMP_CHARS);
    render(<FlowNodeConfigField field={field(long)} value={undefined} onCommit={() => {}} />);
    const help = screen.getByTestId('flow-field-help');
    const text = help.querySelector('p')!;
    expect(text.textContent).toBe(long);
    expect(text.className).toContain('line-clamp-2');
    const toggle = within(help).getByRole('button', { name: 'Learn more' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(text.id);

    fireEvent.click(toggle);
    expect(text.className).not.toContain('line-clamp-2');
    const less = within(help).getByRole('button', { name: 'Show less' });
    expect(less.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(less);
    expect(text.className).toContain('line-clamp-2');
  });

  it('renders a short help in full, with no toggle', () => {
    render(<FlowNodeConfigField field={field('Lock the record while pending.')} value={undefined} onCommit={() => {}} />);
    const help = screen.getByTestId('flow-field-help');
    expect(help.querySelector('p')!.className).not.toContain('line-clamp-2');
    expect(within(help).queryByRole('button')).toBeNull();
  });
});
