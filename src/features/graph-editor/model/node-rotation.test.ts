import { describe, expect, it } from 'vitest';
import type { EditorGraphNode } from './types';
import {
  isQuarterTurnNodeRotation,
  resolveNodePortVisualSide,
  rotateNodeRotation,
  rotateGraphNodes,
} from './node-rotation';

describe('node rotation helpers', () => {
  it('cycles node rotations left and right', () => {
    expect(rotateNodeRotation(0, 'right')).toBe(90);
    expect(rotateNodeRotation(90, 'right')).toBe(180);
    expect(rotateNodeRotation(180, 'right')).toBe(270);
    expect(rotateNodeRotation(270, 'right')).toBe(0);

    expect(rotateNodeRotation(0, 'left')).toBe(270);
    expect(rotateNodeRotation(270, 'left')).toBe(180);
    expect(rotateNodeRotation(180, 'left')).toBe(90);
    expect(rotateNodeRotation(90, 'left')).toBe(0);
  });

  it('detects quarter-turn rotations', () => {
    expect(isQuarterTurnNodeRotation(0)).toBe(false);
    expect(isQuarterTurnNodeRotation(90)).toBe(true);
    expect(isQuarterTurnNodeRotation(180)).toBe(false);
    expect(isQuarterTurnNodeRotation(270)).toBe(true);
  });

  it('maps logical port sides to visual sides by rotation', () => {
    expect(resolveNodePortVisualSide('input', 0)).toBe('left');
    expect(resolveNodePortVisualSide('output', 0)).toBe('right');

    expect(resolveNodePortVisualSide('input', 90)).toBe('top');
    expect(resolveNodePortVisualSide('output', 90)).toBe('bottom');

    expect(resolveNodePortVisualSide('input', 180)).toBe('right');
    expect(resolveNodePortVisualSide('output', 180)).toBe('left');

    expect(resolveNodePortVisualSide('input', 270)).toBe('bottom');
    expect(resolveNodePortVisualSide('output', 270)).toBe('top');
  });
});

describe('group rotation geometry', () => {
  const nodes: EditorGraphNode[] = [
    { instanceId: 'a', blockTypeId: 'test', displayName: 'A', parameters: {}, rotation: 0, position: { x: 0, y: 0 } },
    { instanceId: 'b', blockTypeId: 'test', displayName: 'B', parameters: {}, rotation: 270, position: { x: 250, y: 0 } },
    { instanceId: 'c', blockTypeId: 'test', displayName: 'C', parameters: {}, rotation: 180, position: { x: 10, y: 300 } },
  ];
  const sizes = new Map([
    ['a', { width: 200, height: 100 }],
    ['b', { width: 100, height: 200 }],
    ['c', { width: 80, height: 60 }],
  ]);

  it('rotates around the common center using card dimensions, preserving distances', () => {
    const result = rotateGraphNodes(nodes.slice(0, 2), 'right', sizes);
    // Original centers (100, 50), (300, 100) rotate around (200, 75).
    expect(result.map((node) => node.position)).toEqual([{ x: 125, y: -75 }, { x: 125, y: 75 }]);
    expect(result.map((node) => node.rotation)).toEqual([90, 0]);
    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it('restores an asymmetric group after inverse turns or four quarter turns', () => {
    const clockwise = rotateGraphNodes(nodes, 'right', sizes);
    const inverse = rotateGraphNodes(clockwise, 'left', sizes);
    let fullTurn = nodes;
    for (let i = 0; i < 4; i++) fullTurn = rotateGraphNodes(fullTurn, 'right', sizes);
    for (const result of [inverse, fullTurn]) {
      result.forEach((node, i) => {
        expect(node.position.x).toBeCloseTo(nodes[i].position.x);
        expect(node.position.y).toBeCloseTo(nodes[i].position.y);
        expect(node.rotation).toBe(nodes[i].rotation);
      });
    }
  });

  it('keeps a single block in place and accepts an empty selection', () => {
    expect(rotateGraphNodes([nodes[0]], 'left', sizes)[0]).toMatchObject({ position: nodes[0].position, rotation: 270 });
    expect(rotateGraphNodes([], 'right', sizes)).toEqual([]);
  });
});
