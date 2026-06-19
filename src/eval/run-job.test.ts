import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildJobInput } from './run-job';

const SAVED = { ...process.env };
const JOB_KEYS = ['RUN_ID', 'TOPIC', 'LEVEL', 'DEPTH', 'AUDIENCE', 'CHEAP', 'MAX_NODES', 'MAX_QUESTIONS'];

beforeEach(() => {
  for (const k of JOB_KEYS) delete process.env[k];
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe('buildJobInput', () => {
  it('reads RUN_ID + TOPIC + knobs from env (RUN_ID is the input id, never generated)', () => {
    Object.assign(process.env, {
      RUN_ID: 'r1',
      TOPIC: 'Fourier transforms',
      LEVEL: 'advanced',
      DEPTH: '4',
      CHEAP: '1',
      MAX_NODES: '4',
      MAX_QUESTIONS: '3',
    });
    const { runId, request, options } = buildJobInput();
    expect(runId).toBe('r1');
    expect(request).toEqual({
      topic: 'Fourier transforms',
      settings: { level: 'advanced', depth: 4, audience: 'a self-taught learner' },
    });
    expect(options.maxNodes).toBe(4);
    expect(options.maxQuestions).toBe(3);
    expect(options.models).toBeDefined(); // CHEAP → cheapModels()
  });

  it('defaults level/depth/audience when unset', () => {
    Object.assign(process.env, { RUN_ID: 'r', TOPIC: 't' });
    const { request, options } = buildJobInput();
    expect(request.settings).toEqual({ level: 'intermediate', depth: 3, audience: 'a self-taught learner' });
    expect(options.models).toBeUndefined();
  });

  it('throws on a missing RUN_ID (never generated — a resume must reuse the same id)', () => {
    process.env.TOPIC = 't';
    expect(() => buildJobInput()).toThrow(/RUN_ID/);
  });

  it('throws on a missing TOPIC', () => {
    process.env.RUN_ID = 'r';
    expect(() => buildJobInput()).toThrow(/TOPIC/);
  });

  it('throws on an invalid MAX_NODES (a typo cannot silently cap to 0 after spend)', () => {
    Object.assign(process.env, { RUN_ID: 'r', TOPIC: 't', MAX_NODES: 'oops' });
    expect(() => buildJobInput()).toThrow(/MAX_NODES/);
  });
});
