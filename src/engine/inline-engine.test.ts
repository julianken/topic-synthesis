import { describe, expect, it, vi } from 'vitest';
import { InlineEngine } from './inline-engine';

describe('InlineEngine', () => {
  it('memoizes a step by (name, key) — runs fn once, returns the same result', async () => {
    const engine = new InlineEngine();
    const fn = vi.fn().mockResolvedValue(42);
    expect(await engine.step('s', 'k', fn)).toBe(42);
    expect(await engine.step('s', 'k', fn)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keys by both name and key (a different name or key re-runs)', async () => {
    const engine = new InlineEngine();
    const fn = vi.fn().mockResolvedValue('x');
    await engine.step('a', 'k', fn);
    await engine.step('b', 'k', fn); // different name
    await engine.step('a', 'k2', fn); // different key
    await engine.step('a', 'k', fn); // repeat → cached
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('dedupes concurrent callers into one in-flight computation', async () => {
    const engine = new InlineEngine();
    let calls = 0;
    const fn = () => {
      calls += 1;
      return new Promise<string>((resolve) => setTimeout(() => resolve('x'), 5));
    };
    const [a, b] = await Promise.all([engine.step('s', 'k', fn), engine.step('s', 'k', fn)]);
    expect(a).toBe('x');
    expect(b).toBe('x');
    expect(calls).toBe(1);
  });

  it('evicts a failed step so a retry re-runs it', async () => {
    const engine = new InlineEngine();
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    await expect(engine.step('s', 'k', fn)).rejects.toThrow('boom');
    expect(await engine.step('s', 'k', fn)).toBe('ok'); // not a cached rejection
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
