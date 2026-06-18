import { describe, expect, it } from 'vitest';
import type { Provider } from './models';
import { resolveModel } from './registry';

describe('resolveModel', () => {
  it('returns a model for every provider without needing an API key', () => {
    const providers: Provider[] = ['anthropic', 'openai', 'google', 'local'];
    for (const provider of providers) {
      expect(resolveModel({ provider, model: 'some-model' })).toBeDefined();
    }
  });
});
