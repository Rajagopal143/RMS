import type { PrinterConnection } from "@workspace/shared";

export interface DesktopBridge {
  platform: string;
  listSystemPrinters(): Promise<{ name: string; displayName: string; isDefault: boolean }[]>;
  listSerialPorts(): Promise<string[]>;
  print(job: {
    printer: { connection: PrinterConnection; address: string; paperWidth: number };
    bytes: Uint8Array;
    html: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
}

declare global {
  interface Window {
    rmsDesktop?: DesktopBridge;
  }
}

/** Present only when running inside the Electron desktop app. */
export const desktop: DesktopBridge | undefined = window.rmsDesktop;
