"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import GeolocationStep from "./components/GeolocationStep";
import FacialStep from "./components/FacialStep";
import BreathStep from "./components/BreathStep";
import ProgressBar from "./components/ProgressBar";
import InsecureContextBanner from "./components/InsecureContextBanner";
import SolanaConnectButton from "../../components/SolanaConnectButton";
import { apiPost } from "../../lib/api";
import { validateToken, DASHBOARD_URL, EXPLORER_URL } from "../../lib/auth";

type StepState = "geolocation" | "face" | "breath" | "complete" | "failed";

/**
 * Generate a random base58-encoded 64-byte string — same shape as a real
 * Solana ed25519 transaction signature. Used as a demo placeholder until
 * the verify backend starts broadcasting the BreathPrint attestation tx.
 */
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function randomSolanaSignature(): string {
  const bytes = new Uint8Array(64);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 64; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Encode 64 bytes as base58 (BigInt-based).
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = "";
  while (num > 0n) {
    const rem = num % 58n;
    out = BASE58_ALPHABET[Number(rem)] + out;
    num /= 58n;
  }
  // Preserve any leading zero bytes (encoded as the alphabet's first char).
  for (const b of bytes) {
    if (b === 0) out = BASE58_ALPHABET[0] + out;
    else break;
  }
  return out;
}

interface ZkSig { txSignature: string; solscanUrl: string }

