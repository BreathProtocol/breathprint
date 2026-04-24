"use client";

import { usePathname } from "next/navigation";

function routeMeta(pathname: string | null): {
  label: string;
  system: string;
  hint: string;
} {
  if (pathname?.startsWith("/verify")) {
    return {
      label: "Verification · Live",
      system: "Sys // Biometrics · ONLINE",
      hint: "Hold · Still",
    };
  }
  return {
    label: "Gateway · Redirect",
    system: "Sys // Gateway · ONLINE",
    hint: "Wait · Handoff",
  };
}

export default function HUD() {
  const pathname = usePathname();
  const { label, system, hint } = routeMeta(pathname);

  return (
    <div
      aria-hidden
      className="hidden sm:block fixed inset-0 z-10 pointer-events-none"
    >
      {/* Top-left: sigil + brand */}
      <div className="absolute top-7 left-8 flex items-start gap-2.5">
        <span
          className="mt-[6px] w-[6px] h-[6px] rounded-full animate-dot-pulse"
          style={{
            background: "var(--teal)",
            boxShadow: "0 0 10px var(--teal)",
          }}
        />
        <div className="bp-label leading-relaxed">
          <div style={{ color: "var(--bone)" }}>BREATH PROTOCOL</div>
          <div className="mt-1.5">{label}</div>
        </div>
      </div>

      {/* Top-right: system status */}
      <div className="absolute top-7 right-8 text-right bp-label leading-relaxed">
        <div>{system.split("·")[0].trim()}</div>
        <div className="mt-1.5" style={{ color: "var(--bone)" }}>
          ONLINE
        </div>
      </div>

      {/* Bottom-left: origin */}
      <div className="absolute bottom-7 left-8 bp-label leading-relaxed">
        <div>Lat 41.402 / Lon -2.174</div>
        <div className="mt-1.5">Origin · Barcelona</div>
      </div>

      {/* Bottom-right: contextual input hint */}
      <div className="absolute bottom-7 right-8 text-right bp-label leading-relaxed">
        <div>{hint}</div>
        <div className="mt-1.5">Mouse · Parallax</div>
      </div>
    </div>
  );
}
