import { describe, it, expect } from 'vitest';
import { textContent, flattenJsonApi, pruneUndefined, resolveJsonApiIncluded, type JsonApiDoc } from '../../src/tools/_shared.js';

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

  it('pruneUndefined drops undefined values but keeps falsy (0, "", false)', () => {
    expect(pruneUndefined({ a: 1, b: undefined, c: 0, d: '', e: false, f: undefined }))
      .toEqual({ a: 1, c: 0, d: '', e: false });
  });

  // ── resolveJsonApiIncluded ─────────────────────────────────────────────
  // Unlike flattenJsonApi, this keeps `relationships` by swapping each link for
  // the matching resource out of the document's `included` sideload.

  it('resolveJsonApiIncluded resolves a single (non-array) resource', () => {
    const out = resolveJsonApiIncluded({
      data: {
        id: '7', type: 'meal_sitting', attributes: { summary: 'Tacos' },
        relationships: { meal_category: { data: { id: '2', type: 'meal_category' } } },
      },
      included: [{ id: '2', type: 'meal_category', attributes: { label: 'Dinner' } }],
    });
    expect(out).toEqual({
      id: '7', type: 'meal_sitting', summary: 'Tacos',
      meal_category: { id: '2', type: 'meal_category', label: 'Dinner' },
    });
  });

  it('resolveJsonApiIncluded drops an empty to-one relationship (data: null)', () => {
    const out = resolveJsonApiIncluded({
      data: [{ id: '7', type: 'meal_sitting', attributes: {}, relationships: { meal_recipe: { data: null } } }],
      included: [],
    });
    expect(out).toEqual([{ id: '7', type: 'meal_sitting' }]);
  });

  it('resolveJsonApiIncluded keeps a sideloaded resource that has no attributes', () => {
    const out = resolveJsonApiIncluded({
      data: [{
        id: '7', type: 'meal_sitting', attributes: {},
        relationships: { meal_category: { data: { id: '2', type: 'meal_category' } } },
      }],
      included: [{ id: '2', type: 'meal_category' }],
    });
    expect(out).toEqual([{ id: '7', type: 'meal_sitting', meal_category: { id: '2', type: 'meal_category' } }]);
  });

  it('resolveJsonApiIncluded handles a resource with no attributes at all', () => {
    expect(resolveJsonApiIncluded({ data: [{ id: '7', type: 'meal_sitting' }] }))
      .toEqual([{ id: '7', type: 'meal_sitting' }]);
  });

  // `c.request<JsonApiDoc>()` is an unchecked cast of a network response, so the
  // type alone does not guarantee `data` is present. flattenJsonApi guards this
  // (`if (!('data' in root)) return payload`); resolveJsonApiIncluded must too,
  // or a malformed 200 crashes the tool with a bare TypeError.
  it('resolveJsonApiIncluded returns [] for a document with no data member', () => {
    expect(resolveJsonApiIncluded({} as unknown as JsonApiDoc)).toEqual([]);
  });

  it('resolveJsonApiIncluded returns [] for an empty to-one document (data: null)', () => {
    expect(resolveJsonApiIncluded({ data: null } as unknown as JsonApiDoc)).toEqual([]);
  });
});
