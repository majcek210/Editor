import { describe, expect, it } from 'vitest';
import { buildHeartbeatArgs, pluginString } from '../src/core/tracker/cliArgs';
import { REDACTED, redactArgs, redactText } from '../src/core/tracker/redact';

const KEY = '12345678-1234-4123-8123-123456789abc';

describe('buildHeartbeatArgs', () => {
  it('builds an edit heartbeat', () => {
    expect(buildHeartbeatArgs({
      entity: '/storage/p/main.py', write: false, plugin: pluginString('0.1.0'),
      project: 'p', language: 'Python', lineno: 3, cursorpos: 7, linesInFile: 40,
    })).toEqual([
      '--entity', '/storage/p/main.py',
      '--entity-type', 'file',
      '--plugin', 'hackatime-editor/0.1.0',
      '--category', 'coding',
      '--project', 'p',
      '--language', 'Python',
      '--lineno', '3',
      '--cursorpos', '7',
      '--lines-in-file', '40',
      '--sync-ai-disabled',
    ]);
  });

  it('adds --write only for saves', () => {
    const base = { entity: '/a.ts', plugin: 'hackatime-editor/0.1.0' };
    expect(buildHeartbeatArgs({ ...base, write: true })).toContain('--write');
    expect(buildHeartbeatArgs({ ...base, write: false })).not.toContain('--write');
  });

  it('never includes the API key, API URL, or config path', () => {
    const args = buildHeartbeatArgs({ entity: '/a.ts', write: true, plugin: 'hackatime-editor/1.2.3' });
    for (const flag of ['--key', '--api-url', '--apiurl', '--config', '--proxy', '--no-ssl-verify']) {
      expect(args).not.toContain(flag);
    }
  });

  it('only accepts a plugin string that identifies this app', () => {
    expect(() => buildHeartbeatArgs({ entity: '/a.ts', write: false, plugin: 'vscode/1.90.0' })).toThrow();
    expect(() => buildHeartbeatArgs({ entity: '/a.ts', write: false, plugin: 'hackatime-editor/1.0.0 vscode/1.0' })).toThrow();
  });

  it('rejects relative entity paths', () => {
    expect(() => buildHeartbeatArgs({ entity: 'a.ts', write: false, plugin: 'hackatime-editor/0.1.0' })).toThrow();
  });

  it('skips invalid numbers', () => {
    const args = buildHeartbeatArgs({ entity: '/a', write: false, plugin: 'hackatime-editor/0.1.0', lineno: 0, cursorpos: 1.5 });
    expect(args).not.toContain('--lineno');
    expect(args).not.toContain('--cursorpos');
  });
});

describe('redaction', () => {
  it('redacts --key values in both forms', () => {
    expect(redactArgs(['--entity', '/a', '--key', KEY, '--write'])).toEqual(['--entity', '/a', '--key', REDACTED, '--write']);
    expect(redactArgs([`--key=${KEY}`])).toEqual([`--key=${REDACTED}`]);
    expect(redactArgs(['--key', 'not-a-uuid-secret'])).toEqual(['--key', REDACTED]);
  });

  it('redacts the key wherever it appears in output', () => {
    const out = redactText(`config: api_key = ${KEY}\nfailed for key ${KEY}`, [KEY]);
    expect(out).not.toContain(KEY);
    expect(out).toContain(REDACTED);
  });

  it('redacts the base64 form used in the Authorization header', () => {
    const b64 = btoa(KEY);
    const out = redactText(`Authorization: Basic ${b64}`, [KEY]);
    expect(out).not.toContain(b64);
  });

  it('redacts key-shaped values even when the key is unknown', () => {
    expect(redactText(`waka_${KEY}`)).toBe(REDACTED);
    expect(redactText(KEY.toUpperCase())).toBe(REDACTED);
  });

  it('leaves normal arguments alone', () => {
    const args = ['--entity', '/storage/emulated/0/p/a.ts', '--plugin', 'hackatime-editor/0.1.0'];
    expect(redactArgs(args, [KEY])).toEqual(args);
  });
});
