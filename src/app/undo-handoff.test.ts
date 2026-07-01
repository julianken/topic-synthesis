import { describe, expect, it, vi } from 'vitest';
import { parseHandoff, readUndoHandoffOnce, writeUndoHandoff, type HandoffStorage } from './undo-handoff';

// ── issue #202: the reader→library read-once undo handoff ──────────────────────────────────────────────
// A reader delete fires `router.push('/')` (a client soft-nav, no full page reload) so React state can't
// carry the "I just deleted this" fact across the navigation. sessionStorage does, but its content is
// UNTRUSTED once read back (another tab could have written garbage, storage could be disabled/full, or a
// stale/foreign-shaped value could be left over from an older build) — so the reader is treated as
// untrusted input, mirroring the `lesson-message.ts` / `library-delete.ts` discipline: absent/malformed/
// foreign-shaped never throws, it degrades to `null`.

/** A Map-backed fake Storage — no real sessionStorage, so the module is node-testable. */
function fakeStorage(initial: Record<string, string> = {}): HandoffStorage & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

describe('writeUndoHandoff', () => {
  it('writes { id, scrollProgress } under one known key', () => {
    const storage = fakeStorage();
    writeUndoHandoff({ id: 'abc123', scrollProgress: 0.42 }, storage);
    const dump = storage.dump();
    const keys = Object.keys(dump);
    expect(keys).toHaveLength(1);
    const raw = dump[keys[0] as string];
    expect(raw).toBeDefined();
    expect(JSON.parse(raw as string)).toEqual({ id: 'abc123', scrollProgress: 0.42 });
  });

  it('never throws when storage is unavailable (null)', () => {
    expect(() => writeUndoHandoff({ id: 'abc', scrollProgress: 0 }, null)).not.toThrow();
  });

  it('never throws when the storage backend itself throws (quota / disabled storage)', () => {
    const storage: HandoffStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('disabled');
      },
    };
    expect(() => writeUndoHandoff({ id: 'abc', scrollProgress: 0 }, storage)).not.toThrow();
  });
});

describe('readUndoHandoffOnce — read-once semantics', () => {
  it('returns the written payload on first read', () => {
    const storage = fakeStorage();
    writeUndoHandoff({ id: 'xyz', scrollProgress: 0.5 }, storage);
    expect(readUndoHandoffOnce(storage)).toEqual({ id: 'xyz', scrollProgress: 0.5 });
  });

  it('removes the key on read — a second read returns null (a page refresh never re-shows it)', () => {
    const storage = fakeStorage();
    writeUndoHandoff({ id: 'xyz', scrollProgress: 0.5 }, storage);
    expect(readUndoHandoffOnce(storage)).not.toBeNull();
    expect(readUndoHandoffOnce(storage)).toBeNull();
    expect(storage.dump()).toEqual({});
  });

  it('returns null when nothing was ever written', () => {
    expect(readUndoHandoffOnce(fakeStorage())).toBeNull();
  });

  it('returns null when storage is unavailable, never throws', () => {
    expect(readUndoHandoffOnce(null)).toBeNull();
  });

  it('clears a malformed leftover on read too (read-once even for garbage)', () => {
    const storage = fakeStorage();
    // The write helper always writes valid JSON, so simulate a foreign/corrupt write directly.
    storage.setItem('ts:undo-handoff', 'not json{{{');
    expect(readUndoHandoffOnce(storage)).toBeNull();
    expect(storage.dump()).toEqual({});
  });

  it('propagates a getItem throw as null (never throws upward)', () => {
    const storage: HandoffStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    expect(readUndoHandoffOnce(storage)).toBeNull();
  });
});

describe('parseHandoff — untrusted sessionStorage content', () => {
  it('accepts a well-formed payload', () => {
    expect(parseHandoff('{"id":"abc","scrollProgress":0.3}')).toEqual({ id: 'abc', scrollProgress: 0.3 });
  });

  it('rejects invalid JSON → null', () => {
    expect(parseHandoff('{not json')).toBeNull();
  });

  it('rejects null, arrays, and primitives → null', () => {
    expect(parseHandoff('null')).toBeNull();
    expect(parseHandoff('[]')).toBeNull();
    expect(parseHandoff('"just a string"')).toBeNull();
    expect(parseHandoff('42')).toBeNull();
  });

  it('rejects a missing or non-string id → null', () => {
    expect(parseHandoff('{"scrollProgress":0.5}')).toBeNull();
    expect(parseHandoff('{"id":123,"scrollProgress":0.5}')).toBeNull();
    expect(parseHandoff('{"id":"","scrollProgress":0.5}')).toBeNull();
  });

  it('rejects a missing or non-numeric scrollProgress → null', () => {
    expect(parseHandoff('{"id":"abc"}')).toBeNull();
    expect(parseHandoff('{"id":"abc","scrollProgress":"half"}')).toBeNull();
    expect(parseHandoff('{"id":"abc","scrollProgress":null}')).toBeNull();
    expect(parseHandoff('{"id":"abc","scrollProgress":NaN}')).toBeNull(); // invalid JSON literal anyway
  });

  it('ignores extra/foreign fields (strips to the two contract fields)', () => {
    expect(parseHandoff('{"id":"abc","scrollProgress":0.2,"evil":"<script>"}')).toEqual({
      id: 'abc',
      scrollProgress: 0.2,
    });
  });

  it('clamps scrollProgress into [0, 1]', () => {
    expect(parseHandoff('{"id":"abc","scrollProgress":1.7}')).toEqual({ id: 'abc', scrollProgress: 1 });
    expect(parseHandoff('{"id":"abc","scrollProgress":-0.4}')).toEqual({ id: 'abc', scrollProgress: 0 });
  });

  it('rejects a non-finite number (Infinity) as malformed — never throws', () => {
    // `1e999` is valid JSON number syntax that overflows to `Infinity` on parse. Treated as malformed
    // (not clamped) — a single well-formed-but-absurd field is enough to distrust the whole payload.
    expect(parseHandoff('{"id":"abc","scrollProgress":1e999}')).toBeNull();
  });
});