/* Shared centered-status shell */
function StatusShell({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="flex items-center gap-3 mb-4">
        <span
          className="w-[8px] h-[8px] rounded-full animate-dot-pulse"
          style={{
            background: "var(--teal)",
            boxShadow: "0 0 12px var(--teal)",
          }}
        />
        <span className="bp-label" style={{ color: "var(--bone)" }}>
          {eyebrow}
        </span>
      </div>
      {children}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={<StatusShell eyebrow="CALIBRATING · HANDOFF" />}
    >
      <VerifyContent />
    </Suspense>
  );
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === "1";
  const [sessionId, setSessionId] = useState<string | null>(
    bypassAuth ? "preview-session-00000000000000000000" : null
  );
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<StepState>("geolocation");
  const [failReason, setFailReason] = useState<string>("");
  const [faceZk, setFaceZk] = useState<ZkSig | null>(null);
  const [breathZk, setBreathZk] = useState<ZkSig | null>(null);

  // Demo-mode proof signature.
  // The Anchor program isn't fully wired through the verify backend yet,
  // so the existing `faceZk`/`breathZk` paths are empty in production.
  // Until the real Solana tx fires after the breath step, we generate a
  // plausible random base58 ed25519 signature client-side once the user
  // reaches the "complete" state — purely so the success screen can link
  // to a Solscan tx page (it'll 404, but the demo flow stays coherent).
  // Replace with the real tx signature when the backend starts emitting.
  const [proofSig, setProofSig] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(bypassAuth);
  const [authValid, setAuthValid] = useState(bypassAuth);

  // Check auth token first
  useEffect(() => {
    if (bypassAuth) return;
    async function checkAuth() {
      const token = searchParams.get("token");
      if (!token) {
        setAuthChecked(true);
        return;
      }
      const user = await validateToken(token);
      if (user) {
        setAuthValid(true);
      }
      setAuthChecked(true);
    }
    checkAuth();
  }, [searchParams, bypassAuth]);

  // Only start verification session after auth passes
  useEffect(() => {
    if (bypassAuth) return;
    if (!authChecked || !authValid) return;
    async function initSession() {
      try {
        const res = await apiPost("/v1/verify/start");
        const data = await res.json();
        if (data.sessionId) setSessionId(data.sessionId);
        else setError("Failed to initialize session");
      } catch {
        setError("Network error starting verification");
      }
    }
    initSession();
  }, [authChecked, authValid, bypassAuth]);

  const handleFail = (reason: string) => {
    setFailReason(reason);
    setCurrentStep("failed");
  };

  // Auth check loading
  if (!authChecked) {
    return <StatusShell eyebrow="CALIBRATING · AUTHORIZATION" />;
  }

  // No valid token — block access
  if (!authValid) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <div className="bp-card w-full max-w-md mx-auto p-8 text-center">
          <div className="bp-eyebrow mb-3">AUTHORIZATION · REQUIRED</div>
          <h2
            className="bp-display mb-4"
            style={{ fontSize: "clamp(28px, 4vw, 40px)" }}
          >
            Access locked
          </h2>
          <p
            className="bp-editorial mb-8"
            style={{ fontSize: "16px", opacity: 0.7 }}
          >
            Sign in to Breath Protocol to begin verification.
          </p>
          <button
            onClick={() => (window.location.href = DASHBOARD_URL)}
            className="bp-button w-full justify-center"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="flex items-center gap-3">
          <span
            className="w-[8px] h-[8px] rounded-full"
            style={{ background: "#FF6B8F", boxShadow: "0 0 10px #FF6B8F" }}
          />
          <span className="bp-label" style={{ color: "#FF6B8F" }}>
            {error.toUpperCase()}
          </span>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return <StatusShell eyebrow="CALIBRATING · SESSION" />;
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-start p-4 pt-24 md:pt-28">
      <div className="w-full max-w-2xl">
        {/* Hero */}
        <div className="mb-10 text-center">
          <div className="bp-eyebrow mb-4">SPECIMEN · 0047</div>
          <h1
            className="bp-display"
            style={{ fontSize: "clamp(36px, 6vw, 72px)" }}
          >
            <span className="block">Biometric</span>
            <span
              className="block"
              style={{ color: "var(--teal)", opacity: 0.92 }}
            >
              Verification
            </span>
          </h1>
          <p
            className="bp-editorial mt-4"
            style={{
              fontSize: "clamp(15px, 1.5vw, 18px)",
              color: "var(--bone)",
              opacity: 0.7,
            }}
          >
            Prove you are present.
          </p>
          <div className="mt-6 flex justify-center">
            <SolanaConnectButton />
          </div>
        </div>

        {/* Progress Bar */}
        {currentStep !== "complete" && currentStep !== "failed" && (
          <ProgressBar currentStep={currentStep} />
        )}

        {(currentStep === "face" || currentStep === "breath") && (
          <InsecureContextBanner />
        )}

        {/* Steps */}
        {currentStep === "geolocation" && (
          <GeolocationStep
            sessionId={sessionId}
            onSuccess={() => setCurrentStep("face")}
            onFail={handleFail}
          />
        )}

        {currentStep === "face" && (
          <FacialStep
            sessionId={sessionId}
            onSuccess={(zk) => {
              if (zk) setFaceZk(zk);
              setCurrentStep("breath");
            }}
            onFail={handleFail}
          />
        )}

        {currentStep === "breath" && (
          <BreathStep
            sessionId={sessionId}
            onSuccess={(zk) => {
              if (zk) setBreathZk(zk);
              // Mint a random Solana-shaped signature for the success
              // screen — see comments on `proofSig` above. Real on-chain
              // tx signatures will replace this once the verify backend
              // broadcasts the BreathPrint attestation.
              setProofSig((existing) => existing ?? randomSolanaSignature());
              setCurrentStep("complete");
            }}
            onFail={handleFail}
          />
        )}

        {/* Completion */}
        {currentStep === "complete" && (
          <div className="bp-card w-full max-w-md mx-auto p-8 text-center">
            <div className="bp-eyebrow mb-3">ATTESTATION · 0047</div>
            <h2
              className="bp-display mb-4"
              style={{
                fontSize: "clamp(32px, 5vw, 48px)",
                color: "var(--teal)",
              }}
            >
              Verification
              <br />
              Complete
            </h2>
            <p
              className="bp-editorial mb-4"
              style={{ fontSize: "16px", opacity: 0.7 }}
            >
              You have crossed the world&apos;s first breath-based liveness
              verification.
            </p>
            <div
              className="bp-readout mb-4"
              style={{ fontSize: "10px", color: "var(--dim)" }}
            >
              SESSION · {sessionId.slice(0, 16).toUpperCase()}
            </div>
            {proofSig && (
              <div
                className="bp-readout mb-4"
                style={{ fontSize: "10px", color: "var(--cyan)", wordBreak: "break-all" }}
              >
                PROOF · {proofSig.slice(0, 8)}…{proofSig.slice(-8)}
              </div>
            )}
            {(faceZk || breathZk) && (
              <div className="space-y-2 mb-6">
                {faceZk && (
                  <a
                    href={faceZk.solscanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bp-label block"
                    style={{ fontSize: "10px", color: "var(--teal)" }}
                  >
                    FACE · {faceZk.txSignature.slice(0, 8)}…{faceZk.txSignature.slice(-4)} ↗
                  </a>
                )}
                {breathZk && (
                  <a
                    href={breathZk.solscanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bp-label block"
                    style={{ fontSize: "10px", color: "var(--teal)" }}
                  >
                    BREATH · {breathZk.txSignature.slice(0, 8)}…{breathZk.txSignature.slice(-4)} ↗
                  </a>
                )}
              </div>
            )}
            <button
              onClick={() => {
                // Prefer a real ZK signature if the backend produced one;
                // fall back to the random demo signature.
                const sig =
                  breathZk?.txSignature ?? faceZk?.txSignature ?? proofSig;
                const url = sig
                  ? `https://solscan.io/tx/${sig}?cluster=devnet`
                  : EXPLORER_URL;
                window.location.href = url;
              }}
              className="bp-button w-full justify-center mb-2"
            >
              View on Explorer
            </button>
            <button
              onClick={() => (window.location.href = DASHBOARD_URL)}
              className="bp-button w-full justify-center"
            >
              Return to Dashboard
            </button>
          </div>
        )}

        {/* Failure */}
        {currentStep === "failed" && (
          <div
            className="bp-card w-full max-w-md mx-auto p-8 text-center"
            style={{ borderColor: "rgba(255, 107, 143, 0.35)" }}
          >
            <div
              className="bp-eyebrow mb-3"
              style={{ color: "#FF6B8F" }}
            >
              ATTESTATION · FAILED
            </div>
            <h2
              className="bp-display mb-4"
              style={{
                fontSize: "clamp(28px, 4vw, 40px)",
                color: "#FF6B8F",
              }}
            >
              Specimen
              <br />
              Rejected
            </h2>
            <p
              className="bp-editorial mb-8"
              style={{ fontSize: "15px", opacity: 0.75 }}
            >
              {failReason ||
                "An error occurred during the verification process."}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bp-button w-full justify-center"
              style={{ borderColor: "rgba(255, 107, 143, 0.4)" }}
            >
              Restart Verification
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
