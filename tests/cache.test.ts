import { describe, expect, it } from 'vitest';
import { cacheKey, cacheSeconds } from '../worker/src/cache-rules';

const version = (id: string) => ({ VERSION: { id } });

describe('the edge cache', () => {
  it('keys a response by its address, the parameters it depends on and the deployed version', () => {
    const url = 'https://versus.example.com/app/b/Ab3dEf7hJk?duel=a.b&from=chat';
    const key = (env: Parameters<typeof cacheKey>[1], params: string[] = ['duel']) => cacheKey(url, env, params);
    // A page cached before a deploy names the old build's files: the next version never reads it.
    expect(key(version('one'))).not.toBe(key(version('two')));
    expect(key(version('one'))).toBe(key(version('one')));
    // Only the parameters the response depends on: any other one can't make a new copy at will.
    expect(new URL(key(version('one'))).searchParams.get('duel')).toBe('a.b');
    expect(key(version('one'))).not.toContain('from=');
    expect(cacheKey('https://versus.example.com/app/b/Ab3dEf7hJk?from=x', {}, ['duel'])).toBe(
      cacheKey('https://versus.example.com/app/b/Ab3dEf7hJk?from=y', {}, ['duel']),
    );
    // Local tools without the binding: the address and its parameters alone.
    expect(key({})).toBe('https://versus.example.com/app/b/Ab3dEf7hJk?duel=a.b');
    expect(cacheKey(url, {})).toBe('https://versus.example.com/app/b/Ab3dEf7hJk');
  });

  it('keeps a response its own time, capped by CACHE_SECONDS, off at 0', () => {
    expect(cacheSeconds({}, 300)).toBe(300);
    expect(cacheSeconds({ CACHE_SECONDS: '' }, 300)).toBe(300);
    expect(cacheSeconds({ CACHE_SECONDS: '60' }, 300)).toBe(60);
    expect(cacheSeconds({ CACHE_SECONDS: '0' }, 300)).toBe(0);
    expect(cacheSeconds({ CACHE_SECONDS: 'soon' }, 300)).toBe(300);
  });
});
