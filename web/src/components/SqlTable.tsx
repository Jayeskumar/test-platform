import type { Table } from '../lib/types';

export function SqlTable({ table, max = 50 }: { table: Table; max?: number }) {
  if (!table.columns.length) return <div className="text-xs text-ink-400">No columns returned.</div>;
  return (
    <div className="overflow-auto rounded-lg border border-ink-700">
      <table className="w-full text-xs">
        <thead className="bg-ink-800 text-ink-300">
          <tr>{table.columns.map((c, i) => <th key={i} className="px-2.5 py-1.5 text-left font-medium">{c}</th>)}</tr>
        </thead>
        <tbody className="font-mono">
          {table.rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-ink-800">
              {r.map((v, j) => <td key={j} className="px-2.5 py-1 text-ink-200">{v === null ? <span className="text-ink-500">NULL</span> : String(v)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > max && <div className="border-t border-ink-800 px-2.5 py-1 text-xs text-ink-400">… {table.rows.length - max} more rows</div>}
      {table.rows.length === 0 && <div className="px-2.5 py-2 text-xs text-ink-400">0 rows</div>}
    </div>
  );
}
