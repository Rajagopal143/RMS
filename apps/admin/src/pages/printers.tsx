import { useEffect, useState } from "react";
import { Bluetooth, Network, Pencil, Plus, Printer as PrinterIcon, RefreshCw, Trash2, Usb } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { api, type Printer, type PrinterConnection, type PrintDocument } from "@workspace/shared";
import { useBootstrap } from "../lib/session";
import { desktop } from "../lib/desktop";
import { autoPrintWaiterKot, printDocument, setAutoPrintWaiterKot } from "../lib/print";
import { EmptyState, FormField, PageHeader, ColorDot } from "../components/bits";

const CONNECTIONS: { id: PrinterConnection; label: string; icon: LucideIcon; hint: string }[] = [
  { id: "usb", label: "USB", icon: Usb, hint: "Plugged into this computer and installed in the OS." },
  { id: "network", label: "Network (LAN / Wi-Fi)", icon: Network, hint: "Thermal printer with an IP address, port 9100." },
  { id: "bluetooth", label: "Bluetooth", icon: Bluetooth, hint: "Paired with this computer; shows up as a serial port." },
];

interface Draft {
  id?: number;
  name: string;
  connection: PrinterConnection;
  address: string;
  paperWidth: 58 | 80;
  purpose: "kot" | "bill";
  categoryIds: number[];
  isActive: boolean;
}

function testDocument(name: string): PrintDocument {
  return {
    title: `Test ${name}`,
    lines: [
      { kind: "text", text: "RMS TEST PRINT", align: "center", bold: true, large: true },
      { kind: "divider" },
      { kind: "row", left: "Printer", right: name },
      { kind: "row", left: "Time", right: new Date().toLocaleTimeString() },
      { kind: "text", text: "If you can read this, the printer is ready.", align: "center" },
      { kind: "feed", lines: 3 },
    ],
  };
}

