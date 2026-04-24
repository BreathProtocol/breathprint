"use client";

export default function VerifyError({
  error,
  reset,
}: {
  error?: Error;
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bp-card w-full max-w-md mx-auto p-8 text-center">
        <div className="bp-eyebrow mb-3" style={{ color: "#FF6B8F" }}>
          FAULT · UNCAUGHT
        </div>
        <h2
          className="bp-display mb-4"
          style={{ fontSize: "clamp(24px, 4vw, 36px)" }}
        >
          An anomaly surfaced
        </h2>
        <p
          className="bp-editorial mb-8"
          style={{ fontSize: "15px", opacity: 0.7 }}
        >
          {error?.message || "An unexpected error occurred during verification."}
        </p>
        <button onClick={() => reset()} className="bp-button w-full justify-center">
          Retry
        </button>
      </div>
    </div>
  );
}
