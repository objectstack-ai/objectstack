// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FieldStub — visual placeholder that mimics the *runtime input* for
 * every supported field type. Used inside the form-designer canvas
 * so authors see "what their form will look like" without actually
 * mounting the real widget (which would need a ValueDataSource and
 * may fetch records, validate, etc.).
 *
 * Always disabled and stateless. Switches on `type` to render the
 * appropriate shape (text input, switch, picklist, star row, …). Any
 * unknown type falls back to a generic input + type badge.
 */

import * as React from 'react';
import { Input, Switch, Badge } from '@object-ui/components';
import {
  Calendar, Clock, Link2, Image as ImageIcon, Paperclip, MapPin, Star, ChevronDown, Search, Hash, Phone, AtSign, Globe, Lock, Palette,
} from 'lucide-react';
import type { FieldTypeId } from './field-types.js';
import { FIELD_TYPE_META } from './field-types.js';
import { t, tFormat } from '../i18n.js';

interface FieldStubProps {
  type: string;
  label?: string;
  placeholder?: string;
  /** Picklist options for select/radio/multiselect/checkboxes. */
  options?: Array<{ value: string; label?: string }>;
  /** Reference target for lookup/master_detail/tree. */
  referenceTo?: string;
  /** Formula expression for formula/summary. */
  formula?: string;
  /** Active UI locale (illustrative placeholder text is localized). */
  locale?: string;
}

export function FieldStub(props: FieldStubProps) {
  const { type, locale } = props;
  switch (type as FieldTypeId) {
    case 'text':
    case 'password':
      return <PlainInput {...props} icon={type === 'password' ? <Lock className="h-3.5 w-3.5" /> : undefined} />;
    case 'email':
      return <PlainInput {...props} icon={<AtSign className="h-3.5 w-3.5" />} placeholder={props.placeholder ?? 'name@example.com'} />;
    case 'url':
      return <PlainInput {...props} icon={<Globe className="h-3.5 w-3.5" />} placeholder={props.placeholder ?? 'https://…'} />;
    case 'phone':
      return <PlainInput {...props} icon={<Phone className="h-3.5 w-3.5" />} placeholder={props.placeholder ?? '+1 555 …'} />;
    case 'number':
    case 'currency':
    case 'percent':
    case 'autonumber':
      return <PlainInput {...props} icon={<Hash className="h-3.5 w-3.5" />} placeholder={props.placeholder ?? '0'} />;
    case 'date':
    case 'datetime':
      return <PlainInput {...props} icon={<Calendar className="h-3.5 w-3.5" />} placeholder={t('designer.stub.pickDate', locale)} />;
    case 'time':
      return <PlainInput {...props} icon={<Clock className="h-3.5 w-3.5" />} placeholder="hh:mm" />;
    case 'textarea':
    case 'markdown':
    case 'html':
    case 'richtext':
    case 'json':
    case 'code':
      return <TextareaStub {...props} mono={type === 'json' || type === 'code'} />;
    case 'boolean':
    case 'toggle':
      return (
        <div className="flex items-center gap-2 h-8">
          <Switch disabled />
          <span className="text-xs text-muted-foreground">{props.placeholder ?? t('designer.stub.off', locale)}</span>
        </div>
      );
    case 'select':
    case 'radio':
      return <PicklistStub {...props} single />;
    case 'multiselect':
    case 'checkboxes':
    case 'tags':
      return <PicklistStub {...props} single={false} />;
    case 'lookup':
    case 'master_detail':
    case 'tree':
      return <LookupStub {...props} />;
    case 'image':
    case 'avatar':
      return <MediaTile icon={<ImageIcon className="h-4 w-4" />} label={t(type === 'avatar' ? 'designer.stub.uploadAvatar' : 'designer.stub.uploadImage', locale)} />;
    case 'file':
    case 'video':
    case 'audio':
    case 'signature':
      return <MediaTile icon={<Paperclip className="h-4 w-4" />} label={tFormat('designer.stub.upload', locale, { type })} />;
    case 'qrcode':
      return <MediaTile icon={<Paperclip className="h-4 w-4" />} label={t('designer.stub.qrcode', locale)} />;
    case 'color':
      return (
        <div className="flex items-center gap-2 h-8">
          <span className="inline-block h-6 w-6 rounded border" style={{ background: '#3b82f6' }} />
          <span className="text-xs text-muted-foreground">#3b82f6</span>
          <Palette className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      );
    case 'rating':
      return (
        <div className="flex items-center gap-0.5 h-8">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className={'h-4 w-4 ' + (i < 3 ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
          ))}
        </div>
      );
    case 'slider':
      return (
        <div className="flex items-center gap-2 h-8">
          <div className="relative flex-1 h-1.5 rounded bg-muted">
            <div className="absolute inset-y-0 left-0 w-2/5 rounded bg-primary" />
            <div className="absolute h-3 w-3 -top-[3px] left-[40%] rounded-full border-2 border-primary bg-background" />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">40</span>
        </div>
      );
    case 'progress':
      return (
        <div className="flex items-center gap-2 h-8">
          <div className="relative flex-1 h-2 rounded bg-muted">
            <div className="absolute inset-y-0 left-0 w-3/5 rounded bg-emerald-500" />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">60%</span>
        </div>
      );
    case 'location':
      return <PlainInput {...props} icon={<MapPin className="h-3.5 w-3.5" />} placeholder={t('designer.stub.latLng', locale)} />;
    case 'address':
      return <TextareaStub {...props} placeholder={props.placeholder ?? t('designer.stub.address', locale)} />;
    case 'formula':
    case 'summary':
      return (
        <div className="h-8 px-2 flex items-center text-xs font-mono bg-muted/40 border rounded text-muted-foreground">
          {props.formula ? `ƒ ${props.formula}` : `ƒ ${t('designer.stub.computed', locale)}`}
        </div>
      );
    case 'composite':
      return (
        <div className="p-2 border-dashed border-2 rounded text-[11px] text-muted-foreground italic">
          {t('designer.stub.composite', locale)}
        </div>
      );
    case 'repeater':
      return (
        <div className="p-2 border-dashed border-2 rounded text-[11px] text-muted-foreground italic">
          {t('designer.stub.repeater', locale)}
        </div>
      );
    case 'vector':
      return (
        <div className="h-8 px-2 flex items-center text-xs font-mono bg-muted/40 border rounded text-muted-foreground">
          [0.124, 0.337, …] {props.placeholder ? `(${props.placeholder})` : ''}
        </div>
      );
    default:
      return (
        <div className="flex items-center gap-2">
          <Input disabled placeholder={props.placeholder ?? `(${type})`} className="h-8 text-sm" />
          <Badge variant="outline" className="text-[10px]">{type}</Badge>
        </div>
      );
  }
}

