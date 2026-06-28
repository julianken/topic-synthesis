import { describe, expect, it } from 'vitest';
import { buildLedger, buildResearchGraph, sourceHost } from './research-graph';
import type { RailStage } from './stage-rail';
import type { ResearchEvent } from '../../../store/repo';

// A minimal ResearchEvent builder for the derivation tests (mirrors the status poll's `research` shape).
function rev(over: Partial<ResearchEvent> = {}): ResearchEvent {
  return {
    question: 'A question?',
    subtopic: null,
    status: 'pending',
    findings: [],
    sources: [],
    findingCount: null,
    startedAt: '2026-06-21T00:00:00.000Z',
    finishedAt: null,
    ...over,
  };
}

function rail(name: string, state: RailStage['state']): RailStage {
  return { name, label: name, state, event: null };
}

// ── buildResearchGraph — the plan → questions → brief DAG ─────────────────────────────────────────────
describe('buildResearchGraph — the research DAG (live-research generating Stage 2)', () => {
  it('degrades to an honest PLAN→BRIEF spine when the feed is empty (no fabricated graph)', () => {
    const g = buildResearchGraph([], rail('plan', 'running'), undefined);
    expect(g.research).toEqual([]);
    expect(g.researchCount).toBe(0);
    expect(g.edges).toEqual([]);
    expect(g.plan.kind).toBe('plan');
    expect(g.brief.kind).toBe('brief');
    // The plan node reflects the rail's plan state; the brief defaults to pending with no brief stage.
    expect(g.plan.state).toBe('running');
    expect(g.brief.state).toBe('pending');
  });

  it('maps each ResearchEvent to a research node with the REAL question as its title', () => {
    const research = [
      rev({ question: 'Where does a plant’s mass come from?', status: 'done', findingCount: 2 }),
      rev({ question: 'Light reactions vs. the Calvin cycle?', status: 'done', findingCount: 1 }),
      rev({ question: 'Chlorophyll’s role in capturing light?', status: 'pending' }),
    ];
    const g = buildResearchGraph(research, rail('plan', 'done'), rail('brief', 'running'));
    expect(g.researchCount).toBe(3);
    expect(g.research.map((n) => n.title)).toEqual([
      'Where does a plant’s mass come from?',
      'Light reactions vs. the Calvin cycle?',
      'Chlorophyll’s role in capturing light?',
    ]);
    expect(g.research.map((n) => n.kind)).toEqual(['research', 'research', 'research']);
  });

  it('derives node state: done→done, pending→running (extracting), error→error', () => {
    const research = [
      rev({ status: 'done' }),
      rev({ status: 'pending' }),
      rev({ status: 'error' }),
    ];
    const g = buildResearchGraph(research, rail('plan', 'done'), undefined);
    expect(g.research.map((n) => n.state)).toEqual(['done', 'running', 'error']);
  });

  it("a pending research node reads 'extracting claims…'; a done one reads its finding count", () => {
    const g = buildResearchGraph(
      [rev({ status: 'done', findingCount: 2 }), rev({ status: 'pending' }), rev({ status: 'done', findingCount: 1 })],
      rail('plan', 'done'),
      undefined,
    );
    expect(g.research[0]!.detail).toBe('2 findings');
    expect(g.research[1]!.detail).toBe('extracting claims…');
    expect(g.research[2]!.detail).toBe('1 finding'); // singular
  });

  it("the plan node's detail counts the announced questions once they land", () => {
    const g = buildResearchGraph([rev(), rev(), rev()], rail('plan', 'done'), undefined);
    expect(g.plan.detail).toBe('3 questions');
  });

  it('connects plan→each research and each research→brief; an edge activates when its source ran', () => {
    const research = [rev({ status: 'done' }), rev({ status: 'pending' })];
    const g = buildResearchGraph(research, rail('plan', 'done'), undefined);
    // 2 plan→rᵢ edges + 2 rᵢ→brief edges.
    expect(g.edges).toHaveLength(4);
    const planEdges = g.edges.filter((e) => e.from === 'plan');
    expect(planEdges).toHaveLength(2);
    // plan ran → both plan→rᵢ edges are active.
    expect(planEdges.every((e) => e.active)).toBe(true);
    // only the DONE research node's →brief edge is active.
    const briefEdges = g.edges.filter((e) => e.to === 'brief');
    expect(briefEdges.map((e) => e.active)).toEqual([true, false]);
  });

  it('falls back to pending plan/brief state when no rail stage is provided', () => {
    const g = buildResearchGraph([rev()], undefined, undefined);
    expect(g.plan.state).toBe('pending');
    expect(g.brief.state).toBe('pending');
  });
});

