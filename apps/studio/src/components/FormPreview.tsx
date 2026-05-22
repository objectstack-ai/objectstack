// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FormPreview — read-only renderer of a FormView spec.
 *
 * The "real" form runtime lives in apps/console (FormPage) and ObjectUI
 * (`@object-ui/plugin-form` ObjectForm). Studio doesn't ship those
 * dependencies so we render a faithful, lightweight preview from the
 * spec directly: sections/groups → cards with input controls keyed by
 * field type. There is no submission and no live data binding — this is
 * a "what will the user see?" affordance for form authors.
 *
 * Supported field types map to native inputs:
 *   - text / string                  → <Input>
 *   - textarea / longtext / richtext → <Textarea>
 *   - email / phone / url            → <Input type=…>
 *   - number / integer / decimal     → <Input type="number">
 *   - boolean / checkbox             → <Checkbox>
 *   - select / picklist / enum       → <Select> built from `options`
 *   - date / datetime / time         → <Input type=…>
 *   - reference / lookup             → <Input> disabled with hint
 *   - anything else                  → <Input> with type=text
 *
 * Unknown / advanced types still render so the author can confirm the
 * spec parses; advanced widgets (rich text, signature, file upload) are
 * announced as a "Renders {type} field in production" hint.
 */

import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Eye } from 'lucide-react';

/** Minimal shape we read from a FormView spec. */
interface FormSpec {
  type?: 'simple' | 'tabbed' | 'wizard' | string;
  label?: string;
  description?: string;
  sections?: FormSection[];
  groups?: FormSection[];
  fields?: FormField[];
  submitLabel?: string;
}

interface FormSection {
  name?: string;
  label?: string;
  title?: string;
  description?: string;
  fields?: FormField[];
  columns?: number;
}

interface FormField {
  name?: string;
  field?: string;
  label?: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  description?: string;
  defaultValue?: unknown;
  options?: Array<{ value: string; label?: string } | string>;
  multiline?: boolean;
  rows?: number;
}

interface ObjectFieldDef {
  type?: string;
  label?: string;
  required?: boolean;
  options?: Array<{ value: string; label?: string } | string>;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
}

interface ObjectSchemaLike {
  fields?: Record<string, ObjectFieldDef> | ObjectFieldDef[];
}

interface FormPreviewProps {
  /** Form spec (the view's `spec` field, or the view itself if flat). */
  spec: FormSpec | null | undefined;
  /** Optional object schema (resolves field type/label/options when the form omits them). */
  objectSchema?: ObjectSchemaLike | null;
  /** Show the "preview only" badge in the header. Defaults to true. */
  showBadge?: boolean;
}

function normalizeOptions(opts: FormField['options'] | undefined): Array<{ value: string; label: string }> {
  if (!opts) return [];
  return opts.map((o) => {
    if (typeof o === 'string') return { value: o, label: o };
    return { value: String(o.value), label: o.label ?? String(o.value) };
  });
}

function fieldDefFrom(
  field: FormField,
  objectSchema: ObjectSchemaLike | null | undefined,
): ObjectFieldDef {
  const fields = objectSchema?.fields;
  const key = field.field ?? field.name ?? '';
  if (!fields || !key) return {};
  if (Array.isArray(fields)) {
    return (fields as any[]).find((f) => f?.name === key) ?? {};
  }
  return (fields as Record<string, ObjectFieldDef>)[key] ?? {};
}

