"use client";
// The investigator queue grid. AG Grid Community now; from Nov 1 the same columns and renderers
// move inside an AG Studio custom widget (SPEC §5.6). Themed from the shared design tokens.
import {
  ClientSideRowModelModule,
  type ColDef,
  ColumnAutoSizeModule,
  type ICellRendererParams,
  NumberFilterModule,
  QuickFilterModule,
  TextFilterModule,
  themeQuartz,
} from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useEffect, useState } from "react";
import type { QueueRow } from "@/lib/queue";
import { answer, FILTERS, type FilterId } from "@/lib/queue-filters";

const modules = [ClientSideRowModelModule, TextFilterModule, NumberFilterModule, QuickFilterModule, ColumnAutoSizeModule];

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)",
  foregroundColor: "var(--ink)",
  backgroundColor: "var(--surface)",
  borderColor: "var(--rule)",
  accentColor: "var(--accent)",
  headerTextColor: "var(--ink-muted)",
  headerFontWeight: 600,
});

const SYMBOL = { pass: "✓", caution: "!", fail: "✕" } as const;

// The four-light strip as a cell: letters + symbols, so it never relies on color alone.
function LightsCell({ data }: ICellRendererParams<QueueRow>) {
  if (!data) return null;
  return (
    <span className="lights-strip" aria-label={data.lights.map((l) => `${l.group} ${l.state}`).join(", ")}>
      {data.lights.map((l) => (
        <span key={l.group} className="state" data-state={l.state} title={l.summary}>
          {l.group[0]}
          {SYMBOL[l.state]}
        </span>
      ))}
    </span>
  );
}

function IdCell({ data }: ICellRendererParams<QueueRow>) {
  return data ? <a className="mono" href={data.href}>{data.id}</a> : null;
}

function DueCell({ data }: ICellRendererParams<QueueRow>) {
  if (!data?.due) return <span className="muted">—</span>;
  const days = Math.ceil((Date.parse(data.due) - Date.now()) / 86_400_000);
  return <span>{days >= 0 ? `${days} day${days === 1 ? "" : "s"} left` : "past due"}</span>;
}

const columns: ColDef<QueueRow>[] = [
  { field: "id", headerName: "Case", cellRenderer: IdCell, minWidth: 190 },
  { headerName: "Consent · Agent · Terms · Delivery", cellRenderer: LightsCell, minWidth: 230, sortable: false, filter: false },
  { field: "classification", headerName: "Classification", minWidth: 220 },
  { field: "suggestion", headerName: "Suggested outcome", valueFormatter: (p) => (p.value === "BUYER_FAVOR" ? "Buyer's favor" : p.value === "SELLER_FAVOR" ? "Seller's favor" : "None") },
  { field: "reason", headerName: "Reason" },
  { field: "amount", headerName: "Amount (USD)", filter: "agNumberColumnFilter", valueFormatter: (p) => (typeof p.value === "number" ? p.value.toFixed(2) : "") },
  { field: "due", headerName: "Deadline", cellRenderer: DueCell },
  { field: "source", headerName: "Source" },
  { field: "stage", headerName: "Stage" },
  { field: "failed", headerName: "Failed checks" },
  { field: "evidence", headerName: "Evidence" },
  { field: "note", headerName: "Note", minWidth: 220 },
];

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

  return (
    <>
      {notice && <p className="banner" role="status">{notice}</p>}
      <form className="ask" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <label htmlFor="queue-ask">Ask the queue</label>
        <input id="queue-ask" className="field" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. cases the merchant should lose · failed only on delivery · consent unverified" maxLength={300} />
        <button type="submit" disabled={question.trim().length < 2 || !rows}>Ask</button>{" "}
        {filter !== "all" && <button type="button" onClick={() => { setFilter("all"); setReply(null); }}>Show all</button>}
      </form>
      {reply && <p role="status">{reply}</p>}
      <label htmlFor="queue-search">Search cases</label>
      <input id="queue-search" type="search" className="field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. BUYER_FAVOR, UNAUTHORISED, Fixture" />
      <div className="grid-wrap">
        {rows === null ? (
          <p aria-busy="true">Fetching disputes from PayPal and running the checks…</p>
        ) : (
          <AgGridProvider modules={modules}>
            <AgGridReact theme={theme} rowData={rows.filter(FILTERS[filter].match)} columnDefs={columns} defaultColDef={{ filter: true }} quickFilterText={search} autoSizeStrategy={{ type: "fitCellContents" }} enableCellTextSelection />
          </AgGridProvider>
        )}
      </div>
    </>
  );
}
