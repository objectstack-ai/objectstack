import { describe, it, expect } from 'vitest';
import { kanbanDeclaredLanes } from '../kanban-declared-lanes';

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'completed', label: 'Completed' },
];

describe('kanbanDeclaredLanes (objectstack#28211)', () => {
  it('draws only the listed lanes, in the listed order, titled by option label', () => {
    expect(kanbanDeclaredLanes(['in_progress', 'not_started', 'waiting'], STATUS_OPTIONS)).toEqual([
      { id: 'in_progress', title: 'In Progress' },
      { id: 'not_started', title: 'Not Started' },
      { id: 'waiting', title: 'Waiting' },
    ]);
  });

  it('declares no lanes when the view declares none, so the board keeps one lane per option', () => {
    expect(kanbanDeclaredLanes(undefined, STATUS_OPTIONS)).toBeUndefined();
    expect(kanbanDeclaredLanes([], STATUS_OPTIONS)).toBeUndefined();
  });

  it('keeps the author order over the lifecycle order, and collapses a lost lane', () => {
    const options = [
      { value: 'open', label: 'Open', kind: 'open' },
      { value: 'won', label: 'Won', kind: 'won' },
      { value: 'lost', label: 'Lost', kind: 'lost' },
    ];
    expect(kanbanDeclaredLanes(['lost', 'open'], options)).toEqual([
      { id: 'lost', title: 'Lost', collapsed: true },
      { id: 'open', title: 'Open' },
    ]);
  });

  it('titles a lane with its value while the options are not loaded yet', () => {
    expect(kanbanDeclaredLanes(['in_progress'], undefined)).toEqual([{ id: 'in_progress', title: 'in_progress' }]);
  });
});
