import { describe, expect, it } from 'vitest';
import { cacheKey, cacheSeconds } from '../worker/src/cache-rules';

const version = (id: string) => ({ VERSION: { id } });

describe('the edge cache', () => {
  it('keys a response by its URL and the deployed version', () => {
    const url = 'https://versus.example.com/app/b/Ab3dEf7hJk?duel=a.b';
    // A page cached before a deploy names the old build's files: the next version never reads it.
    expect(cacheKey(url, version('one'))).not.toBe(cacheKey(url, version('two')));
    expect(cacheKey(url, version('one'))).toBe(cacheKey(url, version('one')));
    expect(new URL(cacheKey(url, version('one'))).searchParams.get('duel')).toBe('a.b');
    // Local tools without the binding: the URL alone.
    expect(cacheKey(url, {})).toBe(url);
  });

  it('keeps a response its own time, capped by CACHE_SECONDS, off at 0', () => {
    expect(cacheSeconds({}, 300)).toBe(300);
    expect(cacheSeconds({ CACHE_SECONDS: '' }, 300)).toBe(300);
    expect(cacheSeconds({ CACHE_SECONDS: '60' }, 300)).toBe(60);
    expect(cacheSeconds({ CACHE_SECONDS: '0' }, 300)).toBe(0);
    expect(cacheSeconds({ CACHE_SECONDS: 'soon' }, 300)).toBe(300);
  });
});
