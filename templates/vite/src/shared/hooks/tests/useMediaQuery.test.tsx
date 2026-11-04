import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { installMatchMedia, restoreMatchMedia } from '@/test/matchMedia';

import { useMediaQuery } from '../useMediaQuery';

const WIDE = '(min-width: 768px)';

afterEach(restoreMatchMedia);

describe('useMediaQuery', () => {
  it('follows the query and unsubscribes on unmount', () => {
    const media = installMatchMedia([WIDE]);
    const { result, unmount } = renderHook(() => useMediaQuery(WIDE));
    expect(result.current).toBe(true);
    expect(media.listenerCount(WIDE)).toBe(1);

    act(() => media.set(WIDE, false));
    expect(result.current).toBe(false);

    unmount();
    expect(media.listenerCount(WIDE)).toBe(0);
  });
});
