/**
 * The structured-log `EventSink`: writes one single-line JSON object per event to stdout, which Cloud
 * Run forwards to Cloud Logging as a parsed `jsonPayload` entry — the durable surface #167's
 * log-based metrics extract from. Fence-clean (console only). Construct ONE per run and share it
 * across the engine (lifecycle), the span bridge (`llm.call`), and run-job (`run.*`) so `seq` is
 * monotonic across the whole run's stream.
 */
import { EVENT_SCHEMA_VERSION, type EventSink, type WorkflowEvent } from './events';

export class StdoutEventSink implements EventSink {
  private seq = 0;

  /** `out` is injectable so tests capture lines instead of asserting on the real console. */
  constructor(
    private readonly runId: string,
    private readonly out: (line: string) => void = (line) => console.log(line),
  ) {}

  onEvent(event: WorkflowEvent): void {
    const severity =
      event.eventType === 'run.failed' || (event.eventType === 'step.finish' && event.status === 'error')
        ? 'ERROR'
        : 'INFO';
    // Envelope first, then the event's own fields. `eventType` (in the spread) is the metric filter key.
    this.out(
      JSON.stringify({
        runId: this.runId,
        seq: this.seq++,
        schemaVersion: EVENT_SCHEMA_VERSION,
        severity,
        ...event,
      }),
    );
  }
}
