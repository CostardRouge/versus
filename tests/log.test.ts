import { describe, expect, it, vi } from 'vitest';
import { cspFields, errorText, log, logLine } from '../worker/src/log';

describe('the Worker’s log lines', () => {
  it('writes one JSON object per line, the event first, which no field can rename', () => {
    expect(logLine('admin', { method: 'DELETE', alias: 'Ab3dEf7hJk', item: '' })).toBe(
      '{"event":"admin","method":"DELETE","alias":"Ab3dEf7hJk","item":""}',
    );
    expect(JSON.parse(logLine('x', { event: 'y', n: 2, ok: false }))).toEqual({ event: 'x', n: 2, ok: false });
    expect(logLine('alone')).toBe('{"event":"alone"}');
    // A line stays on its line, whatever an error message holds.
    expect(logLine('e', { error: 'two\nlines' })).not.toContain('\n');
  });

  it('prints to the console, with short error messages', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log('registry_write_failed', { alias: 'Ab3dEf7hJk', error: errorText(new Error('D1 is away')) });
    expect(spy).toHaveBeenCalledWith('{"event":"registry_write_failed","alias":"Ab3dEf7hJk","error":"D1 is away"}');
    spy.mockRestore();
    expect(errorText('x'.repeat(500))).toHaveLength(200);
    expect(errorText(42)).toBe('42');
  });

  it('reads a content security policy report as facts: an origin, never a full address or a query', () => {
    const report = (r: Record<string, unknown>) => cspFields({ 'csp-report': r });
    expect(
      report({
        'document-uri': 'https://versus.example.com/app/b/Ab3dEf7hJk?duel=a.b',
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example.net/x.js?token=secret',
        disposition: 'report',
      }),
    ).toEqual({
      directive: 'script-src-elem',
      blocked: 'https://evil.example.net',
      page: '/app/b/Ab3dEf7hJk',
      disposition: 'report',
    });
    expect(report({ 'violated-directive': "script-src 'self'", 'blocked-uri': 'inline' })).toEqual({
      directive: 'script-src',
      blocked: 'inline',
      page: '',
      disposition: '',
    });
    expect(report({ 'blocked-uri': 'data:image/png;base64,AAAA' })?.blocked).toBe('data:');
    expect(cspFields({ other: 1 })).toBeNull();
    expect(cspFields(undefined)).toBeNull();
  });
});
