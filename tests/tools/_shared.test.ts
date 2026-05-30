import { describe, it, expect } from 'vitest';
import { textContent, flattenJsonApi } from '../../src/tools/_shared.js';

describe('_shared', () => {
  it('textContent wraps JSON', () => {
    expect(textContent({ a: 1 })).toEqual({ content: [{ type: 'text', text: JSON.stringify({ a: 1 }, null, 2) }] });
  });

  it('flattenJsonApi merges id+type+attributes', () => {
    const out = flattenJsonApi({ data: [{ id: '7', type: 'list', attributes: { label: 'Groceries', color: 'red' } }] });
    expect(out).toEqual([{ id: '7', type: 'list', label: 'Groceries', color: 'red' }]);
  });

  it('flattenJsonApi handles a single resource', () => {
    expect(flattenJsonApi({ data: { id: '1', type: 'frame', attributes: { name: 'x' } } }))
      .toEqual({ id: '1', type: 'frame', name: 'x' });
  });

  it('flattenJsonApi handles resource without attributes (array)', () => {
    const out = flattenJsonApi({ data: [{ id: '2', type: 'x' }] });
    expect(out).toEqual([{ id: '2', type: 'x' }]);
  });

  it('flattenJsonApi handles resource without attributes (single)', () => {
    const out = flattenJsonApi({ data: { id: '2', type: 'x' } });
    expect(out).toEqual({ id: '2', type: 'x' });
  });
});
