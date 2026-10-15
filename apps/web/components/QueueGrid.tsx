"use client";
// The investigator queue: "same claim, two verdicts" up top, then every open dispute in AG Grid
// Community (from Nov 1 the same columns and renderers move inside an AG Studio custom widget,
// SPEC §5.6). Themed from the shared design tokens.
import {
  CellStyleModule,
  ClientSideRowModelModule,
  type ColDef,
  type ICellRendererParams,
  NumberFilterModule,
  QuickFilterModule,
  RowStyleModule,
  TextFilterModule,
  themeQuartz,
} from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useEffect, useState } from "react";
import { claimQuote, reasonLabel, recommendation, stepTitle } from "@/lib/labels";
import type { QueueRow } from "@/lib/queue";
import { answer, FILTERS, type FilterId } from "@/lib/queue-filters";
import { RecPill, Steps } from "./ui";

const modules = [CellStyleModule, ClientSideRowModelModule, TextFilterModule, NumberFilterModule, QuickFilterModule, RowStyleModule];

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)",
  foregroundColor: "var(--ink)",
  backgroundColor: "var(--surface)",
  borderColor: "var(--rule)",
  accentColor: "var(--accent)",
  headerTextColor: "var(--ink-muted)",
  headerFontWeight: 700,
  headerFontSize: 12,
  headerBackgroundColor: "var(--surface)",
  rowHoverColor: "var(--hover)",
  fontSize: 14,
  rowHeight: 72,
  headerHeight: 44,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  cellHorizontalPadding: 20,
  columnBorder: false,
});

function ClaimCell({ data }: ICellRendererParams<QueueRow>) {
  if (!data) return null;
  return (
    <span className="claim-cell">
      <strong>{claimQuote(data.reason)}</strong>
      <small>
        <span className="mono">{data.id}</span>
        {data.source === "Live" ? <span className="live">LIVE</span> : <> · fixture</>}
      </small>
    </span>
  );
}
const StepsCell = ({ data }: ICellRendererParams<QueueRow>) => (data ? <Steps lights={data.lights} /> : null);
const RecCell = ({ data }: ICellRendererParams<QueueRow>) => (data ? <RecPill suggestion={data.suggestion} /> : null);
function DueCell({ data }: ICellRendererParams<QueueRow>) {
  if (!data?.due) return <span className="muted">{data?.stage === "CHARGEBACK" ? "Under PayPal review" : "—"}</span>;
  const due = new Date(data.due);
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  const date = due.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return <span>{days >= 0 ? `${date} · ${days} day${days === 1 ? "" : "s"}` : "Past due"}</span>;
}

const columns: ColDef<QueueRow>[] = [
  { field: "reason", headerName: "Dispute", cellRenderer: ClaimCell, flex: 2.2, minWidth: 260, getQuickFilterText: (p) => `${p.data?.id} ${reasonLabel(String(p.value))} ${claimQuote(String(p.value))}` },
  { headerName: "Evidence from PayPal", cellRenderer: StepsCell, flex: 2.6, minWidth: 420, sortable: false, filter: false, getQuickFilterText: (p) => p.data?.lights.map(stepTitle).join(" ") ?? "" },
  { field: "suggestion", headerName: "Recommendation", cellRenderer: RecCell, width: 200, getQuickFilterText: (p) => recommendation(p.value).label },
  { field: "amount", headerName: "Amount", width: 120, type: "rightAligned", filter: "agNumberColumnFilter", valueFormatter: (p) => (typeof p.value === "number" ? `$${p.value.toFixed(2)}` : ""), cellStyle: { fontWeight: 700 } },
  { field: "due", headerName: "Respond by", cellRenderer: DueCell, width: 190 },
];

const CHIPS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "merchant_should_lose", label: "Refund the buyer" },
  { id: "merchant_should_win", label: "Uphold the charge" },
  { id: "no_suggestion", label: "Needs review" },
  { id: "live_only", label: "Live from PayPal" },
];

