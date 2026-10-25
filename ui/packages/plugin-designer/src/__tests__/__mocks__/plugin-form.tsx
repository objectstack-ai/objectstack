/**
 * Mock for @object-ui/plugin-form used in plugin-designer tests.
 * Renders a simple form that exposes schema callbacks.
 */
import React from 'react';

export const ModalForm: React.FC<any> = ({ schema }) => {
  if (!schema || schema.open === false) return null;

  const handleSubmit = () => {
    if (schema.onSuccess) {
      schema.onSuccess(schema.initialValues || {});
    }
  };

  return (
    <div data-testid="mock-modal-form">
      <span data-testid="modal-title">{schema.title}</span>
      <span data-testid="modal-mode">{schema.mode}</span>
      <button data-testid="modal-submit" onClick={handleSubmit}>
        Submit
      </button>
      <button
        data-testid="modal-cancel"
        onClick={() => schema.onOpenChange?.(false)}
      >
        Cancel
      </button>
    </div>
  );
};

export const DrawerForm: React.FC<any> = ({ schema }) => {
  if (!schema || schema.open === false) return null;

  const handleSubmit = () => {
    if (schema.onSuccess) {
      schema.onSuccess(schema.initialValues || {});
    }
  };

  return (
    <div data-testid="mock-drawer-form">
      <span data-testid="drawer-title">{schema.title}</span>
      <span data-testid="drawer-mode">{schema.mode}</span>
      <span data-testid="drawer-side">{schema.drawerSide || 'right'}</span>
      {/* Expose sections so tests can assert on collapsible / conditional fields */}
      {(schema.sections || []).map((section: any, idx: number) => (
        <div
          key={section.name || idx}
          data-testid={`drawer-section-${section.name || idx}`}
          data-collapsible={section.collapsible ? 'true' : 'false'}
          data-collapsed={section.collapsed ? 'true' : 'false'}
        >
          <span data-testid={`drawer-section-${section.name || idx}-label`}>{section.label}</span>
          {(section.fields || []).map((f: any) => (
            <span
              key={f.name}
              data-testid={`drawer-field-${f.name}`}
              data-condition-field={f.condition?.field || ''}
              data-condition-equals={f.condition?.equals || ''}
            >
              {f.name}
            </span>
          ))}
        </div>
      ))}
      <button data-testid="drawer-submit" onClick={handleSubmit}>
        Submit
      </button>
      <button
        data-testid="drawer-cancel"
        onClick={() => schema.onOpenChange?.(false)}
      >
        Cancel
      </button>
    </div>
  );
};
