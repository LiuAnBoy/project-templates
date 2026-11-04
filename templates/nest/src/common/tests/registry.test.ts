import { describe, expect, it } from 'vitest';

import { createRegistry } from '../registry.js';

describe('createRegistry', () => {
  it('returns what was registered, in order', () => {
    const registry = createRegistry<string>();
    registry.register('a', 'first');
    registry.register('b', 'second');

    expect(registry.get('b')).toBe('second');
    expect(registry.all()).toEqual(['first', 'second']);
  });

  it('throws on a duplicate key and on an unknown key', () => {
    const registry = createRegistry<string>();
    registry.register('a', 'first');

    expect(() => registry.register('a', 'again')).toThrow(
      'already registered: a',
    );
    expect(() => registry.get('missing')).toThrow('not registered: missing');
  });
});
