// /investigator/[id] — the case view. A dispute ID, a capture ID ("check this charge"), or
// fixture-hero / fixture-twist. Labeled as a proposed workflow (SPEC §5.6 framing).
import { CaseView } from "@/components/CaseView";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <p className="label-chip">Proposed investigator workflow · results are re-derivable from PayPal, not independent</p>
      <CaseView id={id} />
    </main>
  );
}