function PlainInput({ placeholder, icon }: FieldStubProps & { icon?: React.ReactNode }) {
  return (
    <div className="relative">
      <Input disabled placeholder={placeholder ?? ''} className={'h-8 text-sm ' + (icon ? 'pl-8' : '')} />
      {icon && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</div>
      )}
    </div>
  );
}

function TextareaStub({ placeholder, mono }: FieldStubProps & { mono?: boolean }) {
  return (
    <textarea
      disabled
      placeholder={placeholder ?? ''}
      className={'w-full min-h-[60px] text-sm rounded-md border bg-background px-2 py-1.5 disabled:opacity-100 ' + (mono ? 'font-mono text-xs' : '')}
    />
  );
}

function PicklistStub({ options, placeholder, single, locale }: FieldStubProps & { single: boolean }) {
  const opts = options ?? [];
  // Filter BEFORE slicing. An entry with neither a value nor a label renders
  // as nothing, so letting it consume the display budget hid a well-formed
  // option sitting behind it, and made the overflow counter below promise
  // badges no wider card could ever show (objectui#9074). `renderable` is the
  // population for both: what fits is rendered, what does not is counted.
  const renderable = opts.filter((o) => o.value || o.label);
  const visible = renderable.slice(0, single ? 1 : 3);
  if (single) {
    return (
      <div className="h-8 px-2 flex items-center justify-between text-sm border rounded bg-background text-muted-foreground">
        <span className="truncate">{visible[0]?.label || visible[0]?.value || placeholder || t('designer.stub.select', locale)}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </div>
    );
  }
  return (
    <div className="min-h-8 px-1.5 py-1 flex items-center flex-wrap gap-1 border rounded bg-background">
      {visible.length === 0 ? (
        <span className="text-xs text-muted-foreground px-1">{placeholder || t('designer.stub.pickMulti', locale)}</span>
      ) : (
        visible.map((o, i) => (
          <Badge key={i} variant="secondary" className="text-[10px]">{o.label || o.value}</Badge>
        ))
      )}
      {renderable.length > visible.length && (
        <span className="text-[10px] text-muted-foreground">+{renderable.length - visible.length}</span>
      )}
    </div>
  );
}

function LookupStub({ referenceTo, placeholder, locale }: FieldStubProps) {
  const meta = referenceTo ? FIELD_TYPE_META.lookup : null;
  return (
    <div className="h-8 px-2 flex items-center gap-2 border rounded bg-background text-sm text-muted-foreground">
      <Link2 className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate flex-1">
        {placeholder || (referenceTo ? tFormat('designer.stub.searchRef', locale, { ref: referenceTo }) : t('designer.stub.chooseRelated', locale))}
      </span>
      {referenceTo && (
        <Badge variant="outline" className="text-[10px] shrink-0">→ {referenceTo}</Badge>
      )}
      {!referenceTo && <Search className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
      {/* swallow unused import warning */}
      {meta && null}
    </div>
  );
}

function MediaTile({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="h-16 w-full border-2 border-dashed rounded flex flex-col items-center justify-center gap-1 text-muted-foreground bg-muted/20">
      {icon}
      <span className="text-[11px]">{label}</span>
    </div>
  );
}
