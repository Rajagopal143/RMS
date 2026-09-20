import {
  buildBill,
  buildKot,
  encodeEscPos,
  renderReceiptHtml,
  type Order,
  type PrintDocument,
  type Printer,
  type Restaurant,
} from "@workspace/shared";
import { desktop } from "./desktop";

export interface PrintResult {
  label: string;
  ok: boolean;
  error?: string;
}

/** Sends one document to one printer through the desktop app, or the browser print dialog as a fallback. */
export async function printDocument(printer: Pick<Printer, "connection" | "address" | "paperWidth"> | null, doc: PrintDocument): Promise<PrintResult> {
  const paperWidth = printer?.paperWidth ?? 80;
  const html = renderReceiptHtml(doc, paperWidth);
  if (desktop && printer) {
    const result = await desktop.print({
      printer: { connection: printer.connection, address: printer.address, paperWidth },
      bytes: encodeEscPos(doc, paperWidth),
      html,
    });
    return result.ok ? { label: doc.title, ok: true } : { label: doc.title, ok: false, error: result.error };
  }
  return browserPrint(doc.title, html);
}

function browserPrint(label: string, html: string): PrintResult {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const w = frame.contentWindow;
  if (!w) return { label, ok: false, error: "Browser blocked printing" };
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
    setTimeout(() => frame.remove(), 1000);
  }, 150);
  return { label, ok: true };
}

export interface PrintSetup {
  restaurant: Restaurant;
  printers: Printer[];
}

/**
 * Each kitchen printer gets a KOT with only the foods in the categories it covers; the bill goes to the bill printer.
 * Categories with no printer are skipped: their cooks read the order on the kitchen screen.
 * Pass `itemIds` to print KOTs for just those items (e.g. a round added to a table's order).
 */
export async function printOrder(
  order: Order,
  setup: PrintSetup,
  what: { kot: boolean; bill: boolean; itemIds?: number[] },
): Promise<PrintResult[]> {
  const active = setup.printers.filter((p) => p.isActive);
  const jobs: Promise<PrintResult>[] = [];

  if (what.kot) {
    const ids = what.itemIds;
    const kotOrder = ids ? { ...order, items: order.items.filter((i) => ids.includes(i.id)) } : order;
    for (const printer of active.filter((p) => p.purpose === "kot")) {
      const hasItems = kotOrder.items.some((i) => i.categoryId !== null && printer.categoryIds.includes(i.categoryId));
      if (hasItems) jobs.push(printDocument(printer, buildKot(kotOrder, printer.name, printer.categoryIds)));
    }
  }
  if (what.bill) {
    const printer = active.find((p) => p.purpose === "bill") ?? null;
    if (printer || !desktop) jobs.push(printDocument(printer, buildBill(order, setup.restaurant)));
    else jobs.push(Promise.resolve({ label: "Bill", ok: false, error: "Add a bill printer in Printers" }));
  }
  return Promise.all(jobs);
}

const AUTO_KOT_KEY = "rms.autoPrintWaiterKot";

/** Whether this computer prints KOTs for orders waiters send from their phones. Set per computer. */
export function autoPrintWaiterKot(): boolean {
  try {
    return localStorage.getItem(AUTO_KOT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoPrintWaiterKot(on: boolean) {
  try {
    if (on) localStorage.setItem(AUTO_KOT_KEY, "1");
    else localStorage.removeItem(AUTO_KOT_KEY);
  } catch {
    // storage unavailable: the setting lasts until reload
  }
}
