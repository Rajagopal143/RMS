import { useState } from "react";
import { Input } from "@workspace/ui/components/input";
import { formatMoney, ORDER_TYPE_LABEL, type OrderType } from "@workspace/shared";
import { useBootstrap } from "../lib/session";
import { todayIso, useApi, useRealtime } from "../lib/hooks";
import { ErrorNote, PageHeader, ColorDot } from "../components/bits";

interface Summary {
  orders: number;
  revenue: number;
  avgMinutes: number | null;
  expenses: number;
  byType: { type: OrderType; orders: number; revenue: number }[];
  byPayment: { mode: string | null; revenue: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
  byCategory: { categoryId: number | null; qty: number; avgCookMinutes: number | null }[];
}

export function DashboardPage() {
  const { data: setup } = useBootstrap();
  const [date, setDate] = useState(todayIso());
  const { data, error, reload } = useApi<Summary>(`/reports/summary?date=${date}`);
  useRealtime((e) => e.type !== "item.updated" && void reload());

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Sales report"
        description="Cancelled orders are left out."
        actions={<Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} className="w-44" />}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-3 [&>*]:bg-card">
            <Stat label="Sales" value={formatMoney(data.revenue)} />
            <Stat label="Expenses" value={formatMoney(data.expenses)} />
            <Stat label="Net" value={`${data.revenue - data.expenses < 0 ? "−" : ""}${formatMoney(Math.abs(data.revenue - data.expenses))}`} />
            <Stat label="Orders" value={String(data.orders)} />
            <Stat label="Average bill" value={data.orders ? formatMoney(Math.round(data.revenue / data.orders)) : "—"} />
            <Stat label="Order to handover" value={data.avgMinutes == null ? "—" : `${data.avgMinutes} min`} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel title="Best sellers">
              {data.topItems.length === 0 && <p className="text-sm text-muted-foreground">No orders on this day.</p>}
              {data.topItems.map((i, idx) => (
                <div key={i.name} className="flex items-baseline gap-3 py-1.5 text-sm">
                  <span className="tabular w-5 text-muted-foreground">{idx + 1}</span>
                  <span className="flex-1">{i.name}</span>
                  <span className="tabular">× {i.qty}</span>
                  <span className="tabular w-24 text-right">{formatMoney(i.revenue)}</span>
                </div>
              ))}
            </Panel>
            <div className="space-y-6">
              <Panel title="By order type">
                {data.byType.map((t) => (
                  <Line key={t.type} label={`${ORDER_TYPE_LABEL[t.type]} · ${t.orders}`} value={formatMoney(t.revenue)} />
                ))}
              </Panel>
              <Panel title="By payment">
                {data.byPayment.map((p) => (
                  <Line key={p.mode ?? "none"} label={(p.mode ?? "Not recorded").toUpperCase()} value={formatMoney(p.revenue)} />
                ))}
              </Panel>
              <Panel title="By category">
                {data.byCategory.map((s) => {
                  const category = setup!.categories.find((c) => c.id === s.categoryId);
                  return (
                    <div key={s.categoryId ?? "none"} className="flex items-center gap-2 py-1 text-sm">
                      <ColorDot color={category?.color ?? "#9aa0a6"} />
                      <span className="flex-1">{category?.name ?? "No category"}</span>
                      <span className="tabular">{s.qty} sold</span>
                      <span className="tabular w-28 text-right text-muted-foreground">
                        {s.avgCookMinutes == null ? "" : `avg ${s.avgCookMinutes} min`}
                      </span>
                    </div>
                  );
                })}
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
