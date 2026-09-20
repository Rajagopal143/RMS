import { formatMoney, ORDER_TYPE_LABEL, type Order } from "./types";

export type PrintLine =
  | { kind: "text"; text: string; align?: "left" | "center" | "right"; bold?: boolean; large?: boolean }
  | { kind: "row"; left: string; right: string; bold?: boolean }
  | { kind: "divider" }
  | { kind: "feed"; lines?: number };

export interface PrintDocument {
  title: string;
  lines: PrintLine[];
}

const money = (p: number) => formatMoney(p, "Rs.");

function time(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
}

function orderHeader(order: Order): PrintLine[] {
  const lines: PrintLine[] = [
    { kind: "row", left: `Order #${order.orderNo}`, right: ORDER_TYPE_LABEL[order.type], bold: true },
    { kind: "text", text: time(order.createdAt) },
  ];
  if (order.tableNo) lines.push({ kind: "text", text: `Table: ${order.tableNo}`, bold: true });
  if (order.customerName) lines.push({ kind: "text", text: `Customer: ${order.customerName}` });
  return lines;
}

/** Kitchen Order Ticket for one kitchen printer: only the foods in the categories it covers. */
export function buildKot(order: Order, label: string, categoryIds: number[]): PrintDocument {
  const items = order.items.filter((i) => i.categoryId !== null && categoryIds.includes(i.categoryId));
  const lines: PrintLine[] = [
    { kind: "text", text: `KOT - ${label.toUpperCase()}`, align: "center", bold: true, large: true },
    { kind: "divider" },
    ...orderHeader(order),
    { kind: "divider" },
  ];
  for (const item of items) {
    lines.push({ kind: "row", left: item.name, right: `x ${item.qty}`, bold: true });
    if (item.notes) lines.push({ kind: "text", text: `  > ${item.notes}` });
  }
  if (order.notes) lines.push({ kind: "divider" }, { kind: "text", text: `Note: ${order.notes}` });
  lines.push({ kind: "feed", lines: 3 });
  return { title: `KOT ${label} #${order.orderNo}`, lines };
}

export interface BillHeader {
  name: string;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
}

/** Customer bill with every item and the total. */
export function buildBill(order: Order, header: BillHeader): PrintDocument {
  const lines: PrintLine[] = [{ kind: "text", text: header.name, align: "center", bold: true, large: true }];
  if (header.address) lines.push({ kind: "text", text: header.address, align: "center" });
  if (header.phone) lines.push({ kind: "text", text: `Ph: ${header.phone}`, align: "center" });
  if (header.gstin) lines.push({ kind: "text", text: `GSTIN: ${header.gstin}`, align: "center" });
  lines.push({ kind: "divider" }, ...orderHeader(order));
  if (order.type === "delivery" && order.customerAddress) {
    lines.push({ kind: "text", text: `Deliver to: ${order.customerAddress}` });
  }
  if (order.customerPhone) lines.push({ kind: "text", text: `Phone: ${order.customerPhone}` });
  lines.push({ kind: "divider" });
  for (const item of order.items) {
    lines.push({ kind: "row", left: `${item.qty} x ${item.name}`, right: money(item.price * item.qty) });
  }
  lines.push(
    { kind: "divider" },
    { kind: "row", left: "Subtotal", right: money(order.subtotal) },
  );
  // Only bills from before tax was removed have any.
  if (order.tax) lines.push({ kind: "row", left: "Tax", right: money(order.tax) });
  if (order.discount) lines.push({ kind: "row", left: "Discount", right: `-${money(order.discount)}` });
  lines.push(
    { kind: "row", left: "TOTAL", right: money(order.total), bold: true },
    { kind: "divider" },
  );
  if (order.paymentMode) lines.push({ kind: "text", text: `Paid by ${order.paymentMode.toUpperCase()}` });
  lines.push({ kind: "text", text: "Thank you! Visit again.", align: "center" }, { kind: "feed", lines: 3 });
  return { title: `Bill #${order.orderNo}`, lines };
}

export function charsPerLine(paperWidth: number): number {
  return paperWidth >= 80 ? 48 : 32;
}

function fitRow(left: string, right: string, width: number): string {
  const room = width - right.length - 1;
  const l = left.length > room ? left.slice(0, Math.max(room, 0)) : left;
  return l + " ".repeat(Math.max(width - l.length - right.length, 1)) + right;
}

// ---- ESC/POS (raw bytes for network and Bluetooth thermal printers) ----

const ESC = 0x1b;
const GS = 0x1d;

function ascii(text: string): number[] {
  // Thermal printers use single-byte code pages; replace anything outside ASCII.
  return Array.from(text.replace(/₹/g, "Rs."), (ch) => {
    const c = ch.charCodeAt(0);
    return c < 128 ? c : 0x3f;
  });
}

export function encodeEscPos(doc: PrintDocument, paperWidth: number): Uint8Array {
  const width = charsPerLine(paperWidth);
  const out: number[] = [ESC, 0x40];
  const align = (a: "left" | "center" | "right" = "left") =>
    out.push(ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0);
  const bold = (on: boolean) => out.push(ESC, 0x45, on ? 1 : 0);
  const size = (large: boolean) => out.push(GS, 0x21, large ? 0x11 : 0x00);
  const writeLine = (s: string) => out.push(...ascii(s), 0x0a);

  for (const line of doc.lines) {
    switch (line.kind) {
      case "text":
        align(line.align);
        bold(!!line.bold);
        size(!!line.large);
        writeLine(line.text);
        size(false);
        bold(false);
        align("left");
        break;
      case "row":
        bold(!!line.bold);
        writeLine(fitRow(line.left, line.right, width));
        bold(false);
        break;
      case "divider":
        writeLine("-".repeat(width));
        break;
      case "feed":
        out.push(ESC, 0x64, line.lines ?? 1);
        break;
    }
  }
  out.push(GS, 0x56, 0x42, 0x00); // feed and partial cut
  return new Uint8Array(out);
}

// ---- HTML (OS-installed USB printers and the browser fallback) ----

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderReceiptHtml(doc: PrintDocument, paperWidth: number): string {
  const body = doc.lines
    .map((line) => {
      switch (line.kind) {
        case "text":
          return `<div style="text-align:${line.align ?? "left"};${line.bold ? "font-weight:700;" : ""}${line.large ? "font-size:1.35em;" : ""}">${escapeHtml(line.text)}</div>`;
        case "row":
          return `<div class="row"${line.bold ? ' style="font-weight:700"' : ""}><span>${escapeHtml(line.left)}</span><span>${escapeHtml(line.right)}</span></div>`;
        case "divider":
          return `<hr>`;
        case "feed":
          return `<div style="height:${(line.lines ?? 1) * 0.6}em"></div>`;
      }
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>
@page { size: ${paperWidth}mm auto; margin: 0; }
body { width: ${paperWidth - 6}mm; margin: 0 3mm; font: 12px/1.35 "JetBrains Mono", ui-monospace, Menlo, monospace; color: #000; }
.row { display: flex; justify-content: space-between; gap: 8px; }
hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
</style></head><body>${body}</body></html>`;
}