// ── buildLedger — the LIVE RESEARCH panel contents ───────────────────────────────────────────────────
describe('buildLedger — the live-research panel (Figma 1:2 ledger)', () => {
  it('counts done / total and flattens grounded findings, newest research first', () => {
    const research = [
      rev({
        status: 'done',
        findingCount: 1,
        findings: [{ claim: 'A tree’s mass comes mostly from CO₂ in the air.', url: 'https://www.britannica.com/x', title: 'Britannica' }],
      }),
      rev({
        status: 'pending',
        findings: [{ claim: 'Chlorophyll absorbs red & blue light.', url: 'https://khanacademy.org/y', title: 'Khan' }],
      }),
    ];
    const led = buildLedger(research);
    expect(led.extracted).toBe(1);
    expect(led.total).toBe(2);
    // Newest research (the still-extracting question, index 1) leads.
    expect(led.findings.map((f) => f.claim)).toEqual([
      'Chlorophyll absorbs red & blue light.',
      'A tree’s mass comes mostly from CO₂ in the air.',
    ]);
    expect(led.findings[0]!.extracting).toBe(true);
    expect(led.findings[1]!.extracting).toBe(false);
  });

  it('reduces each source to its bare display host (copy-safe — never the raw URL)', () => {
    const led = buildLedger([
      rev({
        status: 'done',
        findings: [{ claim: 'c', url: 'https://www.nature.com/articles/abc?utm=1', title: 'Nature' }],
      }),
    ]);
    expect(led.findings[0]!.host).toBe('nature.com');
  });

  it('falls back to the source TITLE when the URL is unusable, then to nothing', () => {
    const led = buildLedger([
      rev({
        status: 'done',
        findings: [
          { claim: 'has title', url: 'not a url', title: 'Some Source' },
          { claim: 'has nothing', url: '', title: '   ' },
        ],
      }),
    ]);
    const byClaim = Object.fromEntries(led.findings.map((f) => [f.claim, f.host]));
    expect(byClaim['has title']).toBe('Some Source');
    expect(byClaim['has nothing']).toBe('');
  });

  it('never emits an empty-claim row', () => {
    const led = buildLedger([
      rev({ status: 'done', findings: [{ claim: '   ', url: 'https://x.com', title: 'X' }] }),
    ]);
    expect(led.findings).toEqual([]);
  });

  it('an empty feed yields a zero count and no findings (the honest minimal state)', () => {
    const led = buildLedger([]);
    expect(led).toEqual({ extracted: 0, total: 0, findings: [] });
  });
});

// ── sourceHost — the copy-appropriateness host reducer ───────────────────────────────────────────────
describe('sourceHost — copy-safe host reduction', () => {
  it('drops the scheme and a leading www.', () => {
    expect(sourceHost('https://www.britannica.com/science/photosynthesis')).toBe('britannica.com');
    expect(sourceHost('http://nature.com/x')).toBe('nature.com');
    expect(sourceHost('https://en.wikipedia.org/wiki/Y')).toBe('en.wikipedia.org');
  });

  it('returns empty string for a malformed/empty URL (caller falls back)', () => {
    expect(sourceHost('')).toBe('');
    expect(sourceHost(null)).toBe('');
    expect(sourceHost(undefined)).toBe('');
    expect(sourceHost('just text')).toBe('');
  });
});
