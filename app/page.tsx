import { loadContractsFromSheet1Csv } from "@/lib/field-of-honour/contracts";
import { ROLE_PRIORITY } from "@/lib/field-of-honour/priorities";

export default function Home() {
  const contracts = loadContractsFromSheet1Csv("data/contracts-sheet1.csv");
  const roleEntries = Object.entries(ROLE_PRIORITY).sort((a, b) => a[1] - b[1]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Free Companies - Reduced Core</h1>
        <p className="mt-2 text-sm text-zinc-700">
          Retained modules: contract loading, role definitions with priority, and tracking utilities.
        </p>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Contracts Loaded</h2>
        <p className="mt-2 text-sm text-zinc-700">
          Loaded <span className="font-semibold">{contracts.length}</span> contracts from
          data/contracts-sheet1.csv.
        </p>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Role Priority</h2>
        <ol className="mt-3 list-inside list-decimal space-y-1 text-sm text-zinc-800">
          {roleEntries.map(([role, priority]) => (
            <li key={role}>
              {priority}. {role}
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Tracking Logic</h2>
        <p className="mt-2 text-sm text-zinc-700">
          Tracking utilities are available in lib/field-of-honour/tracking.ts for round metrics
          snapshots and cumulative role-selection history.
        </p>
      </section>
    </main>
  );
}
