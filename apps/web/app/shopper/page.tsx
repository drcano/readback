// /shopper — Maya delegates once. The agreement ID arrives in the URL (and a cookie) after PayPal.
import { ShopperFlow } from "@/components/ShopperFlow";
import { AppFooter, AppHeader } from "@/components/ui";

type Search = Promise<{ agreement?: string; cancelled?: string; error?: string }>;

export default async function ShopperPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const agreement = q.agreement && /^[0-9A-Za-z_-]{1,36}$/.test(q.agreement) ? q.agreement : null;
  const notice = q.cancelled ? "You cancelled on PayPal; nothing was set up." : q.error ? "PayPal approval didn't complete. Try again." : null;
  return (
    <>
      <AppHeader current="shopper" section="Shopper · Good Boy Provisions" />
      <main className="console narrow">
        <p className="cap">Delegate once</p>
        <h1>Let your AI keep Biscuit stocked</h1>
        <p className="lede">Approve once, within limits. Every purchase is signed by your agent and checked against what you approved.</p>
        <ShopperFlow agreement={agreement} notice={notice} />
      </main>
      <AppFooter />
    </>
  );
}
