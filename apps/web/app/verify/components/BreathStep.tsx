"use client";

import { useEffect, useRef, useState } from "react";
import { useBreathEngine, BREATH_CYCLES_REQUIRED } from "../../../hooks/useBreathEngine";
import { apiPost, apiPostForm } from "../../../lib/api";
import { allowInsecureDevBypass } from "../../../lib/insecureContext";
import { useSolanaWallet } from "../../../components/Web3AuthSolanaProvider";
import { captureFrames, verifyOnChain, isOnChainEnabled } from "../../../lib/breathprint";

interface BreathStepProps {
  sessionId: string;
  onSuccess: (zk?: { txSignature: string; solscanUrl: string }) => void;
  onFail: (reason: string) => void;
}

export default function BreathStep({ sessionId, onSuccess, onFail }: BreathStepProps) {
  const solana = useSolanaWallet();
  const [zkResult, setZkResult] = useState<{ txSignature: string; solscanUrl: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { startEngine, stopEngine, engineReady, currentStats, mouthLandmarks } = useBreathEngine(videoRef);
  const statsRef = useRef(currentStats);
  const breathSubmittedRef = useRef(false);

  const [status, setStatus] = useState<"instructions" | "breathing" | "processing" | "result">("instructions");
  const [errorMSG, setErrorMSG] = useState<string | null>(null);

  useEffect(() => {
    statsRef.current = currentStats;
  }, [currentStats]);

  useEffect(() => {
    async function initAV() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        if (status === "breathing") {
          startEngine(stream);
        }
      } catch (e) {
        console.error("A/V error:", e);
        setErrorMSG("Camera or Microphone access denied.");
      }
    }

    if (status === "instructions" || status === "breathing") {
      initAV();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, startEngine]);

  useEffect(() => {
    if (status !== "breathing" || breathSubmittedRef.current) return;
    if (currentStats.cyclesCompleted >= BREATH_CYCLES_REQUIRED) {
      breathSubmittedRef.current = true;
      void submitBreathPayload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStats.cyclesCompleted, status]);

  const submitBreathPayload = async () => {
    // Capture face snapshot from live video BEFORE stopping the engine
    let faceBlob: Blob | null = null;
    if (videoRef.current && videoRef.current.readyState >= 2) {
      const snapCanvas = document.createElement("canvas");
      snapCanvas.width = videoRef.current.videoWidth;
      snapCanvas.height = videoRef.current.videoHeight;
      const ctx = snapCanvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, snapCanvas.width, snapCanvas.height);
        faceBlob = await new Promise<Blob | null>((resolve) =>
          snapCanvas.toBlob((b) => resolve(b), "image/jpeg", 0.85)
        );
      }
    }

    setStatus("processing");
    stopEngine();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }

    const stats = statsRef.current;
    const sent = Math.min(100, Math.max(0, Math.round(stats.breathScore)));

    try {
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("syncScore", sent.toString());
      formData.append("mouthScore", Math.round(stats.mouthBreathScore).toString());
      formData.append("audioScore", Math.round(stats.audioBreathScore).toString());
      if (faceBlob) {
        formData.append("face", new File([faceBlob], "breath-face.jpg", { type: "image/jpeg" }));
      }

      const res = await apiPostForm("/v1/verify/breath", formData);

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        setStatus("result");
        setErrorMSG(`Server returned status ${res.status}. Please try again.`);
        return;
      }

      if (data.error || !data.passed) {
        setStatus("result");
        const errMsg =
          typeof data.error === "string"
            ? data.error
            : "Breath synchronization failed. Audio didn't match mouth physics.";
        setErrorMSG(errMsg);
      } else {
        const zk = await runOnChainVerification();
        setStatus("result");
        setTimeout(() => onSuccess(zk ?? undefined), 3000);
      }
    } catch (e) {
      console.error("[BreathStep] API error:", e);
      setStatus("result");
      setErrorMSG("Network transmission error. Check your connection and try again.");
    }
  };

  /**
   * After API confirms breath sync, generate the ZK verification proof
   * (Hamming distance between stored Step-2 template and a fresh face
   * capture) and submit it on-chain. Best-effort; silent skip on any error.
   */
  const runOnChainVerification = async (): Promise<{ txSignature: string; solscanUrl: string } | null> => {
    if (!isOnChainEnabled()) return null;
    if (!solana.publicKey || !solana.provider) return null;
    if (!videoRef.current) return null;
    try {
      const frames = await captureFrames(videoRef.current, 8, 100);
      if (frames.length < 4) return null;
      const result = await verifyOnChain(frames, solana.provider, solana.publicKey);
      if (result) setZkResult({ txSignature: result.txSignature, solscanUrl: result.solscanUrl });
      return result;
    } catch (err) {
      console.warn("On-chain verification skipped:", err);
      return null;
    }
  };

  const submitBreathDevBypass = async () => {
    setStatus("processing");
    try {
      const res = await apiPost("/v1/verify/breath", {
        sessionId,
        syncScore: 92,
      });
      const data = await res.json();

      if (data.error || !data.passed) {
        setStatus("result");
        setErrorMSG(data.error || "Breath verification failed.");
      } else {
        const zk = await runOnChainVerification();
        setStatus("result");
        setTimeout(() => onSuccess(zk ?? undefined), 3000);
      }
    } catch {
      setStatus("result");
      setErrorMSG("Network transmission error.");
    }
  };

  // Canvas: draw mouth landmarks in teal
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (mouthLandmarks.length === 4) {
      ctx.fillStyle = "#7AE0D4"; // HUD cyan for biometric mouth landmarks
      mouthLandmarks.forEach((point: { x: number; y: number }) => {
        ctx.beginPath();
        ctx.arc(point.x * canvas.width, point.y * canvas.height, 2, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
  }, [mouthLandmarks]);

  /* Phase-driven accent color — teal for inhale, bone for exhale, dim for idle */
  const phaseColor =
    currentStats.breathPhase === "inhale"
      ? "var(--teal)"
      : currentStats.breathPhase === "exhale"
      ? "var(--bone)"
      : "var(--dim)";

  return (
    <div className="bp-card w-full max-w-md mx-auto p-6">
      {/* Instructions */}
      {status === "instructions" && (
        <>
          <div className="mb-6">
            <div className="bp-eyebrow mb-2">STEP · 03 / RESPIRATION</div>
            <h2
              className="bp-display mb-3"
              style={{ fontSize: "clamp(24px, 3vw, 32px)" }}
            >
              Three deep
              <br />
              breaths
            </h2>
            <p
              className="bp-editorial"
              style={{ fontSize: "15px", opacity: 0.7, lineHeight: 1.4 }}
            >
              The device listens. You will be prompted to{" "}
              <span style={{ color: "var(--teal)" }}>breathe in</span> and{" "}
              <span style={{ color: "var(--teal)" }}>breathe out</span> for{" "}
              {BREATH_CYCLES_REQUIRED} complete cycles. Audible breathing only.
            </p>
          </div>

          {/* Preconditions */}
          <div className="space-y-0 mb-6">
            <div
              className="flex items-center justify-between py-3"
              style={{ borderTop: "1px solid var(--bone-10)" }}
            >
              <span className="bp-label">CAMERA</span>
              <span className="bp-readout" style={{ fontSize: "10px" }}>
                FACE VISIBLE IN FRAME
              </span>
            </div>
            <div
              className="flex items-center justify-between py-3"
              style={{ borderTop: "1px solid var(--bone-10)" }}
            >
              <span className="bp-label">AUDIO</span>
              <span className="bp-readout" style={{ fontSize: "10px" }}>
                INHALE + EXHALE
              </span>
            </div>
            <div
              className="flex items-center justify-between py-3"
              style={{
                borderTop: "1px solid var(--bone-10)",
                borderBottom: "1px solid var(--bone-10)",
              }}
            >
              <span className="bp-label">SILENCE</span>
              <span
                className="bp-readout"
                style={{ fontSize: "10px", color: "#FF6B8F" }}
              >
                NOT COUNTED
              </span>
            </div>
          </div>

          <button
            onClick={() => {
              breathSubmittedRef.current = false;
              setStatus("breathing");
            }}
            className="bp-button w-full justify-center"
            style={{ borderColor: "var(--teal)", color: "var(--teal)" }}
          >
            Start Breath Protocol
          </button>

          {allowInsecureDevBypass() && (
            <button
              type="button"
              onClick={() => void submitBreathDevBypass()}
              className="bp-label w-full text-center mt-3"
              style={{ padding: "8px", fontSize: "10px" }}
            >
              SKIP CAMERA &amp; MIC (DEV BYPASS)
            </button>
          )}

          <video ref={videoRef} autoPlay playsInline muted className="hidden" />
        </>
      )}

      {/* Breathing */}
      {status === "breathing" && (
        <>
          <div className="mb-4 text-center">
            <div className="bp-eyebrow mb-2">STEP · 03 / RESPIRATION</div>
            {!engineReady ? (
              <h2 className="bp-display" style={{ fontSize: "28px" }}>
                Starting Sensors…
              </h2>
            ) : currentStats.breathPhase === "idle" ? (
              <h2
                className="bp-display"
                style={{ fontSize: "32px", color: "var(--dim)" }}
              >
                Get ready
              </h2>
            ) : currentStats.breathPhase === "inhale" ? (
              <div>
                <h2
                  className="bp-display"
                  style={{ fontSize: "36px", color: "var(--teal)" }}
                >
                  Breathe in
                </h2>
                <div
                  className="bp-readout mt-2"
                  style={{
                    fontSize: "32px",
                    color: "var(--teal)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {currentStats.phaseCountdown}
                </div>
              </div>
            ) : (
              <div>
                <h2
                  className="bp-display"
                  style={{ fontSize: "36px", color: "var(--bone)" }}
                >
                  Breathe out
                </h2>
                <div
                  className="bp-readout mt-2"
                  style={{
                    fontSize: "32px",
                    color: "var(--bone)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {currentStats.phaseCountdown}
                </div>
              </div>
            )}
          </div>

          {/* Phase progress line */}
          {engineReady && currentStats.breathPhase !== "idle" && (
            <div
              className="w-full h-px relative mb-5"
              style={{ background: "var(--bone-10)" }}
            >
              <div
                className="absolute inset-y-0 left-0 h-px transition-all duration-100"
                style={{
                  width: `${currentStats.phaseProgress * 100}%`,
                  background: phaseColor,
                  boxShadow: `0 0 6px ${phaseColor}`,
                }}
              />
            </div>
          )}

          {/* Round camera viewport — scales softly with phase */}
          <div
            className="bp-viewport-round mx-auto mb-5 transition-transform duration-200"
            style={{
              width: "min(100%, 280px)",
              transform:
                currentStats.breathPhase === "inhale"
                  ? `scale(${1 + currentStats.phaseProgress * 0.06})`
                  : currentStats.breathPhase === "exhale"
                  ? `scale(${1.06 - currentStats.phaseProgress * 0.06})`
                  : "scale(1)",
              borderColor: phaseColor,
              boxShadow: `0 0 28px ${phaseColor}40, inset 0 0 32px rgba(255, 255, 255, 0.6)`,
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            <canvas
              ref={canvasRef}
              width={320}
              height={320}
              className="absolute inset-0 z-[2] w-full h-full"
              style={{ transform: "scaleX(-1)", opacity: 0.85 }}
            />

            {/* Cycle completion ring — overlays the circle */}
            <svg
              className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none z-[3]"
              viewBox="0 0 100 100"
            >
              <circle
                cx="50"
                cy="50"
                r="49"
                fill="none"
                stroke="rgba(31, 26, 20, 0.08)"
                strokeWidth="1.5"
              />
              <circle
                cx="50"
                cy="50"
                r="49"
                fill="none"
                stroke="var(--cyan)"
                strokeWidth="1.5"
                strokeDasharray="308"
                strokeDashoffset={
                  308 -
                  308 *
                    Math.min(
                      1,
                      currentStats.cyclesCompleted / BREATH_CYCLES_REQUIRED
                    )
                }
                strokeLinecap="round"
                style={{
                  transition: "stroke-dashoffset 0.3s ease",
                  filter: "drop-shadow(0 0 6px var(--cyan))",
                }}
              />
            </svg>
          </div>

          {/* Tabular readout panel */}
          <div className="space-y-0">
            <div
              className="flex items-center justify-between py-2.5"
              style={{ borderTop: "1px solid var(--bone-10)" }}
            >
              <span className="bp-label">CYCLE</span>
              <span
                className="bp-readout"
                style={{ fontSize: "11px", color: "var(--bone)" }}
              >
                {String(currentStats.cyclesCompleted).padStart(2, "0")} /{" "}
                {String(BREATH_CYCLES_REQUIRED).padStart(2, "0")}
              </span>
            </div>
            <div
              className="flex items-center justify-between py-2.5"
              style={{ borderTop: "1px solid var(--bone-10)" }}
            >
              <span className="bp-label">SOUND</span>
              <span
                className="bp-readout"
                style={{
                  fontSize: "10px",
                  color: currentStats.breathingDetected
                    ? "var(--teal)"
                    : "var(--dim)",
                }}
              >
                {currentStats.breathingDetected ? "DETECTED" : "LISTENING"}
              </span>
            </div>
            {engineReady && (
              <div
                className="flex items-center gap-3 py-2.5"
                style={{ borderTop: "1px solid var(--bone-10)" }}
              >
                <span className="bp-label" style={{ minWidth: "40px" }}>
                  MIC
                </span>
                <div
                  className="flex-1 h-px relative"
                  style={{ background: "var(--bone-10)" }}
                >
                  <div
                    className="absolute inset-y-0 left-0 h-px transition-all duration-75"
                    style={{
                      width: `${Math.min(100, (currentStats.audioRms || 0) * 1500)}%`,
                      background: currentStats.breathingDetected
                        ? "var(--teal)"
                        : "var(--bone-20)",
                    }}
                  />
                </div>
                <span
                  className="bp-readout"
                  style={{ fontSize: "10px", minWidth: "40px", textAlign: "right" }}
                >
                  {((currentStats.audioRms || 0) * 1000).toFixed(1)}
                </span>
              </div>
            )}
            <div
              className="flex items-center justify-between py-2.5"
              style={{
                borderTop: "1px solid var(--bone-10)",
                borderBottom: "1px solid var(--bone-10)",
              }}
            >
              <span className="bp-label">PHASE</span>
              <span
                className="bp-readout"
                style={{ fontSize: "10px", color: phaseColor }}
              >
                {currentStats.breathPhase.toUpperCase()}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Processing */}
      {status === "processing" && (
        <div className="h-[420px] flex flex-col items-center justify-center gap-3">
          <span
            className="w-[8px] h-[8px] rounded-full animate-dot-pulse"
            style={{
              background: "var(--teal)",
              boxShadow: "0 0 12px var(--teal)",
            }}
          />
          <span className="bp-label" style={{ color: "var(--bone)" }}>
            PROCESSING · SPECTRUM ANALYSIS
          </span>
          <p
            className="bp-editorial mt-2 max-w-[260px] text-center"
            style={{ fontSize: "14px", opacity: 0.6 }}
          >
            Reconciling audio waveform and facial mesh outputs.
          </p>
        </div>
      )}

      {/* Result */}
      {status === "result" && (
        <div className="h-[420px] flex flex-col items-center justify-center text-center">
          {errorMSG ? (
            <>
              <div
                className="bp-eyebrow mb-3"
                style={{ color: "#FF6B8F" }}
              >
                RESPIRATION · FAILED
              </div>
              <h3 className="bp-display mb-4" style={{ fontSize: "28px" }}>
                Retry
              </h3>
              <p
                className="bp-editorial mb-8 max-w-xs"
                style={{ fontSize: "14px", opacity: 0.7 }}
              >
                {errorMSG}
              </p>
              <button
                onClick={() => {
                  setStatus("instructions");
                  setErrorMSG(null);
                  breathSubmittedRef.current = false;
                }}
                className="bp-button"
              >
                Restart Protocol
              </button>
            </>
          ) : (
            <>
              <div className="bp-eyebrow mb-3">ATTESTATION · LOCKED</div>
              <h3
                className="bp-display mb-4"
                style={{ fontSize: "34px", color: "var(--teal)" }}
              >
                Identity
                <br />
                Verified
              </h3>
              <p
                className="bp-editorial max-w-xs"
                style={{ fontSize: "15px", opacity: 0.7 }}
              >
                Your biological signature has been securely validated and locked
                to this session.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
