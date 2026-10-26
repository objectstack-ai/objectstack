// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * InspectorComboField — a searchable single-select for scoped inspectors that
 * still lets the author type a value not in the list.
 *
 * Mainstream low-code dataset designers let you *pick* an object / relationship
 * / field from the live schema instead of recalling its API name. This combo
 * renders that picker (grouped, searchable) over a catalog the caller supplies,
 * while keeping the power-user escape hatch: when the typed text matches no
 * option, a "Use «text»" row commits the raw value verbatim (so an offline
 * catalog, a computed path, or a server-only field is never a dead end).
 *
 * Self-filters (`shouldFilter={false}`) for predictable label+value matching.
 *
 * ## Naming (objectui#3997)
 *
 * The trigger is a `button[role=combobox]` rendered by `PopoverTrigger asChild`,
 * so it is a labelable element — but visual adjacency to a `<Label>` is NOT an
 * association. Before this fix the labelled branch rendered the `<Label>` as a
 * bare sibling (no `htmlFor`, no id, no `aria-label`), so assistive tech read an
 * anonymous "combobox" with the field name floating above it as unowned text,
 * `getByLabelText` could not reach it, and clicking the visible label did
 * nothing — the same defect PR #3996 closed for the three `_shared.tsx` atoms.
 * The un-labelled branch was one notch worse: the combobox was wholly anonymous.
 *
 * Naming is therefore a TYPE-LEVEL requirement (see {@link InspectorComboFieldNaming}):
 * exactly one of `label` / `ariaLabel` / `id` must be given, so an anonymous
 * combo cannot be authored — it fails `tsc`, not a review. One channel only,
 * never two: a control carrying both an associated `<Label>` and an `aria-label`
 * is the double-announcement failure objectui#3961/#3978 exists to avoid.
 */

import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import {
  cn,
  Button,
  Label,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@object-ui/components';
import { t, useMetadataLocale } from '../i18n.js';

export interface InspectorComboOption {
  value: string;
  label: string;
  /** Small muted suffix, e.g. a field type. */
  hint?: string;
  /** Optional group heading; options sharing a group render together. */
  group?: string;
}

/**
 * Where this combo's accessible name comes from — exactly one of three, never
 * zero and never two. Pick the variant that matches where the name already lives:
 *
 * • `label`     — this atom renders the visible `<Label>` and owns the pair
 *                 (`htmlFor` ⇄ a `React.useId()`-minted trigger id). The default
 *                 choice, and the only one that needs no caller bookkeeping.
 * • `ariaLabel` — there is no visible label to associate: repeated rows whose
 *                 column is obvious from context (an object filter's `field =
 *                 value` pair, a dataset's list of joined relationships) and
 *                 "add another" pickers sitting under a group heading. The
 *                 trigger carries the name itself.
 * • `id`        — an EXTERNAL `<Label htmlFor={…}>` already owns the naming (the
 *                 `Field` wrapper in `DashboardWidgetInspector` is the live
 *                 case). The caller's id lands on the trigger so that `for`
 *                 RESOLVES; without this prop the caller's `for` pointed at an
 *                 id nothing carried, which is a dangling IDREF — strictly worse
 *                 than no label, because the tooling reports an association that
 *                 does not exist.
 *
 * `label` mints its id internally rather than accepting one because these combos
 * render in loops over array items (`lookupFilters[i]`, `dimensions[i]`), where a
 * caller-supplied id is exactly what collides: two rows sharing a label would
 * share an id and both labels would silently resolve to the FIRST trigger.
 * `useId()` cannot be authored into a collision. The `id` variant re-opens that
 * door by necessity — the caller must already own the id to have written the
 * `for` — so reach for it only when an external label is genuinely in charge.
 *
 * ## Words (objectui#10586)
 *
 * The combo's own words — the trigger's placeholder and loading text, the
 * search box, the empty state and the "Use «text»" row — read in the designer's
 * active locale through `useMetadataLocale()`, as {@link InspectorSelectField}'s
 * default flag does. A caller that passes its own `placeholder`,
 * `searchPlaceholder` or `emptyText` keeps it.
 *
 * ## Label first, machine name second (objectui#12303)
 *
 * An option with a label of its own reads as that label, with its value — the
 * machine name the draft stores — after it as secondary text: smaller,
 * monospace and muted. The trigger shows a chosen option by its label, in the
 * body font; the caller's `mono` styles a raw value only. That is the Studio
 * object header's form, and the maintainer's ruling on objectui#11862 that the
 * label leads everywhere and the machine name is secondary (quoted verbatim on
 * `StudioNameLabel` in `StudioDesignSurface.tsx`). The list used to lead with
 * the value in the body font and trail the label muted, so a field picker read
 * as a column of truncated api names. An option whose label IS its value (or
 * which has none) shows the value alone, in monospace, as before.
 */
export type InspectorComboFieldNaming =
  | { label: string; ariaLabel?: never; id?: never }
  | { label?: never; ariaLabel: string; id?: never }
  | { label?: never; ariaLabel?: never; id: string };

export type InspectorComboFieldProps = InspectorComboFieldNaming & {
  value: string;
  onCommit: (v: string) => void;
  options: InspectorComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Allow committing a typed value that matches no option (default true). */
  allowCustom?: boolean;
  /** Render the trigger value in a monospace font. */
  mono?: boolean;
  /** Override the trigger label for the currently-selected custom value. */
  className?: string;
};

function matches(option: InspectorComboOption, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    option.value.toLowerCase().includes(needle) ||
    option.label.toLowerCase().includes(needle) ||
    (option.group?.toLowerCase().includes(needle) ?? false)
  );
}

