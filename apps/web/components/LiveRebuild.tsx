// The case rebuilt live from PayPal: each record appears as the server reads it (lib/case-stream),
// then the browser re-checks every step. It shows that Readback stores nothing: every case is
// read fresh from PayPal, and this list is that read happening.
import type { CaseRecord } from "@/lib/case-stream";

const took = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const outcome = (status: number) => (status === 200 ? "✓" : status === 404 ? "✕ not at PayPal" : `! HTTP ${status}`);

export function RecordList({ records }: { records: CaseRecord[] }) {
  return (
    <ol className="rebuild" aria-label="PayPal records read for this case">
      {records.map((r, i) => (
        <li key={i}>
          <span className="rb-label">{r.label}</span>
          <span className="rb-api">{r.api}</span>
          <span className="mono">{r.id}</span>
          <span className="rb-ok" data-ok={r.status === 200}>{outcome(r.status)} {took(r.ms)}</span>
        </li>
      ))}
    </ol>
  );
}

export function LiveRebuild({ records, verifying, fixture }: { records: CaseRecord[]; verifying: boolean; fixture: boolean }) {
  const status = fixture ? "Building the labeled example in your browser…"
    : verifying ? "Re-checking every step in your browser…"
    : `Read ${records.length} PayPal record${records.length === 1 ? "" : "s"}; asking for the next…`;
  return (
    <section className="card rebuild-card" aria-labelledby="rebuild-h" aria-busy="true">
      <h1 id="rebuild-h">Rebuilding the case from PayPal&apos;s records</h1>
      <p className="muted small">Readback stores nothing, so every case is read fresh from PayPal.</p>
      {records.length > 0 && <RecordList records={records} />}
      <p role="status" className="rb-wait">{status}</p>
    </section>
  );
}

// Once loaded, the same list stays one click away under "How we know": the case's provenance.
export function RebuiltSummary({ records, ms }: { records: CaseRecord[]; ms: number }) {
  return (
    <details className="rebuilt">
      <summary>Rebuilt live from {records.length} PayPal record{records.length === 1 ? "" : "s"} in {took(ms)}, and stored nowhere</summary>
      <RecordList records={records} />
    </details>
  );
}
