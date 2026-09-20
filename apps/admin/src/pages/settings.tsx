import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { api, formatMoney, type Subscription } from "@workspace/shared";
import { useBootstrap } from "../lib/session";
import { useApi } from "../lib/hooks";
import { FormField, PageHeader } from "../components/bits";

export function SettingsPage() {
  const { data, reload } = useBootstrap();
  const r = data!.restaurant;
  const [form, setForm] = useState({ name: r.name, phone: r.phone ?? "", address: r.address ?? "", gstin: r.gstin ?? "" });
  const [busy, setBusy] = useState(false);
  const { data: subs } = useApi<Subscription[]>("/subscription");

  async function save() {
    setBusy(true);
    try {
      await api("/restaurant", { method: "PATCH", body: form });
      toast.success("Restaurant details saved");
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = data!.subscription;
  const daysLeft = current ? Math.ceil((new Date(current.endsAt).getTime() - Date.now()) / 86_400_000) : 0;

  return (
    <div className="grid max-w-5xl gap-8 lg:grid-cols-[1fr_340px]">
      <div>
        <PageHeader title="Restaurant" description="These details print at the top of every customer bill." />
        <div className="grid gap-4 rounded-lg border bg-card p-5">
          <FormField label="Restaurant name" htmlFor="r-name">
            <Input id="r-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="Address" htmlFor="r-addr">
            <Input id="r-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Phone" htmlFor="r-phone">
              <Input id="r-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </FormField>
            <FormField label="GSTIN" htmlFor="r-gst">
              <Input id="r-gst" className="font-mono uppercase" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
            </FormField>
          </div>
          <div>
            <Button onClick={save} disabled={busy || !form.name.trim()}>
              Save details
            </Button>
          </div>
        </div>
      </div>

      <aside className="pt-2">
        <div className="ticket px-5 pb-6 pt-4" style={{ ["--ticket-accent" as string]: daysLeft <= 7 ? "var(--color-chili)" : "var(--color-basil)" }}>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Subscription</p>
          <p className="mt-1 font-display text-2xl font-semibold">{current?.planName ?? "None"}</p>
          {current && (
            <p className="mt-1 text-sm">
              {daysLeft} {daysLeft === 1 ? "day" : "days"} left · renews by {new Date(current.endsAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}
            </p>
          )}
          <hr className="ticket-rule my-3" />
          <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">History</p>
          {(subs ?? [])
            .slice()
            .reverse()
            .map((s) => (
              <div key={s.id} className="flex justify-between py-0.5 text-xs">
                <span>
                  {s.planName} · {new Date(s.startsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                </span>
                <span>{s.status === "cancelled" ? "cancelled" : formatMoney(s.amount)}</span>
              </div>
            ))}
          <p className="mt-3 font-sans text-xs text-muted-foreground">To renew or change plan, contact your RMS provider.</p>
        </div>
      </aside>
    </div>
  );
}
