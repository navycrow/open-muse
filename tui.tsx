/** @jsxImportSource @opentui/solid */

// open-muse TUI plugin (OpenCode 2.x): subscription quota in the sidebar footer.
//
// Discovered by OpenCode 2.x as the `tui` sibling of the server plugin — NOT
// by the tsc build (loaded as-is; the host provides `solid-js` and
// `@opentui/solid`). No config needed: the server plugin directory is the
// discovery root.
//
// It finds the proxy through `<stateDir>/proxy.json` (written by the proxy on
// start) and reads its `GET /v1/usage` every minute and after each turn:
// no port to configure.

import type { Plugin } from "@opencode/plugin/tui";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSignal, onCleanup } from "solid-js";

const REFRESH_MS = 60_000;

function defaultStateDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "open-muse");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "open-muse");
}

function proxyOrigin(stateDir: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(stateDir, "proxy.json"), "utf8");
    const parsed = JSON.parse(raw) as { origin?: unknown };
    return typeof parsed.origin === "string" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

function resetLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return time;
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${time}`;
}

function quotaLabel(data: any): string | undefined {
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const windowPercent = num(data?.window?.usedPercent);
  const weeklyPercent = num(data?.weekly?.usedPercent);
  const windowReset = num(data?.window?.resetsAtMs);
  const weeklyReset = num(data?.weekly?.resetsAtMs);
  if (
    windowPercent === undefined ||
    weeklyPercent === undefined ||
    windowReset === undefined ||
    weeklyReset === undefined
  ) {
    return undefined;
  }
  return `Muse 5h ${windowPercent}% → ${resetLabel(windowReset)} · sem ${weeklyPercent}% → ${resetLabel(weeklyReset)}`;
}

export default {
  id: "open-muse-quota",
  setup(ctx: Plugin.Context) {
    const stateDir = String(ctx.options.stateDir ?? process.env.OPEN_MUSE_STATE_DIR ?? defaultStateDir());

    const [label, setLabel] = createSignal("Muse …");
    const refresh = async () => {
      try {
        const origin = proxyOrigin(stateDir);
        if (!origin) {
          setLabel("Muse —");
          return;
        }
        const res = await fetch(`${origin}/v1/usage`);
        if (!res.ok) {
          setLabel("Muse —");
          return;
        }
        const body = (await res.json()) as { data?: unknown };
        setLabel(quotaLabel(body.data) ?? "Muse —");
      } catch {
        setLabel("Muse —");
      }
    };

    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    onCleanup(() => clearInterval(timer));

    // Refresh right after a turn lands too, so the footer picks up fresh
    // quota without waiting for the next tick. Event names are best-effort:
    // a rename must never break the slot.
    const unsubscribers: Array<() => void> = [];
    for (const type of ["message.updated", "session.updated"] as const) {
      try {
        unsubscribers.push(ctx.data.on(type, () => void refresh()));
      } catch {
        // ignore unknown event names
      }
    }

    const release = ctx.ui.slot({
      append: "prompt.footer.status",
      render: () => (
        <box flexDirection="row">
          <text>{label()}</text>
        </box>
      ),
    });

    return () => {
      clearInterval(timer);
      for (const unsubscribe of unsubscribers) {
        try {
          unsubscribe();
        } catch {
          // ignore
        }
      }
      release();
    };
  },
};