// The demo's moment: the same "I didn't make this purchase" claim, one upheld, one refunded.
function Pair({ rows }: { rows: QueueRow[] }) {
  const claim = (r: QueueRow) => r.reason === "UNAUTHORISED";
  const uphold = rows.find((r) => claim(r) && r.suggestion === "SELLER_FAVOR");
  const refund = rows.find((r) => claim(r) && r.suggestion === "BUYER_FAVOR");
  if (!uphold || !refund) return null;
  const why = (r: QueueRow) => {
    const failed = r.lights.find((l) => l.state === "fail");
    return failed ? `${stepTitle(failed)}. The store charged her saved wallet on its own.` : "Her agent signed this exact order, inside the limits she approved on PayPal.";
  };
  return (
    <section className="card pair" aria-labelledby="pair-h">
      <div className="pair-head">
        <h2 id="pair-h">Same claim, two verdicts</h2>
        <span className="muted">Both shoppers say: <em>“I didn&apos;t make this purchase.”</em></span>
      </div>
      <div className="pair-grid">
        {[uphold, refund].map((r) => (
          <a key={r.id} className="pair-card" href={r.href}>
            <span className="pair-top">
              <RecPill suggestion={r.suggestion} />
              <span className="mono muted">{r.id} · ${r.amount.toFixed(2)}</span>
            </span>
            <p className="pair-why">{why(r)}</p>
            <Steps lights={r.lights} />
            <p className="pair-open">Open case →</p>
          </a>
        ))}
      </div>
    </section>
  );
}

export function QueueGrid() {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [question, setQuestion] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [reply, setReply] = useState<string | null>(null);

  async function ask() {
    const res = await fetch("/api/studio-agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok: boolean; filter?: FilterId; via?: string } | null;
    if (!body?.ok || !body.filter || !rows) return setReply("Couldn't answer that; try rephrasing.");
    setFilter(body.filter);
    setReply(`${answer(body.filter, rows).text} (filter chosen by ${body.via}; the filter itself is deterministic)`);
  }

  useEffect(() => {
    fetch("/api/queue")
      .then((r) => r.json() as Promise<{ rows: QueueRow[]; liveError: string | null }>)
      .then((q) => {
        setRows(q.rows);
        setNotice(q.liveError);
      })
      .catch(() => setNotice("Couldn't load the queue."));
  }, []);

  const count = (id: FilterId) => (rows ? rows.filter(FILTERS[id].match).length : 0);

  return (
    <>
      {notice && <p className="banner" role="status">{notice}</p>}
      {rows && <Pair rows={rows} />}

      <section aria-labelledby="queue-h">
        <div className="queue-head">
          <h2 id="queue-h">All open disputes</h2>
          <span className="muted">{rows ? `${rows.length} cases` : "Loading…"}</span>
          <div className="chips" role="group" aria-label="Filter by recommendation">
            {CHIPS.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={filter === c.id} onClick={() => { setFilter(c.id); setReply(null); }}>
                {c.label} · {count(c.id)}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar">
          <div className="toolbar-search">
            <label htmlFor="queue-search" className="sr-only">Search disputes</label>
            <input id="queue-search" type="search" className="field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search disputes…" />
          </div>
          <form className="toolbar-ask" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
            <label htmlFor="queue-ask" className="sr-only">Ask the queue</label>
            <input id="queue-ask" className="field" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask: which cases should the store lose?" maxLength={300} />
            <button type="submit" className="btn" disabled={question.trim().length < 2 || !rows}>Ask</button>
          </form>
        </div>
        {reply && <p role="status" className="reply">{reply}</p>}
        <div className="card grid-card">
          {rows === null ? (
            <div className="skeleton" aria-busy="true" aria-label="Fetching disputes from PayPal and running the checks">
              {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton-row" />)}
            </div>
          ) : (
            <AgGridProvider modules={modules}>
              <AgGridReact
                theme={theme}
                rowData={rows.filter(FILTERS[filter].match)}
                columnDefs={columns}
                defaultColDef={{ filter: false, suppressHeaderMenuButton: true }}
                quickFilterText={search}
                domLayout="autoHeight"
                onRowClicked={(e) => { if (e.data) window.location.href = e.data.href; }}
                rowClass="clickable-row"
                overlayNoRowsTemplate="No disputes match."
              />
            </AgGridProvider>
          )}
        </div>
        <p className="legend">✓ passed · ! partly verified · ✕ failed. Every result is rebuilt from PayPal&apos;s records and re-checked in your browser; Readback stores nothing.</p>
      </section>
    </>
  );
}