function FieldControl({ field, def }: { field: FormField; def: ObjectFieldDef }) {
  const key = field.field ?? field.name ?? 'field';
  const label = field.label ?? def.label ?? key;
  const type = (field.type ?? def.type ?? 'text').toLowerCase();
  const required = field.required ?? def.required ?? false;
  const placeholder = field.placeholder ?? def.placeholder ?? '';
  const hint = field.helpText ?? field.description ?? def.helpText ?? '';
  const options = normalizeOptions(field.options ?? def.options);

  let control: React.ReactNode;

  if (type === 'textarea' || type === 'longtext' || type === 'richtext' || field.multiline) {
    control = <Textarea rows={field.rows ?? 4} placeholder={placeholder} disabled />;
  } else if (type === 'boolean' || type === 'checkbox') {
    return (
      <div className="flex items-start gap-2">
        <Checkbox id={`fp-${key}`} disabled />
        <div className="flex-1 space-y-1">
          <Label htmlFor={`fp-${key}`} className="text-sm font-medium leading-none">
            {label}
            {required && <span className="ml-1 text-destructive">*</span>}
          </Label>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
    );
  } else if (type === 'select' || type === 'picklist' || type === 'enum' || (options.length && !type.startsWith('multi'))) {
    control = (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder={placeholder || 'Select…'} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (type === 'number' || type === 'integer' || type === 'decimal' || type === 'currency') {
    control = <Input type="number" placeholder={placeholder} disabled />;
  } else if (type === 'email') {
    control = <Input type="email" placeholder={placeholder || 'name@example.com'} disabled />;
  } else if (type === 'phone' || type === 'tel') {
    control = <Input type="tel" placeholder={placeholder} disabled />;
  } else if (type === 'url') {
    control = <Input type="url" placeholder={placeholder || 'https://'} disabled />;
  } else if (type === 'date') {
    control = <Input type="date" disabled />;
  } else if (type === 'datetime') {
    control = <Input type="datetime-local" disabled />;
  } else if (type === 'time') {
    control = <Input type="time" disabled />;
  } else if (type === 'reference' || type === 'lookup') {
    control = <Input placeholder={`Lookup → ${type}`} disabled />;
  } else if (type === 'file' || type === 'attachment') {
    control = <Input type="file" disabled />;
  } else {
    control = <Input type="text" placeholder={placeholder} disabled />;
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {control}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionBody({
  section,
  objectSchema,
}: {
  section: FormSection;
  objectSchema?: ObjectSchemaLike | null;
}) {
  const cols = section.columns && section.columns > 1 ? section.columns : 1;
  const fields = section.fields ?? [];
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {fields.map((f, i) => (
        <FieldControl
          key={(f.name ?? f.field ?? 'f') + i}
          field={f}
          def={fieldDefFrom(f, objectSchema)}
        />
      ))}
    </div>
  );
}

export function FormPreview({ spec, objectSchema, showBadge = true }: FormPreviewProps) {
  const sections = useMemo<FormSection[]>(() => {
    if (!spec) return [];
    if (Array.isArray(spec.sections) && spec.sections.length) return spec.sections;
    if (Array.isArray(spec.groups) && spec.groups.length) return spec.groups;
    if (Array.isArray(spec.fields) && spec.fields.length) {
      return [{ name: 'default', label: '', fields: spec.fields }];
    }
    return [];
  }, [spec]);

  if (!spec) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No form spec to preview.
      </div>
    );
  }

  if (!sections.length) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        This view has no sections, groups, or fields. Add at least one field
        to see a preview.
      </div>
    );
  }

  const isTabbed = spec.type === 'tabbed' && sections.length > 1;
  const isWizard = spec.type === 'wizard' && sections.length > 1;

  return (
    <Card className="border-muted-foreground/20">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{spec.label ?? 'Form preview'}</CardTitle>
          {showBadge && (
            <Badge variant="outline" className="gap-1 text-[10px] uppercase tracking-wider">
              <Eye className="h-3 w-3" /> preview
            </Badge>
          )}
        </div>
        {spec.description && (
          <CardDescription>{spec.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {isTabbed ? (
          <Tabs defaultValue={String(0)}>
            <TabsList className="flex flex-wrap">
              {sections.map((s, i) => (
                <TabsTrigger key={i} value={String(i)}>
                  {s.label ?? s.title ?? s.name ?? `Tab ${i + 1}`}
                </TabsTrigger>
              ))}
            </TabsList>
            {sections.map((s, i) => (
              <TabsContent key={i} value={String(i)} className="space-y-4 pt-4">
                {s.description && (
                  <p className="text-sm text-muted-foreground">{s.description}</p>
                )}
                <SectionBody section={s} objectSchema={objectSchema} />
              </TabsContent>
            ))}
          </Tabs>
        ) : isWizard ? (
          <div className="space-y-6">
            {sections.map((s, i) => (
              <div key={i} className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">
                      {s.label ?? s.title ?? s.name ?? `Step ${i + 1}`}
                    </p>
                    {s.description && (
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    )}
                  </div>
                </div>
                <SectionBody section={s} objectSchema={objectSchema} />
                {i < sections.length - 1 && <div className="h-px bg-border" />}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {sections.map((s, i) => (
              <div key={i} className="space-y-3">
                {(s.label || s.title) && (
                  <p className="text-sm font-semibold">{s.label ?? s.title}</p>
                )}
                {s.description && (
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                )}
                <SectionBody section={s} objectSchema={objectSchema} />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground opacity-70"
          >
            {spec.submitLabel ?? 'Submit'}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
