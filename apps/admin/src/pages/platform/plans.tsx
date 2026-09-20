import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { api, formatMoney, type Plan } from "@workspace/shared";
import { toPaise, toRupees, useApi } from "../../lib/hooks";
import { ErrorNote, FormField, PageHeader } from "../../components/bits";

interface Draft {
  id?: number;
  name: string;
  price: string;
  durationDays: string;
  maxStaff: string;
  isActive: boolean;
}

export function PlansPage() {
  const { data: plans, error, reload } = useApi<Plan[]>("/platform/plans");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft) return;
    setBusy(true);
    const body = {
      name: draft.name,
      price: toPaise(draft.price),
      durationDays: Number(draft.durationDays),
      maxStaff: Number(draft.maxStaff),
      isActive: draft.isActive,
    };
    try {
      if (draft.id) await api(`/platform/plans/${draft.id}`, { method: "PATCH", body });
      else await api("/platform/plans", { method: "POST", body });
      toast.success(draft.id ? "Plan saved" : `Added ${draft.name}`);
      setDraft(null);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Subscription plans"
        description="What restaurants pay you. Changing a plan's price only affects new periods."
        actions={
          <Button onClick={() => setDraft({ name: "", price: "", durationDays: "30", maxStaff: "10", isActive: true })}>
            <Plus /> Add plan
          </Button>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="grid gap-4 md:grid-cols-3">
        {(plans ?? []).map((p) => (
          <div key={p.id} className={cn("ticket px-5 pb-6 pt-4", !p.isActive && "opacity-50")} style={{ ["--ticket-accent" as string]: "var(--color-turmeric)" }}>
            <div className="flex items-start justify-between">
              <p className="font-display text-2xl font-semibold">{p.name}</p>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={`Edit ${p.name}`}
                onClick={() => setDraft({ id: p.id, name: p.name, price: toRupees(p.price), durationDays: String(p.durationDays), maxStaff: String(p.maxStaff), isActive: p.isActive })}
              >
                <Pencil className="size-4" />
              </Button>
            </div>
            <p className="mt-2 text-3xl font-bold">{formatMoney(p.price)}</p>
            <p className="text-sm text-muted-foreground">for {p.durationDays} days</p>
            <hr className="ticket-rule my-3" />
            <p className="text-sm">Up to {p.maxStaff} staff logins</p>
            {!p.isActive && <p className="mt-1 text-xs text-chili">Hidden from new sign-ups</p>}
          </div>
        ))}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit plan" : "Add plan"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <FormField label="Name" htmlFor="pl-name">
                <Input id="pl-name" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </FormField>
              <div className="grid grid-cols-3 gap-3">
                <FormField label="Price (₹)" htmlFor="pl-price">
                  <Input id="pl-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d.]/g, "") })} />
                </FormField>
                <FormField label="Days" htmlFor="pl-days">
                  <Input id="pl-days" inputMode="numeric" value={draft.durationDays} onChange={(e) => setDraft({ ...draft, durationDays: e.target.value.replace(/\D/g, "") })} />
                </FormField>
                <FormField label="Staff logins" htmlFor="pl-staff">
                  <Input id="pl-staff" inputMode="numeric" value={draft.maxStaff} onChange={(e) => setDraft({ ...draft, maxStaff: e.target.value.replace(/\D/g, "") })} />
                </FormField>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} /> Offer to new restaurants
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !draft?.name.trim() || !draft?.price || !Number(draft?.durationDays) || !Number(draft?.maxStaff)}>
              {draft?.id ? "Save plan" : "Add plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
