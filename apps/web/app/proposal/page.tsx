// /proposal — the approval-page concept: what we propose PayPal's own approval page show
// (docs/PROPOSAL-agent-terms.md). Built from the terms PayPal stores for Maya's agreement, read live.
// It's a concept, labeled on the mock itself so a crop can't lose the label. Not a PayPal page.
import { formatCents, groupFingerprint } from "@readback/core";
import { headers } from "next/headers";
import { AppFooter, AppHeader } from "@/components/ui";
import { allowLookup, ipFrom } from "@/lib/budget";
import { CATALOG } from "@/lib/catalog";
import { approvalConcept } from "@/lib/concept";
import { paypalClient } from "@/lib/paypal/client";
import { cadence } from "@/lib/readback-card";

export const dynamic = "force-dynamic"; // reads PayPal per request, never at build

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function ProposalPage() {
  const configured = Boolean(process.env["PAYPAL_CLIENT_ID"] && process.env["PAYPAL_CLIENT_SECRET"]);
  // One PayPal read per view, rate-limited like every public route that calls PayPal (T25).
  const budget = allowLookup(ipFrom(await headers()));
  const c = await approvalConcept(configured && budget.ok ? paypalClient() : null, process.env["HERO_AGREEMENT_ID"], new Date());
  const t = c.terms;
  const runtime = process.env["AGENT_RUNTIME_URL"];
  const agentHost = (runtime && URL.canParse(runtime) && new URL(runtime).host) || "maya-agent.example";

  return (
    <>
      <AppHeader section="A proposal to PayPal" />
      <main className="console narrow">
        <p className="cap">Concept · proposed to PayPal · not a PayPal page</p>
        <h1>What PayPal&apos;s approval page could show</h1>
        <p className="lede">
          Today Maya checks her agent&apos;s fingerprint against a line the shop writes. We propose that PayPal show the terms it actually stores,
          with the agent&apos;s key fetched by PayPal itself. Everything below is built from the terms PayPal holds for her agreement.
        </p>
        <p className="muted small">
          {c.source === "live"
            ? <>Terms read live from PayPal: agreement <span className="mono">{c.tokenId}</span>, stored at her approval and unchangeable since.</>
            : <>Example terms from the labeled hero fixture (agreement <span className="mono">{c.tokenId}</span>); the hosted demo reads Maya&apos;s real agreement.</>}
        </p>

        <section className="card concept-today" aria-labelledby="today-h">
          <h2 id="today-h">Today, on PayPal&apos;s sandbox</h2>
          <p>PayPal&apos;s page shows one line: the plan name. The shop writes it, and PayPal doesn&apos;t store it.</p>
          <blockquote className="today-line"><strong>Set up recurring payments</strong> to {t.merchant}: {c.today}</blockquote>
          <p>The terms PayPal does store are never shown to her:</p>
          <pre className="mono stored">{c.stored}</pre>
          <p className="muted small">
            So a dishonest shop could put her agent&apos;s fingerprint in that line and its own key in the stored terms (threat T21), and nothing in
            PayPal&apos;s records would show the difference.
          </p>
        </section>

        <div className="concept-grid">
          <figure className="mock" aria-labelledby="mock-cap">
            <p className="mock-flag">Concept · not a PayPal page</p>
            <h2>Approve payments by your shopping agent</h2>
            <p className="mock-to">to {t.merchant}</p>
            <dl className="mock-terms">
              <dt>Your agent <sup>1</sup></dt><dd className="mono">{agentHost}</dd>
              <dt>Agent key <sup>2</sup></dt><dd className="mono mock-key">{groupFingerprint(t.fingerprint)}</dd>
              <dt>It may buy <sup>3</sup></dt><dd>Up to {t.qty} × {CATALOG[t.sku]?.name ?? t.sku} per order</dd>
              <dt>Spending limit</dt><dd>${formatCents(t.capCents)} per order</dd>
              <dt>How often</dt><dd>At most {cadence(t.periodDays)}</dd>
              <dt>Dates</dt><dd>{day(t.start)} to {day(t.end)}</dd>
              <dt>Unsigned charges <sup>4</sup></dt><dd>Refused. Every charge must be signed with this key.</dd>
            </dl>
            <p className="mock-note">
              PayPal keeps these terms with your agreement, even after you cancel <sup>5</sup>. The store can&apos;t change them, and PayPal checks
              every charge against them.
            </p>
            <p className="mock-actions" aria-hidden="true"><span className="btn btn-primary">Agree and continue</span><span className="btn">Cancel</span></p>
            <figcaption id="mock-cap">Concept: Maya&apos;s agreement as PayPal&apos;s own approval page could show it. The buttons are illustrative.</figcaption>
          </figure>

          <section className="card field-legend" aria-labelledby="legend-h">
            <h2 id="legend-h">Where each line comes from</h2>
            <ol>
              <li><code>agent_terms.agent.jwk_uri</code>. PayPal fetches the agent&apos;s key itself; the shop never supplies it. The domain shows her which agent she&apos;s trusting. {runtime ? "Here, it's this demo's agent runtime." : "Here, a placeholder: no agent runtime is configured."}</li>
              <li><code>agent_key_thumbprint</code>. PayPal computes it from that key (RFC 7638) and shows all 16 characters, grouped. Her agent shows the same characters.</li>
              <li><code>constraints</code>: items, the maximum per order, the period, and the dates. PayPal renders them in its own words, instead of a line the shop wrote.</li>
              <li><code>require_agent_mandate</code>. PayPal refuses an unsigned charge when it&apos;s made, as it refuses charges on a cancelled agreement today.</li>
              <li><code>deleted_at</code>. The terms stay on the payment token after she cancels, so a later dispute can still read them.</li>
            </ol>
            <p className="muted small">
              Field names are illustrative, as in the proposal. The smallest step needs no new field: PayPal&apos;s page could show the stored terms above, as they are.
            </p>
          </section>
        </div>

        <p className="muted small concept-foot">
          Readback&apos;s shopper page never shows the fingerprint, because the shop isn&apos;t the one to vouch for her agent. Today she compares her
          agent&apos;s fingerprint with PayPal&apos;s page. With this change, PayPal would fetch the key itself and check every charge against it.
        </p>
      </main>
      <AppFooter />
    </>
  );
}