export function PrintersPage() {
  const { data, reload } = useBootstrap();
  const { printers, categories } = data!;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [systemPrinters, setSystemPrinters] = useState<{ name: string; displayName: string }[]>([]);
  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [autoKot, setAutoKot] = useState(autoPrintWaiterKot());

  async function detect() {
    if (!desktop) return;
    const [sys, serial] = await Promise.all([desktop.listSystemPrinters(), desktop.listSerialPorts()]);
    setSystemPrinters(sys);
    setSerialPorts(serial);
  }

  useEffect(() => {
    if (draft) void detect();
  }, [draft?.connection]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!draft) return;
    setBusy(true);
    const body = {
      name: draft.name,
      connection: draft.connection,
      address: draft.address,
      paperWidth: draft.paperWidth,
      purpose: draft.purpose,
      categoryIds: draft.purpose === "kot" ? draft.categoryIds : [],
      isActive: draft.isActive,
    };
    try {
      if (draft.id) await api(`/printers/${draft.id}`, { method: "PATCH", body });
      else await api("/printers", { method: "POST", body });
      toast.success(draft.id ? "Printer saved" : `Added ${draft.name}`);
      setDraft(null);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test(p: Pick<Printer, "name" | "connection" | "address" | "paperWidth">) {
    const result = await printDocument(p, testDocument(p.name));
    if (result.ok) toast.success(`Test page sent to ${p.name}`);
    else toast.error(result.error ?? "Print failed");
  }

  async function remove(p: Printer) {
    if (!confirm(`Remove ${p.name}?`)) return;
    await api(`/printers/${p.id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    await reload();
  }

  const covered = new Set(printers.filter((p) => p.purpose === "kot" && p.isActive).flatMap((p) => p.categoryIds));
  const uncovered = categories.filter((c) => !covered.has(c.id));

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Printers"
        description="One bill printer at the counter, and kitchen (KOT) printers that each print the foods of the categories you pick."
        actions={
          <Button
            onClick={() =>
              setDraft({ name: "", connection: "network", address: "", paperWidth: 80, purpose: printers.some((p) => p.purpose === "bill") ? "kot" : "bill", categoryIds: uncovered.map((c) => c.id), isActive: true })
            }
          >
            <Plus /> Add printer
          </Button>
        }
      />
      {!desktop && (
        <p className="mb-4 rounded-md bg-turmeric-soft px-3 py-2 text-sm">
          You're in a browser, so tickets open the print dialog. Open the RMS desktop app to print straight to USB, network and Bluetooth printers.
        </p>
      )}

      <label className="mb-5 flex items-start gap-3 rounded-lg border bg-card p-4">
        <Switch
          className="mt-0.5"
          checked={autoKot}
          onCheckedChange={(v) => {
            setAutoPrintWaiterKot(v);
            setAutoKot(v);
          }}
        />
        <span>
          <span className="block font-medium">Print KOTs for waiter orders on this computer</span>
          <span className="block text-sm text-muted-foreground">
            Waiters send orders from their phones, which can't print. Turn this on for the one computer at the counter that should print their kitchen tickets. Keep the app open on it.
          </span>
        </span>
      </label>

      {printers.length === 0 ? (
        <EmptyState title="No printers yet">Add your counter printer for bills, then a kitchen printer for the categories cooked in each section.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {printers.map((p) => {
            const conn = CONNECTIONS.find((c) => c.id === p.connection)!;
            const cats = categories.filter((c) => p.categoryIds.includes(c.id));
            return (
              <div key={p.id} className={cn("rounded-lg border bg-card p-4", !p.isActive && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <div className="grid size-10 place-items-center rounded-md bg-steel">
                    <conn.icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold leading-tight">{p.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {p.purpose === "bill" ? (
                        "Customer bills"
                      ) : cats.length > 0 ? (
                        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          KOT for
                          {cats.map((c) => (
                            <span key={c.id} className="inline-flex items-center gap-1">
                              <ColorDot color={c.color} /> {c.name}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="font-semibold text-chili">KOT, no categories picked</span>
                      )}
                    </p>
                    <p className="tabular mt-1 truncate text-xs text-muted-foreground">
                      {conn.label} · {p.address || "system default"} · {p.paperWidth} mm
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2 border-t pt-3">
                  <Button size="sm" variant="outline" onClick={() => test(p)}>
                    <PrinterIcon /> Test print
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft({ ...p })}>
                    <Pencil /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-chili" onClick={() => remove(p)} aria-label={`Remove ${p.name}`}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit printer" : "Add printer"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <FormField label="How is it connected?">
                <div className="grid gap-2 sm:grid-cols-3">
                  {CONNECTIONS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, connection: c.id, address: "" })}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm",
                        draft.connection === c.id ? "border-ink bg-turmeric-soft" : "hover:border-ink/40",
                      )}
                    >
                      <c.icon className="size-5" />
                      <span className="font-semibold">{c.label}</span>
                      <span className="text-xs text-muted-foreground">{c.hint}</span>
                    </button>
                  ))}
                </div>
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Name" htmlFor="p-name">
                  <Input id="p-name" placeholder="e.g. Chinese kitchen" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </FormField>
                <FormField label="Paper width" htmlFor="p-width">
                  <NativeSelect id="p-width" className="w-full" value={draft.paperWidth} onChange={(e) => setDraft({ ...draft, paperWidth: Number(e.target.value) as 58 | 80 })}>
                    <NativeSelectOption value={80}>80 mm (3 inch)</NativeSelectOption>
                    <NativeSelectOption value={58}>58 mm (2 inch)</NativeSelectOption>
                  </NativeSelect>
                </FormField>
              </div>

              <AddressField draft={draft} setDraft={setDraft} systemPrinters={systemPrinters} serialPorts={serialPorts} onRefresh={detect} />

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Prints" htmlFor="p-purpose">
                  <NativeSelect id="p-purpose" className="w-full" value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value as "kot" | "bill" })}>
                    <NativeSelectOption value="bill">Customer bills</NativeSelectOption>
                    <NativeSelectOption value="kot">Kitchen tickets (KOT)</NativeSelectOption>
                  </NativeSelect>
                </FormField>
              </div>
              {draft.purpose === "kot" && (
                <FormField label="Prints foods from" hint="A KOT prints here with only the ordered foods from these categories.">
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((c) => {
                      const on = draft.categoryIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setDraft({ ...draft, categoryIds: on ? draft.categoryIds.filter((id) => id !== c.id) : [...draft.categoryIds, c.id] })}
                          className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", on ? "border-ink bg-ink text-white" : "bg-card hover:border-ink/40")}
                        >
                          <ColorDot color={c.color} />
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </FormField>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} /> Printer is in use
              </label>
            </div>
          )}
          <DialogFooter>
            {draft && (
              <Button variant="outline" className="mr-auto" onClick={() => test({ ...draft, name: draft.name || "New printer" })}>
                <PrinterIcon /> Test print
              </Button>
            )}
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !draft?.name.trim() || (draft?.purpose === "kot" && draft.categoryIds.length === 0) || (draft?.connection === "network" && !draft.address)}>
              {draft?.id ? "Save printer" : "Add printer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddressField({
  draft,
  setDraft,
  systemPrinters,
  serialPorts,
  onRefresh,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  systemPrinters: { name: string; displayName: string }[];
  serialPorts: string[];
  onRefresh: () => void;
}) {
  if (draft.connection === "network") {
    return (
      <FormField label="IP address" htmlFor="p-ip" hint="Print the printer's self-test page to find its IP. Add :port if it isn't 9100.">
        <Input id="p-ip" className="font-mono" placeholder="192.168.1.50" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value.trim() })} />
      </FormField>
    );
  }

  const options =
    draft.connection === "usb"
      ? systemPrinters.map((p) => ({ value: p.name, label: p.displayName }))
      : [
          ...serialPorts.map((s) => ({ value: s, label: `${s} (serial)` })),
          ...systemPrinters.map((p) => ({ value: p.name, label: `${p.displayName} (system printer)` })),
        ];
  const hint =
    draft.connection === "usb"
      ? "Pick the printer as installed on this computer. Leave empty to use the default printer."
      : "Pair the printer in your computer's Bluetooth settings first. On Windows, type its COM port, e.g. COM5.";

  return (
    <FormField label={draft.connection === "usb" ? "Printer on this computer" : "Bluetooth port"} htmlFor="p-addr" hint={hint}>
      <div className="flex gap-2">
        {desktop && options.length > 0 ? (
          <NativeSelect id="p-addr" className="w-full" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })}>
            <NativeSelectOption value="">{draft.connection === "usb" ? "Default printer" : "Choose…"}</NativeSelectOption>
            {options.map((o) => (
              <NativeSelectOption key={o.value} value={o.value}>
                {o.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : (
          <Input
            id="p-addr"
            className="font-mono"
            placeholder={draft.connection === "usb" ? "EPSON_TM_T82" : "/dev/tty.RPP02N or COM5"}
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
        )}
        {desktop && (
          <Button type="button" variant="outline" size="icon" onClick={onRefresh} aria-label="Find printers again">
            <RefreshCw />
          </Button>
        )}
      </div>
    </FormField>
  );
}
