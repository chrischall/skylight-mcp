import { describe, it, expect } from 'vitest';
import { affectsMultipleOccurrences } from '../../src/tools/_confirm.js';

// The repo's rule for when a destructive API tool needs a confirm gate: gate
// when the blast radius EXCEEDS what the caller named, not merely because the
// call is irreversible. Three vocabularies spell the same idea, so all three
// are pinned here.
describe('affectsMultipleOccurrences', () => {
  it('is true for scopes that reach past the named occurrence', () => {
    for (const scope of ['future', 'this_and_future', 'all']) {
      expect(affectsMultipleOccurrences(scope), scope).toBe(true);
    }
  });

  it('is false for scopes that affect only the occurrence named', () => {
    for (const scope of ['one', 'this']) {
      expect(affectsMultipleOccurrences(scope), scope).toBe(false);
    }
  });

  // An omitted apply_to is a plain single delete — gating it would tax every
  // ordinary delete in the repo for no safety gain.
  it('is false when apply_to is omitted', () => {
    expect(affectsMultipleOccurrences(undefined)).toBe(false);
  });

  it('is false for an unrecognised value rather than defaulting to gated', () => {
    // Fail-open is deliberate here: zod rejects unknown values before a handler
    // runs, so an unknown string means the enum changed — and silently gating
    // every call would be a worse failure than not gating a value that cannot
    // reach production.
    expect(affectsMultipleOccurrences('sideways')).toBe(false);
  });
});
