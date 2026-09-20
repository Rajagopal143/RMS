/** Alerts: a short chime, an in-app toast, and a system notification when the screen isn't in view. */
import { toast } from "@workspace/ui/components/sonner";

let audio: AudioContext | null = null;
let worker: ServiceWorkerRegistration | null = null;

/** Registers the notification service worker. Browsers only allow this on https or localhost. */
export async function registerAlertsWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    worker = await navigator.serviceWorker.register("/sw.js");
  } catch {
    worker = null;
  }
}

/** Why system notifications can't work here, if they can't. */
export function notificationBlocker(): string | null {
  if (!("Notification" in window) || !window.isSecureContext) {
    return "Pop-up notifications need a secure address. The chime and on-screen alerts still work.";
  }
  if (Notification.permission === "denied") return "Notifications are blocked for this site in your browser settings.";
  return null;
}

/** Browsers only allow sound after a tap, so call this from a click handler. */
export async function enableAlerts(): Promise<boolean> {
  try {
    audio ??= new AudioContext();
    await audio.resume();
  } catch {
    audio = null;
  }
  if ("Notification" in window && window.isSecureContext && Notification.permission === "default") {
    await Notification.requestPermission().catch(() => undefined);
  }
  return audio !== null;
}

export function chime() {
  if (!audio || audio.state !== "running") return;
  const now = audio.currentTime;
  // Two-tone "ding-ding", like a service bell.
  [880, 1320].forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = now + i * 0.18;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    osc.connect(gain).connect(audio!.destination);
    osc.start(start);
    osc.stop(start + 0.55);
  });
}

/** Chime + toast always; a system notification too when the page is in the background. */
export function alertUser(title: string, body: string) {
  chime();
  toast(title, { description: body });
  if (document.visibilityState === "visible") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options = { body, tag: title, renotify: true, vibrate: [120, 60, 120] } as NotificationOptions;
  if (worker) {
    void worker.showNotification(title, options);
    return;
  }
  try {
    new Notification(title, options);
  } catch {
    // Some browsers only allow notifications from a service worker; the chime and toast still fired.
  }
}
