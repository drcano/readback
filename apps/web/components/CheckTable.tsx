// The eleven checks (twelve rows: check 2 has parts a and b), grouped as in SPEC §5.6.
import type { CheckResult } from "@readback/core";

export function CheckTable({ checks }: { checks: CheckResult[] }) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="muted">
          Every check reads only PayPal objects, the terms Maya approved, and her agent's signature.
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Group</th>
            <th scope="col">Check</th>
            <th scope="col">Result</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => {
            const state = !c.pass ? "fail" : c.secondary || c.provisional ? "caution" : "pass";
            return (
              <tr key={c.id}>
                <td className="mono">{c.id}</td>
                <td>{c.group}</td>
                <td>{c.name}</td>
                <td>
                  <span className="state" data-state={state}>
                    {state === "pass" ? "Pass" : state === "fail" ? "Fail" : "Caution"}
                  </span>
                </td>
                <td>
                  {c.failures.map((f) => (
                    <div key={f.code + f.message}>
                      {f.message} <span className="mono muted">{f.code}</span>
                    </div>
                  ))}
                  {c.secondary && <div className="muted">Used the merchant's copy of the terms (secondary).</div>}
                  {c.provisional && <div className="muted">Provisional: history may lag up to 3 hours.</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
