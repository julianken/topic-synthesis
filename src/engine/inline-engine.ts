import type { Engine } from './engine';

/**
 * In-process Engine: memoizes each (name, key) for the lifetime of the instance, so
 * within one run a step is computed once and concurrent callers share the in-flight
 * result. A failed step is evicted so a retry re-runs it rather than replaying a cached
 * rejection. This is the test + local-dev engine; it is NOT durable across processes —
 * that is the durable `GcpEngine`'s job (a later PR).
 */
export class InlineEngine implements Engine {
  private readonly cache = new Map<string, Promise<unknown>>();

  step<O>(name: string, key: string, fn: () => Promise<O>): Promise<O> {
    const cacheKey = `${name}:${key}`;
    const existing = this.cache.get(cacheKey);
    if (existing) return existing as Promise<O>;
    const pending = fn();
    this.cache.set(cacheKey, pending);
    pending.catch(() => this.cache.delete(cacheKey));
    return pending;
  }
}
