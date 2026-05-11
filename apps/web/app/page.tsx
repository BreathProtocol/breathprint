"use client";

export default function Page() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <div className="flex items-center gap-3 mb-6">
        <span
          className="w-[8px] h-[8px] rounded-full animate-dot-pulse"
          style={{
            background: "var(--teal)",
            boxShadow: "0 0 12px var(--teal)",
          }}
        />
        <span className="bp-label" style={{ color: "var(--bone)" }}>
          BREATHPRINT · STANDBY
        </span>
      </div>
      <p
        className="bp-editorial mb-8 max-w-[420px]"
        style={{ fontSize: "18px", lineHeight: 1.5, color: "var(--bone)", opacity: 0.78 }}
      >
        Verification is launched from the Vertebra Atlas dashboard. Sign in there to begin a session.
      </p>
      <a
        href="/verify"
        className="bp-label transition-colors hover:text-[var(--teal)]"
        style={{
          padding: "10px 16px",
          border: "1px solid var(--bone-10)",
          color: "var(--bone)",
          textDecoration: "none",
          letterSpacing: "0.3em",
          fontSize: "11px",
        }}
      >
        Continue to verification →
      </a>
    </main>
  );
}