export function InspectorComboField({
  label,
  ariaLabel,
  id,
  value,
  onCommit,
  options,
  placeholder: placeholderProp,
  searchPlaceholder: searchPlaceholderProp,
  emptyText: emptyTextProp,
  disabled,
  loading,
  allowCustom = true,
  mono,
  className,
}: InspectorComboFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const locale = useMetadataLocale();
  const placeholder = placeholderProp ?? t('engine.form.selectEllipsis', locale);
  const searchPlaceholder = searchPlaceholderProp ?? t('engine.inspector.combo.search', locale);
  const emptyText = emptyTextProp ?? t('engine.inspector.combo.noMatch', locale);

  // The id goes on the trigger `Button`, never on `Popover`: Radix's
  // `Popover.Root` is a context provider that renders no DOM element of its own,
  // so an id (or any aria-*) handed to it is silently DROPPED and the label's
  // `for` resolves to nothing — the failure objectui#3976 (PR #3992) and #3994
  // (PR #3996) each paid for once. `PopoverTrigger asChild` merges its props
  // onto the `Button` below, which renders the real `button[role=combobox]`.
  //
  // It is minted only when something points AT it: the `<Label>` this atom
  // renders (`autoId`), or the caller's external label (`id`). In the
  // `ariaLabel` variant nothing references an id, so none is emitted — an
  // unreferenced id would be noise, and the naming channel stays exactly one.
  const autoId = React.useId();
  const triggerId = label ? autoId : id;

  const selected = options.find((o) => o.value === value);
  const triggerText = selected ? selected.label : value || (loading ? t('engine.inspector.combo.loading', locale) : placeholder);
  // A chosen option with a label of its own shows that label in the body
  // font; only a raw value takes the caller's `mono` (objectui#12303).
  const selectedLabelled = !!selected && !!selected.label && selected.label !== selected.value;

  const filtered = React.useMemo(() => options.filter((o) => matches(o, search)), [options, search]);
  const groups = React.useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, InspectorComboOption[]>();
    for (const o of filtered) {
      const g = o.group ?? '';
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push(o);
    }
    return order.map((g) => ({ heading: g, items: byGroup.get(g)! }));
  }, [filtered]);

  const trimmed = search.trim();
  const showCustom =
    allowCustom && !!trimmed && !options.some((o) => o.value === trimmed);
  // The custom row's sentence is the locale's; the typed text is a slot in it.
  const [customLead, customTail = ''] = t('engine.inspector.combo.useCustom', locale).split('{value}');

  const commit = (v: string) => {
    onCommit(v);
    setOpen(false);
    setSearch('');
  };

  const field = (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          id={triggerId}
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-8 w-full justify-between px-2 text-sm font-normal', className)}
        >
          <span className={cn('truncate', mono && !selectedLabelled && 'font-mono', !selected && !value && 'text-muted-foreground')}>
            {triggerText}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[14rem] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={searchPlaceholder} />
          <CommandList>
            {!showCustom && filtered.length === 0 && <CommandEmpty>{emptyText}</CommandEmpty>}
            {showCustom && (
              <CommandGroup>
                <CommandItem value={`__custom__${trimmed}`} onSelect={() => commit(trimmed)}>
                  <span className="truncate">
                    {customLead}<span className="font-mono">“{trimmed}”</span>{customTail}
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map((g, gi) => (
              <CommandGroup key={g.heading || `g${gi}`} heading={g.heading || undefined}>
                {g.items.map((o) => (
                  <CommandItem key={o.value} value={o.value} onSelect={() => commit(o.value)}>
                    <Check className={cn('h-3.5 w-3.5', o.value === value ? 'opacity-100' : 'opacity-0')} />
                    {o.label && o.label !== o.value ? (
                      <>
                        <span className="truncate">{o.label}</span>{' '}
                        <span className="ml-1 truncate font-mono text-[10px] text-muted-foreground">{o.value}</span>
                      </>
                    ) : (
                      <span className="truncate font-mono">{o.value}</span>
                    )}
                    {o.hint && <span className="ml-auto pl-2 text-[10px] text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  // No visible label to render: the name is already on the trigger (`ariaLabel`)
  // or owned by an external `<Label htmlFor={id}>` that now resolves to it.
  if (!label) return field;
  return (
    <div className="space-y-1">
      <Label htmlFor={autoId} className="text-xs text-muted-foreground">{label}</Label>
      {field}
    </div>
  );
}
