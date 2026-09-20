import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import { api, formatMoney, type Plan, type RestaurantSummary, type Subscription } from "@workspace/shared";
import { useApi } from "../../lib/hooks";
import { ErrorNote, FormField, PageHeader } from "../../components/bits";

interface Stats {
  restaurants: number;
  active: number;
  expired: number;
  expiringSoon: number;
  revenue: number;
}

const blank = { name: "", phone: "", address: "", gstin: "", planId: "", ownerName: "", ownerEmail: "", ownerPassword: "" };

function daysLeft(sub: Subscription | null) {
  if (!sub) return null;
  return Math.ceil((new Date(sub.endsAt).getTime() - Date.now()) / 86_400_000);
}

export function RestaurantsPage() {
  const { data: list, error, reload } = useApi<RestaurantSummary[]>("/platform/restaurants");
  const { data: plans } = useApi<Plan[]>("/platform/plans");
  const { data: stats, reload: reloadStats } = useApi<Stats>("/platform/stats");
  const [creating, setCreating] = useState<typeof blank | null>(null);
  const [selected, setSelected] = useState<RestaurantSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await Promise.all([reload(), reloadStats()]);
  };

  async function create() {
    if (!creating) return;
    setBusy(true);
    try {
      await api("/platform/restaurants", {
        method: "POST",
        body: {
          name: creating.name,
          phone: creating.phone || null,
          address: creating.address || null,
          gstin: creating.gstin || null,
          planId: Number(creating.planId),
          owner: { name: creating.ownerName, email: creating.ownerEmail, password: creating.ownerPassword },
        },
      });
      toast.success(`${creating.name} is set up. Share the owner login with them.`);
      setCreating(null);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const activePlans = (plans ?? []).filter((p) => p.isActive);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Restaurants"
        description="Every restaurant on your platform, with its owner login and subscription."
        actions={
          <Button onClick={() => setCreating({ ...blank, planId: activePlans[0] ? String(activePlans[0].id) : "" })}>
            <Plus /> Add restaurant
          </Button>
        }
      />
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4 [&>*]:bg-card">
          <Stat label="Restaurants" value={stats.restaurants} />
          <Stat label="Active subscriptions" value={stats.active} />
          <Stat label="Expiring in 7 days" value={stats.expiringSoon} tone={stats.expiringSoon ? "warn" : undefined} />
          <Stat label="Subscription revenue" value={formatMoney(stats.revenue)} />
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Restaurant</TableHead>
              <TableHead>Owner login</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Subscription</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(list ?? []).map((r) => {
              const left = daysLeft(r.subscription);
              const live = r.subscription?.status === "active" && left !== null && left > 0;
              return (
                <TableRow key={r.id} className={cn(!r.isActive && "opacity-50")}>
                  <TableCell>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.address}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.ownerName}
                    <p className="text-xs text-muted-foreground">{r.ownerEmail}</p>
                  </TableCell>
                  <TableCell>{r.subscription?.planName ?? "—"}</TableCell>
                  <TableCell>
                    {!r.isActive ? (
                      <span className="text-sm text-muted-foreground">Restaurant disabled</span>
                    ) : live ? (
                      <span className={cn("text-sm", left! <= 7 && "font-semibold text-chili")}>
                        {left} days left
                      </span>
                    ) : (
                      <span className="rounded-full bg-chili/10 px-2 py-0.5 text-xs font-semibold text-chili">Expired</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setSelected(r)}>
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add restaurant</DialogTitle>
            <DialogDescription>Creates the restaurant, its owner login and the first subscription period.</DialogDescription>
          </DialogHeader>
          {creating && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Restaurant name" htmlFor="c-name">
                  <Input id="c-name" autoFocus value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
                </FormField>
                <FormField label="Phone" htmlFor="c-phone">
                  <Input id="c-phone" value={creating.phone} onChange={(e) => setCreating({ ...creating, phone: e.target.value })} />
                </FormField>
              </div>
              <FormField label="Address" htmlFor="c-addr">
                <Input id="c-addr" value={creating.address} onChange={(e) => setCreating({ ...creating, address: e.target.value })} />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="GSTIN" htmlFor="c-gst">
                  <Input id="c-gst" className="font-mono uppercase" value={creating.gstin} onChange={(e) => setCreating({ ...creating, gstin: e.target.value.toUpperCase() })} />
                </FormField>
                <FormField label="Plan" htmlFor="c-plan">
                  <NativeSelect id="c-plan" className="w-full" value={creating.planId} onChange={(e) => setCreating({ ...creating, planId: e.target.value })}>
                    {activePlans.map((p) => (
                      <NativeSelectOption key={p.id} value={p.id}>
                        {p.name} · {formatMoney(p.price)} / {p.durationDays} days
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
              <p className="border-t pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Owner login</p>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Owner name" htmlFor="c-oname">
                  <Input id="c-oname" value={creating.ownerName} onChange={(e) => setCreating({ ...creating, ownerName: e.target.value })} />
                </FormField>
                <FormField label="Owner email" htmlFor="c-oemail">
                  <Input id="c-oemail" type="email" value={creating.ownerEmail} onChange={(e) => setCreating({ ...creating, ownerEmail: e.target.value })} />
                </FormField>
              </div>
              <FormField label="Temporary password" htmlFor="c-opass" hint="At least 6 characters. Share it with the owner.">
                <Input id="c-opass" value={creating.ownerPassword} onChange={(e) => setCreating({ ...creating, ownerPassword: e.target.value })} />
              </FormField>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(null)}>
              Cancel
            </Button>
            <Button
              onClick={create}
              disabled={busy || !creating?.name.trim() || !creating?.planId || !creating?.ownerEmail || (creating?.ownerPassword.length ?? 0) < 6 || !creating?.ownerName}
            >
              Add restaurant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selected && <ManageDialog restaurant={selected} plans={activePlans} onClose={() => setSelected(null)} onChanged={refresh} />}
    </div>
  );
}

function ManageDialog({
  restaurant,
  plans,
  onClose,
  onChanged,
}: {
  restaurant: RestaurantSummary;
  plans: Plan[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { data: subs, reload } = useApi<Subscription[]>(`/platform/restaurants/${restaurant.id}/subscriptions`);
  const [planId, setPlanId] = useState(String(restaurant.subscription?.planId ?? plans[0]?.id ?? ""));
  const [password, setPassword] = useState("");
  const [isActive, setIsActive] = useState(restaurant.isActive);

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action();
      toast.success(message);
      await Promise.all([reload(), onChanged()]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const plan = plans.find((p) => String(p.id) === planId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{restaurant.name}</DialogTitle>
          <DialogDescription>
            Owner: {restaurant.ownerName} ({restaurant.ownerEmail})
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Renew or change plan</h3>
          <div className="flex gap-2">
            <NativeSelect className="w-full" value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Plan">
              {plans.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name} · {formatMoney(p.price)} / {p.durationDays} days
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              disabled={!plan}
              onClick={() =>
                run(
                  () => api(`/platform/restaurants/${restaurant.id}/subscriptions`, { method: "POST", body: { planId: Number(planId) } }),
                  `Added ${plan!.durationDays} days of ${plan!.name}`,
                )
              }
            >
              Add period
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">The new period starts when the current one ends, or today if it has already expired.</p>
        </section>

        <section className="max-h-52 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(subs ?? []).map((s) => (
                <TableRow key={s.id} className={s.status === "cancelled" ? "opacity-50" : ""}>
                  <TableCell>{s.planName}</TableCell>
                  <TableCell className="tabular text-xs">{new Date(s.startsAt).toLocaleDateString("en-IN")}</TableCell>
                  <TableCell className="tabular text-xs">{new Date(s.endsAt).toLocaleDateString("en-IN")}</TableCell>
                  <TableCell className="tabular text-right">{formatMoney(s.amount)}</TableCell>
                  <TableCell className="text-right">
                    {s.status === "active" && new Date(s.endsAt) > new Date() ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-chili"
                        onClick={() => confirm("Cancel this period? If it's the current one, the restaurant loses access.") && run(() => api(`/platform/subscriptions/${s.id}/cancel`, { method: "POST" }), "Period cancelled")}
                      >
                        Cancel
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{s.status === "cancelled" ? "Cancelled" : "Ended"}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section className="grid grid-cols-2 gap-4 border-t pt-4">
          <FormField label="Reset owner password" htmlFor="m-pass">
            <div className="flex gap-2">
              <Input id="m-pass" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button
                variant="outline"
                disabled={password.length < 6}
                onClick={() => run(() => api(`/platform/restaurants/${restaurant.id}/owner-password`, { method: "POST", body: { password } }), "Owner password changed").then(() => setPassword(""))}
              >
                Reset
              </Button>
            </div>
          </FormField>
          <FormField label="Access" hint="Disabling signs out everyone at this restaurant.">
            <Button
              variant={isActive ? "outline" : "default"}
              className={isActive ? "text-chili" : ""}
              onClick={() =>
                run(async () => {
                  await api(`/platform/restaurants/${restaurant.id}`, { method: "PATCH", body: { isActive: !isActive } });
                  setIsActive(!isActive);
                }, isActive ? "Restaurant disabled" : "Restaurant enabled")
              }
            >
              {isActive ? "Disable restaurant" : "Enable restaurant"}
            </Button>
          </FormField>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warn" }) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("tabular mt-1 text-2xl font-semibold", tone === "warn" && "text-chili")}>{value}</p>
    </div>
  );
}
