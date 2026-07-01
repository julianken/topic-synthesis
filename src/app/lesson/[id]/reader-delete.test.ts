import { describe, expect, it, vi } from 'vitest';
import { performReaderDelete } from './reader-delete';

// ── issue #202: the reader delete flow's pure orchestration core ────────────────────────────────────────
// Mirrors the `library-delete.ts` / `library-morph.ts` discipline: every I/O (the DELETE call, the
// same-document recede, the handoff write, the soft-nav) is INJECTED, so the flow's SEQUENCING —
// delete → recede → write-handoff → navigate, and crucially NO navigation on a failed delete (AC18/AC21) —
// is node-testable with no DOM, no network, no router.

function makeDeps(overrides: Partial<Parameters<typeof performReaderDelete>[2]> = {}) {
  const calls: string[] = [];
  const deleteLesson = vi.fn(async () => {
    calls.push('delete');
    return true;
  });
  const recede = vi.fn(async () => {
    calls.push('recede');
  });
  const writeHandoff = vi.fn(() => {
    calls.push('writeHandoff');
  });
  const navigate = vi.fn(() => {
    calls.push('navigate');
  });
  return { calls, deps: { deleteLesson, recede, writeHandoff, navigate, ...overrides } };
}

describe('performReaderDelete', () => {
  it('on a successful delete: recedes, writes the handoff, then navigates — in that order (AC18/AC19/AC28)', async () => {
    const { calls, deps } = makeDeps();
    const ok = await performReaderDelete('lesson-1', 0.6, deps);
    expect(ok).toBe(true);
    expect(calls).toEqual(['delete', 'recede', 'writeHandoff', 'navigate']);
  });

  it('passes the id + scrollProgress through to the delete call and the handoff writer', async () => {
    const { deps } = makeDeps();
    await performReaderDelete('lesson-42', 0.73, deps);
    expect(deps.deleteLesson).toHaveBeenCalledWith('lesson-42');
    expect(deps.writeHandoff).toHaveBeenCalledWith('lesson-42', 0.73);
  });

  it('on a failed delete: returns false, and recede/writeHandoff/navigate never run (AC21/AC23)', async () => {
    const { calls, deps } = makeDeps({ deleteLesson: vi.fn(async () => false) });
    const ok = await performReaderDelete('lesson-1', 0.1, deps);
    expect(ok).toBe(false);
    expect(calls).toEqual([]);
    expect(deps.recede).not.toHaveBeenCalled();
    expect(deps.writeHandoff).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('the injected deleteLesson never rejecting is the caller\'s contract — a throw here propagates (the UI wraps it)', async () => {
    // performReaderDelete itself does no try/catch around deleteLesson — matching library-delete.ts's
    // DeleteCommit contract ("must NEVER reject"), the wiring layer (the component) is responsible for
    // ensuring its real fetch-based deleteLesson never rejects (see reader-delete-pill.tsx).
    const { deps } = makeDeps({
      deleteLesson: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(performReaderDelete('lesson-1', 0, deps)).rejects.toThrow('boom');
  });

  it('awaits recede before writing the handoff (a slow recede does not race the write)', async () => {
    const order: string[] = [];
    let resolveRecede: () => void = () => {};
    const recede = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRecede = () => {
            order.push('recede-resolved');
            resolve();
          };
        }),
    );
    const writeHandoff = vi.fn(() => order.push('writeHandoff'));
    const deps = {
      deleteLesson: vi.fn(async () => true),
      recede,
      writeHandoff,
      navigate: vi.fn(),
    };
    const promise = performReaderDelete('lesson-1', 0, deps);
    // Give the delete + recede call a microtask turn, then resolve recede.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]); // writeHandoff must NOT have run while recede is still pending
    resolveRecede();
    await promise;
    expect(order).toEqual(['recede-resolved', 'writeHandoff']);
  });
});
