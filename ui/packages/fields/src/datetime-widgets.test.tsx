import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { DateField } from './widgets/DateField';
import { DateTimeField } from './widgets/DateTimeField';
import { TimeField } from './widgets/TimeField';
import type { FieldWidgetComponentProps } from './widgets/types';

const mockField = {
  name: 'test_field',
  label: 'Test Field',
  type: 'date',
} as any;

const baseProps: FieldWidgetComponentProps<string> = {
  field: mockField,
  value: '',
  onChange: vi.fn(),
  readonly: false,
};

describe('Date/Time Widgets', () => {
    describe('DateField', () => {
        it('renders date input in edit mode', () => {
            const { container } = render(<DateField {...baseProps} />);
            const dateInput = container.querySelector('input[type="date"]');
            expect(dateInput).toBeInTheDocument();
        });

        it('calls onChange when value changes', () => {
            const { container } = render(<DateField {...baseProps} />);
            const input = container.querySelector('input[type="date"]') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '2023-01-01' } });
            expect(baseProps.onChange).toHaveBeenCalledWith('2023-01-01');
        });

        it('renders formatted date in readonly mode', () => {
            render(<DateField {...baseProps} readonly value="2023-01-01" />);
            // Since objectui#8194 the readonly face is `formatDate`'s default
            // style, not `Intl`'s bare numeric default: `Jan 1, 2023`, not
            // `1/1/2023`. `2023-01-01` is a PAST year, so the year is still
            // carried — the year only drops inside the CURRENT year, which is
            // what `fields-date-widget-convention-8194.test.tsx` pins.
            // No provider is mounted here, so the widget resolves the `'en'`
            // last-resort tag; the expectation is built from that same tag.
            const date = new Date('2023-01-01');
            expect(
                screen.getByText(
                    date.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }),
                ),
            ).toBeInTheDocument();
            expect(document.querySelector('input')).not.toBeInTheDocument();
        });

        it('renders dash for empty readonly value', () => {
            render(<DateField {...baseProps} readonly value={''} />);
            expect(screen.getByText('—')).toBeInTheDocument();
        });
    });

    describe('DateTimeField', () => {
        it('renders datetime-local input in edit mode', () => {
            const { container } = render(<DateTimeField {...baseProps} />);
            const input = container.querySelector('input[type="datetime-local"]');
            expect(input).toBeInTheDocument();
        });

        it('calls onChange when value changes', () => {
            const onChange = vi.fn();
            const { container } = render(<DateTimeField {...baseProps} onChange={onChange} />);
            const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '2023-01-01T12:00' } });
            // The control speaks zone-less local wall clock; form state holds
            // ISO, the shape the API hands back and `toDateTimeInputValue`
            // reads (objectui#3127). Storing the naive string instead would put
            // read and write on different timezone bases.
            expect(onChange).toHaveBeenCalledWith(new Date('2023-01-01T12:00').toISOString());
        });

        it('renders formatted datetime in readonly mode', () => {
            const val = '2023-01-01T12:00:00.000Z';
            render(<DateTimeField {...baseProps} readonly value={val} />);
            // Since objectui#8209 the readonly face is `formatDateTime`'s
            // DEFAULT (verbose) style — the form / detail register — not a
            // `toLocaleDateString` + `toLocaleTimeString` pair with no options
            // bag: `Jan 1, 2023, 12:00 PM` rather than `1/1/2023 12:00:00 PM`.
            // The grid-cell register took `'compact'` instead; both faces are
            // pinned in `datetime-widget-faces-8209.test.tsx`.
            // No provider is mounted here, so the widget resolves the `'en'`
            // last-resort tag; the expectation is built from that same tag, as
            // the `DateField` case above does.
            const date = new Date(val);
            expect(
                screen.getByText(
                    date.toLocaleDateString('en', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                    }),
                ),
            ).toBeInTheDocument();
        });
    });

    /**
     * objectui#3127 — the record's stored ISO value reached the native control
     * verbatim, and `<input type="date">` / `<input type="datetime-local">`
     * reject anything but their one exact shape SILENTLY: the attribute lands
     * in the DOM, `.value` reads back `''`, and the user sees an empty box on a
     * field that has a value. `.value` (not `getAttribute('value')`) is
     * therefore the only assertion that can see this bug at all.
     */
    describe('existing values round-trip through the native controls (#3127)', () => {
        // The seeded showcase value. Whole minutes and no sub-second part, so
        // the control (which has minute resolution) can represent it exactly
        // and the round trip below is lossless in every timezone.
        const storedIso = '2026-06-17T14:30:00.000Z';

        it('DateTimeField shows a stored ISO instant instead of an empty box', () => {
            const { container } = render(<DateTimeField {...baseProps} value={storedIso} />);
            const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;

            expect(input.value).not.toBe('');
            expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
            // The shown wall clock denotes the SAME instant as the record —
            // asserted this way so the test holds in every timezone, which a
            // hardcoded "2026-06-17T22:30" would not.
            expect(new Date(input.value).getTime()).toBe(new Date(storedIso).getTime());
        });

        it('DateTimeField writes back on the same basis it reads', () => {
            // Read and write must share one timezone basis. Displaying local
            // while storing the naive local string is the worse bug: the value
            // would silently drift by the viewer's offset on every edit.
            const onChange = vi.fn();
            const { container } = render(
                <DateTimeField {...baseProps} onChange={onChange} value={storedIso} />
            );
            const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;

            fireEvent.change(input, { target: { value: '2026-06-18T09:15' } });

            const written = onChange.mock.calls[0][0];
            // Zone-QUALIFIED, which the control's own output is not. Storing
            // the raw `2026-06-18T09:15` is what puts the write on a different
            // basis from the read: the server has no way to know whose 09:15
            // it is, and resolves it to a different instant than the one the
            // user picked.
            expect(written).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
            expect(new Date(written).getTime()).toBe(new Date('2026-06-18T09:15').getTime());
        });

        it('DateTimeField returning to the shown minute restores the exact stored value', () => {
            // Guards the drift this fix could otherwise introduce: if the two
            // conversions disagreed by the viewer's UTC offset, navigating away
            // from a value and back would land somewhere else, and every open →
            // fiddle → undo would quietly move the record.
            // Held in real state, because a `vi.fn()` onChange would leave the
            // control pinned to its initial prop and React would swallow the
            // second edit as a no-op — the test would pass without exercising
            // anything.
            const seen: string[] = [];
            const Host = () => {
                const [v, setV] = React.useState<string>(storedIso);
                seen.push(v);
                return <DateTimeField {...baseProps} value={v} onChange={setV as any} />;
            };
            const { container } = render(<Host />);
            const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
            const shown = input.value;

            fireEvent.change(input, { target: { value: '2026-06-18T09:15' } });
            fireEvent.change(input, { target: { value: shown } });

            expect(seen[seen.length - 1]).toBe(storedIso);
        });

        it('DateField shows the stored calendar day, ISO-shaped or not', () => {
            // Both spellings the API may hand back for a `date` field. The day
            // must survive verbatim — re-parsing the bare form as UTC midnight
            // would move it to the 16th west of Greenwich.
            for (const stored of ['2026-06-17', '2026-06-17T00:00:00.000Z']) {
                const { container, unmount } = render(<DateField {...baseProps} value={stored} />);
                const input = container.querySelector('input[type="date"]') as HTMLInputElement;
                expect(input.value).toBe('2026-06-17');
                unmount();
            }
        });
    });

    describe('TimeField', () => {
        it('renders time input in edit mode', () => {
            const { container } = render(<TimeField {...baseProps} />);
            const input = container.querySelector('input[type="time"]');
            expect(input).toBeInTheDocument();
        });

        it('calls onChange when value changes', () => {
            const { container } = render(<TimeField {...baseProps} />);
            const input = container.querySelector('input[type="time"]') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '14:30' } });
            expect(baseProps.onChange).toHaveBeenCalledWith('14:30');
        });

        it('renders value directly in readonly mode', () => {
            render(<TimeField {...baseProps} readonly value="14:30" />);
            expect(screen.getByText('14:30')).toBeInTheDocument();
        });
    });
});
