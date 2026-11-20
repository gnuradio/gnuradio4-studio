import type { Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { mergeFlowNodes } from './flow-node-reconciliation';

const node = (id: string): Node => ({ id, position: { x: 10, y: 20 }, data: {} });

describe('Canvas node reconciliation', () => {
  it('keeps a renamed inspected block selected under its new identity', () => {
    const merged = mergeFlowNodes([{ ...node('old'), selected: true }], [node('new')], 'new');
    expect(merged.map((entry) => [entry.id, entry.selected])).toEqual([['new', true]]);
  });
  it('preserves measured geometry and canvas selection when metadata changes', () => {
    const previous: Node = { ...node('same'), selected: true, measured: { width: 250, height: 80 } };
    const next = { ...node('same'), data: { label: 'updated' } };
    expect(mergeFlowNodes([previous], [next], 'same')[0]).toMatchObject({
      selected: true, measured: previous.measured, data: { label: 'updated' }, position: next.position,
    });
  });
  it('does not select new unrelated nodes or clear other nodes in a multiple selection', () => {
    const merged = mergeFlowNodes([{ ...node('other'), selected: true }], [node('other'), node('renamed'), node('unrelated')], 'renamed');
    expect(merged.map((entry) => entry.selected)).toEqual([true, true, false]);
  });
});
