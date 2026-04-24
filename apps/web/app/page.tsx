"use client";

import { useEffect } from "react";
import { DASHBOARD_URL } from "../lib/auth";

export default function Page() {
  useEffect(() => {
    window.location.href = DASHBOARD_URL;
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="flex items-center gap-3">
        <span
          className="w-[8px] h-[8px] rounded-full animate-dot-pulse"
          style={{
            background: "var(--teal)",
            boxShadow: "0 0 12px var(--teal)",
          }}
        />
        <span className="bp-label" style={{ color: "var(--bone)" }}>
          ROUTING · DASHBOARD
        </span>
      </div>
    </main>
  );
}
