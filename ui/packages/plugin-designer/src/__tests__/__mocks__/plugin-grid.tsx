/**
 * Mock for @object-ui/plugin-grid used in plugin-designer tests.
 * Renders a simple table that exposes the same callbacks as ObjectGrid.
 */
import React from 'react';

export const ObjectGrid: React.FC<any> = ({
  schema,
  dataSource,
  onRowClick,
  onEdit,
  onDelete,
  onAddRecord,
}) => {
  const [rows, setRows] = React.useState<any[]>([]);

  React.useEffect(() => {
    if (dataSource?.find) {
      dataSource.find(schema.objectName).then((result: any) => {
        setRows(result?.data || []);
      });
    }
  }, [dataSource, schema.objectName]);

  return (
    <div data-testid="mock-object-grid">
      {onAddRecord && (
        <button data-testid="grid-add-btn" onClick={onAddRecord}>
          Add
        </button>
      )}
      <input
        data-testid="grid-search"
        placeholder="Search..."
        onChange={() => {}}
      />
      <table>
        <tbody>
          {rows.map((row: any) => (
            <tr key={row.id} data-testid={`grid-row-${row.id}`}>
              <td>{row.name}</td>
              <td>{row.label}</td>
              <td>
                {onRowClick && (
                  <button
                    data-testid={`grid-row-click-${row.id}`}
                    onClick={() => onRowClick(row)}
                  >
                    Select
                  </button>
                )}
                {onEdit && (
                  <button
                    data-testid={`grid-edit-${row.id}`}
                    onClick={() => onEdit(row)}
                  >
                    Edit
                  </button>
                )}
                {onDelete && (
                  <button
                    data-testid={`grid-delete-${row.id}`}
                    onClick={() => onDelete(row)}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
