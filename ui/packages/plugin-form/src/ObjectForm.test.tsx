import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';
import React from 'react';

// Ensure fields are registered
registerAllFields();

describe('ObjectForm Integration', () => {
    const objectSchema = {
        name: 'test_object',
        fields: {
            name: {
                type: 'text',
                label: 'Name'
            },
            price: {
                type: 'currency',
                label: 'Price',
                scale: 2
            }
        }
    };

    const mockDataSource: any = {
        getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
        getRecord: vi.fn(),
        query: vi.fn()
    };

    it('renders fields using specialized components', async () => {
        render(
            <ObjectForm 
                schema={{
                    type: 'object-form',
                    objectName: 'test_object',
                    mode: 'create'
                }}
                dataSource={mockDataSource}
            />
        );

        // Wait for schema to load (useEffect)
        await waitFor(() => {
            expect(mockDataSource.getObjectSchema).toHaveBeenCalledWith('test_object');
        });

        // Check if labels are present
        await waitFor(() => {
            expect(screen.queryByText('Name')).toBeTruthy();
        });
        expect(screen.getByText('Price')).toBeTruthy();
        
        // Assert input exists
        // Since we don't have getByLabelText working reliably without full accessibility tree in happy-dom sometimes,
        // we can try looking for inputs.
    });

    it('delegates persistence to submitHandler instead of dataSource.create', async () => {
        // When a host (e.g. MasterDetailForm batching parent+children into one
        // atomic transaction) supplies a `submitHandler`, the form must validate
        // and hand the values over WITHOUT creating/updating on its own.
        const submitHandler = vi.fn().mockResolvedValue({ id: 'p1' });
        const onSuccess = vi.fn();
        const ds: any = {
            getObjectSchema: vi.fn().mockResolvedValue({
                name: 'test_object',
                fields: { name: { type: 'text', label: 'Name' } },
            }),
            create: vi.fn(),
            update: vi.fn(),
        };

        const { container } = render(
            <ObjectForm
                schema={{
                    type: 'object-form',
                    objectName: 'test_object',
                    mode: 'create',
                    submitHandler,
                    onSuccess,
                } as any}
                dataSource={ds}
            />,
        );

        await waitFor(() => {
            expect(ds.getObjectSchema).toHaveBeenCalledWith('test_object');
        });

        const input = await waitFor(() => {
            const el = container.querySelector('input[name="name"]') as HTMLInputElement | null;
            if (!el) throw new Error('name input not yet rendered');
            return el;
        });
        fireEvent.change(input, { target: { value: 'Atomic demo' } });

        const form = container.querySelector('form') as HTMLFormElement;
        fireEvent.submit(form);

        await waitFor(() => {
            expect(submitHandler).toHaveBeenCalledTimes(1);
        });
        expect(submitHandler).toHaveBeenCalledWith(expect.objectContaining({ name: 'Atomic demo' }));
        // The form must NOT persist on its own when a submitHandler is present.
        expect(ds.create).not.toHaveBeenCalled();
        expect(ds.update).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(onSuccess).toHaveBeenCalled();
        });
    });

    it('auto-derives sections from the object fieldGroups metadata', async () => {
        // Fields opt into groups via `field.group`; the object declares the
        // groups via top-level `fieldGroups`. Even without explicit
        // schema.sections, the form must render those groups as sections.
        const ds: any = {
            getObjectSchema: vi.fn().mockResolvedValue({
                name: 'test_object',
                fieldGroups: [
                    { key: 'contact', label: 'Contact Info' },
                    { key: 'billing', label: 'Billing' },
                ],
                fields: {
                    email: { type: 'email', label: 'Email', group: 'contact' },
                    phone: { type: 'phone', label: 'Phone', group: 'contact' },
                    amount: { type: 'currency', label: 'Amount', group: 'billing' },
                    notes: { type: 'textarea', label: 'Notes' },
                },
            }),
        };

        const { container } = render(
            <ObjectForm
                schema={{
                    type: 'object-form',
                    objectName: 'test_object',
                    mode: 'create',
                } as any}
                dataSource={ds}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Contact Info')).toBeTruthy();
        });
        expect(screen.getByText('Billing')).toBeTruthy();
        // All fields still render, including the ungrouped one.
        expect(container.querySelector('input[name="email"]')).toBeTruthy();
        expect(container.querySelector('input[name="amount"]')).toBeTruthy();
        expect(container.querySelector('[name="notes"]')).toBeTruthy();
    });

    it('collapses a collapsible fieldGroup section on header click, hiding its fields', async () => {
        // A group declared `collapsible: true` renders a clickable header; toggling
        // it hides that group's fields (while a single shared form preserves their
        // values) without affecting other groups or the ungrouped bucket.
        const ds: any = {
            getObjectSchema: vi.fn().mockResolvedValue({
                name: 'test_object',
                fieldGroups: [
                    { key: 'contact', label: 'Contact Info', collapsible: true },
                    { key: 'billing', label: 'Billing' },
                ],
                fields: {
                    email: { type: 'email', label: 'Email', group: 'contact' },
                    amount: { type: 'currency', label: 'Amount', group: 'billing' },
                    notes: { type: 'textarea', label: 'Notes' },
                },
            }),
        };

        const { container } = render(
            <ObjectForm
                schema={{ type: 'object-form', objectName: 'test_object', mode: 'create' } as any}
                dataSource={ds}
            />,
        );

        await waitFor(() => {
            expect(container.querySelector('input[name="email"]')).toBeTruthy();
        });

        // Collapse the Contact Info group → its email field leaves the DOM,
        // while the other group's field and the ungrouped field stay.
        fireEvent.click(screen.getByText('Contact Info'));
        await waitFor(() => {
            expect(container.querySelector('input[name="email"]')).toBeNull();
        });
        expect(container.querySelector('input[name="amount"]')).toBeTruthy();
        expect(container.querySelector('[name="notes"]')).toBeTruthy();

        // Expand again → the field returns.
        fireEvent.click(screen.getByText('Contact Info'));
        await waitFor(() => {
            expect(container.querySelector('input[name="email"]')).toBeTruthy();
        });
    });

    it('stays flat when the object declares no fieldGroups', async () => {
        const ds: any = {
            getObjectSchema: vi.fn().mockResolvedValue({
                name: 'test_object',
                fields: {
                    name: { type: 'text', label: 'Name' },
                    email: { type: 'email', label: 'Email' },
                },
            }),
        };

        render(
            <ObjectForm
                schema={{ type: 'object-form', objectName: 'test_object', mode: 'create' } as any}
                dataSource={ds}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Name')).toBeTruthy();
        });
        // No section headers should appear for a flat form.
        expect(screen.queryByText('Contact Info')).toBeNull();
    });

    it('strips computed and server-managed fields from the edit-mode update payload', async () => {
        // Repro of the showcase_project "Unknown field 'budget_remaining'" bug:
        // an edit form is seeded from a full record read that includes computed
        // columns (formula/summary) the form never renders — they live in the
        // form's `sections` allow-list nowhere, yet react-hook-form retains the
        // seeded defaultValues and round-trips them on submit. The backend then
        // rejects those non-writable fields. ObjectForm must sanitize them out.
        const schema = {
            name: 'test_project',
            fields: {
                name: { type: 'text', label: 'Name' },
                budget: { type: 'currency', label: 'Budget', scale: 2 },
                // Computed — server-managed, never writable.
                budget_remaining: { type: 'formula', label: 'Budget Remaining' },
                task_count: { type: 'summary', label: 'Tasks' },
            },
        };
        const record = {
            id: 'p1',
            name: 'Website',
            budget: 150000,
            // Present in the read (and thus the form defaultValues) but NOT in
            // any rendered section — the exact leak path.
            budget_remaining: 90000,
            task_count: 5,
            created_at: '2020-01-01T00:00:00Z',
        };
        const ds: any = {
            getObjectSchema: vi.fn().mockResolvedValue(schema),
            findOne: vi.fn().mockResolvedValue(record),
            update: vi.fn().mockResolvedValue({ ...record }),
            create: vi.fn(),
        };

        const { container } = render(
            <ObjectForm
                schema={{
                    type: 'object-form',
                    objectName: 'test_project',
                    mode: 'edit',
                    recordId: 'p1',
                    // Curated form view: only the writable fields are laid out.
                    sections: [{ name: 'main', label: 'Main', fields: ['name', 'budget'] }],
                } as any}
                dataSource={ds}
            />,
        );

        // Wait for the record read to seed the form.
        await waitFor(() => {
            const el = container.querySelector('input[name="name"]') as HTMLInputElement | null;
            if (!el || el.value !== 'Website') throw new Error('form not seeded yet');
            return el;
        });

        // Submitted with NOTHING changed, on purpose. An edit writes only the
        // fields that differ from the record it read (objectui#10156), so after
        // a real edit an unchanged computed column is kept off the wire by the
        // dirty diff alone and this row could no longer fail for the sanitizer.
        // A save with nothing changed sends the full sanitized payload — the
        // one edit route where the sanitizer is the only filter between these
        // round-tripped columns and the server.
        const form = container.querySelector('form') as HTMLFormElement;
        fireEvent.submit(form);

        await waitFor(() => {
            expect(ds.update).toHaveBeenCalledTimes(1);
        });
        const [obj, id, payload] = ds.update.mock.calls[0];
        expect(obj).toBe('test_project');
        expect(id).toBe('p1');
        // The writable fields are sent...
        expect(payload).toMatchObject({ name: 'Website', budget: 150000 });
        // ...but the computed and server-managed keys are stripped.
        expect(payload).not.toHaveProperty('budget_remaining');
        expect(payload).not.toHaveProperty('task_count');
        expect(payload).not.toHaveProperty('id');
        expect(payload).not.toHaveProperty('created_at');
    });

    it('renders as a master-detail form when schema.subforms is set', async () => {
        // A plain object form becomes master-detail by config (no bespoke page):
        // parent fields on top + an editable child grid + a single Save action.
        const ds: any = {
            getObjectSchema: vi.fn().mockResolvedValue({
                name: 'test_object',
                fields: { name: { type: 'text', label: 'Name' } },
            }),
            batchTransaction: vi.fn(),
        };

        render(
            <ObjectForm
                schema={{
                    type: 'object-form',
                    objectName: 'test_object',
                    mode: 'create',
                    subforms: [
                        { childObject: 'test_line', relationshipField: 'parent', title: 'Lines',
                          columns: [{ name: 'qty', type: 'number' }] },
                    ],
                } as any}
                dataSource={ds}
            />,
        );

        // MasterDetailForm renders its single action bar (md-form-submit) and the
        // child section title — proof we delegated to the master-detail form.
        await waitFor(() => {
            expect(screen.getByTestId('md-form-submit')).toBeTruthy();
        });
        expect(screen.getByText('Lines')).toBeTruthy();
    });
});
