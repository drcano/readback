// /investigator/[id] — the case view. A dispute ID, a capture ID ("check this charge"), or
// fixture-hero / fixture-twist. Labeled as a proposed workflow (SPEC §5.6 framing).
import { CaseView } from "@/components/CaseView";
import { AppFooter, AppHeader } from "@/components/ui";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <AppHeader />
      <main className="console">
        <a href="/investigator" className="crumb">← All disputes</a>
        <CaseView id={id} />
      </main>
      <AppFooter />
    </>
  );
}
