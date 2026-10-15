"use client";
// The investigator queue grid. AG Grid Community now; from Nov 1 the same columns and renderers
// move inside an AG Studio custom widget (SPEC §5.6). Themed from the shared design tokens.
import {
  CellStyleModule,
  ClientSideRowModelModule,
  type ColDef,
  type ICellRendererParams,
  NumberFilterModule,
  QuickFilterModule,
  RowStyleModule,
  TextFilterModule,
  TooltipModule,
  themeQuartz,
} from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useEffect, useState } from "react";
import type { QueueRow } from "@/lib/queue";
import { reasonLabel, stageLabel, verdictLabel } from "@/lib/labels";
import { answer, FILTERS, type FilterId } from "@/lib/queue-filters";
import { LightDots, VerdictPill } from "./ui";

const modules = [CellStyleModule, ClientSideRowModelModule, TextFilterModule, NumberFilterModule, QuickFilterModule, RowStyleModule, TooltipModule];

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)",
  foregroundColor: "var(--ink)",
  backgroundColor: "var(--surface)",
  borderColor: "var(--rule)",
  accentColor: "var(--accent)",
  headerTextColor: "var(--ink-muted)",
  headerFontWeight: 600,
  headerBackgroundColor: "var(--paper)",
  rowHoverColor: "var(--hover)",
  fontSize: 14,
  rowHeight: 48,
  headerHeight: 40,
  wrapperBorderRadius: 6,
  cellHorizontalPadding: 14,
});

// Columns an investigator scans first. Stage, failed checks, evidence and note stay in the row
// data (the Ask filters read them) but are hidden to keep the grid scannable.
const columns: ColDef<QueueRow>[] = [
  { field: "id", headerName: "Case", cellRenderer: IdCell, minWidth: 200, flex: 1.2 },
  { headerName: "C · A · T · D", headerTooltip: "Consent · Agent · Terms · Delivery", cellRenderer: LightsCell, width: 150, sortable: false, filter: false },
  { field: "suggestion", headerName: "Verdict", cellRenderer: VerdictCell, width: 170, getQuickFilterText: (p) => verdictLabel(p.value) },
  { field: "classification", headerName: "Why", flex: 1.5, minWidth: 200 },
  { field: "reason", headerName: "Claim", width: 170, valueFormatter: (p) => reasonLabel(String(p.value ?? "")) },
  { field: "amount", headerName: "Amount", width: 120, type: "rightAligned", filter: "agNumberColumnFilter", valueFormatter: (p) => (typeof p.value === "number" ? `$${p.value.toFixed(2)}` : "") },
  { field: "due", headerName: "Deadline", cellRenderer: DueCell, width: 130 },
  { field: "source", headerName: "Source", cellRenderer: SourceCell, width: 110 },
  { field: "stage", headerName: "Stage", hide: true, valueFormatter: (p) => stageLabel(String(p.value ?? "")) },
  { field: "failed", headerName: "Failed checks", hide: true },
  { field: "evidence", headerName: "Evidence", hide: true },
  { field: "note", headerName: "Note", hide: true },
];

function LightsCell({ data }: ICellRendererParams<QueueRow>) {
  return data ? <LightDots lights={data.lights} /> : null;
}

function IdCell({ data }: ICellRendererParams<QueueRow>) {
  return data ? <a className="mono case-link" href={data.href}>{data.id}</a> : null;
}

function VerdictCell({ data }: ICellRendererParams<QueueRow>) {
  return data ? <VerdictPill suggestion={data.suggestion} /> : null;
}

function SourceCell({ data }: ICellRendererParams<QueueRow>) {
  return data ? <span className="tag" data-source={data.source}>{data.source}</span> : null;
}

function DueCell({ data }: ICellRendererParams<QueueRow>) {
  if (!data?.due) return <span className="muted">—</span>;
  const days = Math.ceil((Date.parse(data.due) - Date.now()) / 86_400_000);
  return <span>{days >= 0 ? `${days} day${days === 1 ? "" : "s"} left` : "past due"}</span>;
}

// The summary strip doubles as the quick filters.
const STRIP: { id: FilterId; label: string }[] = [
  { id: "all", label: "Open cases" },
  { id: "merchant_should_lose", label: "Buyer's favor" },
  { id: "merchant_should_win", label: "Seller's favor" },
  { id: "no_suggestion", label: "No suggestion" },
  { id: "live_only", label: "Live from PayPal" },
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

  const count = (id: FilterId) => (rows ? rows.filter(FILTERS[id].match).length : null);

  return (
    <>
      {notice && <p className="banner" role="status">{notice}</p>}
      <div className="stats" role="group" aria-label="Filter the queue">
        {STRIP.map((f) => (
          <button key={f.id} type="button" className="stat" aria-pressed={filter === f.id} data-filter={f.id} onClick={() => { setFilter(f.id); setReply(null); }}>
            <span className="stat-value">{count(f.id) ?? "–"}</span>
            <span className="stat-label">{f.label}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div className="toolbar-search">
          <label htmlFor="queue-search" className="sr-only">Search cases</label>
          <input id="queue-search" type="search" className="field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cases, claims, verdicts…" />
        </div>
        <form className="toolbar-ask" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
          <label htmlFor="queue-ask" className="sr-only">Ask the queue</label>
          <input id="queue-ask" className="field" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask: cases the merchant should lose" maxLength={300} />
          <button type="submit" className="btn" disabled={question.trim().length < 2 || !rows}>Ask</button>
        </form>
      </div>
      {reply && <p role="status" className="reply">{reply}</p>}
      <div className="grid-wrap">
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
              defaultColDef={{ filter: true }}
              quickFilterText={search}
              domLayout="autoHeight"
              enableCellTextSelection
              onRowClicked={(e) => { if (e.data && !(e.event?.target instanceof HTMLAnchorElement)) window.location.href = e.data.href; }}
              rowClass="clickable-row"
              overlayNoRowsTemplate="No cases match."
            />
          </AgGridProvider>
        )}
      </div>
    </>
  );
}
