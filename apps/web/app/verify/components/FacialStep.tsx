"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFaceMesh } from "../../../hooks/useFaceMesh";
import { apiPostForm } from "../../../lib/api";
import { allowInsecureDevBypass, isInsecureContext } from "../../../lib/insecureContext";
import { useSolanaWallet } from "../../../components/Web3AuthSolanaProvider";
import {
  captureFrames,
  registerOnChain,
  isOnChainEnabled,
} from "../../../lib/breathprint";

interface FacialStepProps {
  sessionId: string;
  onSuccess: (zk?: { txSignature: string; solscanUrl: string }) => void;
  onFail: (reason: string) => void;
}

const LIVENESS_THRESHOLD = 60;

export default function FacialStep({ sessionId, onSuccess, onFail }: FacialStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);

  const { isLoaded, faceDetected, liveness, landmarks } = useFaceMesh(videoRef);
  const solana = useSolanaWallet();

  const [mediaMode, setMediaMode] = useState<"camera" | "upload">("camera");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [status, setStatus] = useState<"scanning" | "uploading" | "zk" | "result">("scanning");
  const [errorMSG, setErrorMSG] = useState<string | null>(null);
  const [zkResult, setZkResult] = useState<{ txSignature: string; solscanUrl: string } | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const openFrontCamera = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
      setErrorMSG(null);
    } catch (e) {
      console.error("Camera error:", e);
      if (isInsecureContext()) {
        setErrorMSG(
          "Camera blocked: http:// + Wi-Fi IP is not a secure context on most phones. Use 'Upload selfie' below or HTTPS."
        );
      } else {
        setErrorMSG("Front camera access denied. Allow camera for this site in browser settings.");
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (isInsecureContext() && allowInsecureDevBypass()) {
      setMediaMode("upload");
      return;
    }

    void openFrontCamera();

    return () => {
      stopCamera();
    };
  }, [openFrontCamera, stopCamera]);

  useEffect(() => {
    if (videoRef.current && canvasRef.current) {
      canvasRef.current.width = videoRef.current.clientWidth;
      canvasRef.current.height = videoRef.current.clientHeight;
    }
  }, [faceDetected, landmarks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (landmarks && landmarks.length > 0) {
      ctx.fillStyle = "#7AE0D4"; // HUD cyan for biometric mesh dots
      (landmarks as { x: number; y: number }[]).forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x * canvas.width, point.y * canvas.height, 1, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
  }, [landmarks]);

  useEffect(() => {
    if (status !== "scanning") return;

    if (faceDetected && liveness.score >= LIVENESS_THRESHOLD && countdown === null) {
      setCountdown(3);
    } else if (!faceDetected || liveness.score < LIVENESS_THRESHOLD) {
      setCountdown(null);
    }
  }, [faceDetected, liveness.score, status, countdown]);

  useEffect(() => {
    if (status !== "scanning") return;
    if (countdown === null) return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      snapAndUpload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, status]);

  const snapAndUpload = async () => {
    setStatus("uploading");
    if (!videoRef.current) return;

    const snapCanvas = document.createElement("canvas");
    snapCanvas.width = videoRef.current.videoWidth;
    snapCanvas.height = videoRef.current.videoHeight;
    const ctx = snapCanvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0, snapCanvas.width, snapCanvas.height);

    snapCanvas.toBlob(
      async (blob) => {
        if (!blob) return;
        const file = new File([blob], "face.jpg", { type: "image/jpeg" });

        const formData = new FormData();
        formData.append("sessionId", sessionId);
        formData.append("livenessScore", liveness.score.toString());
        formData.append("face", file);

        try {
          const res = await apiPostForm("/v1/verify/face", formData);
          const data = await res.json();

          if (data.error || !data.passed) {
            setStatus("result");
            setErrorMSG(data.error || "Liveness check failed. Blink and move your head slightly.");
            return;
          }

          // API succeeded — now optionally register on Solana via ZK proof.
          const zk = await runOnChainRegistration();
          setStatus("result");
          setTimeout(() => onSuccess(zk ?? undefined), 2000);
        } catch (err) {
          setStatus("result");
          setErrorMSG("Network transmission error.");
          console.error(err);
        }
      },
      "image/jpeg",
      0.9
    );
  };

  const uploadSelfieFromFile = async (file: File) => {
    setStatus("uploading");
    setErrorMSG(null);
    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("livenessScore", "88");
    formData.append("face", file);

    try {
      const res = await apiPostForm("/v1/verify/face", formData);
      const data = await res.json();

      if (data.error || !data.passed) {
        setStatus("result");
        setErrorMSG(data.error || "Face scan failed.");
      } else {
        const zk = await runOnChainRegistration();
        setStatus("result");
        setTimeout(() => onSuccess(zk ?? undefined), 2000);
      }
    } catch (err) {
      setStatus("result");
      setErrorMSG("Network transmission error.");
      console.error(err);
    }
  };

  /**
   * After the existing API call passes, generate a ZK proof and register
   * the biometric commitment on Solana via Light Protocol. Best-effort:
   * if anything fails (no Web3Auth wallet, program ID unset, RPC error),
   * we silently skip — the existing API flow remains the source of truth.
   */
  const runOnChainRegistration = async (): Promise<{ txSignature: string; solscanUrl: string } | null> => {
    if (!isOnChainEnabled()) return null;
    if (!solana.publicKey || !solana.provider) return null;
    if (!videoRef.current) return null;

    try {
      setStatus("zk");
      const frames = await captureFrames(videoRef.current, 5, 120);
      if (frames.length < 3) return null;
      const result = await registerOnChain(frames, solana.provider, solana.publicKey);
      if (result) setZkResult({ txSignature: result.txSignature, solscanUrl: result.solscanUrl });
      return result;
    } catch (err) {
      console.warn("On-chain registration skipped:", err);
      return null;
    }
  };

  const onSelfieFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadSelfieFromFile(file);
  };

  const passThreshold = liveness.score >= LIVENESS_THRESHOLD;

  return (
    <div className="bp-card w-full max-w-md mx-auto p-6">
      {/* Upload-selfie dev bypass */}
      {status === "scanning" && mediaMode === "upload" && allowInsecureDevBypass() && (
        <>
          <div className="mb-6">
            <div className="bp-eyebrow mb-2">STEP · 02 / FACE</div>
            <h2
              className="bp-display mb-3"
              style={{ fontSize: "clamp(24px, 3vw, 32px)" }}
            >
              Upload selfie
            </h2>
            <p
              className="bp-editorial"
              style={{ fontSize: "14px", opacity: 0.7, lineHeight: 1.4 }}
            >
              Live camera is often blocked on http:// over Wi-Fi. Upload a
              clear front-facing photo (dev bypass).
            </p>
          </div>
          <input
            ref={selfieInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onSelfieFileChange}
          />
          <button
            type="button"
            onClick={() => selfieInputRef.current?.click()}
            className="bp-button w-full justify-center mb-3"
          >
            Upload selfie photo
          </button>
          <button
            type="button"
            onClick={() => {
              setMediaMode("camera");
              void openFrontCamera();
            }}
            className="bp-button w-full justify-center"
            style={{ fontSize: "10px" }}
          >
            Try live camera anyway
          </button>
          <video ref={videoRef} autoPlay playsInline muted className="sr-only" aria-hidden />
        </>
      )}

      {/* Camera scanning */}
      {status === "scanning" && mediaMode === "camera" && (
        <>
          <div className="mb-6">
            <div className="bp-eyebrow mb-2">STEP · 02 / FACE</div>
            <h2
              className="bp-display mb-3"
              style={{ fontSize: "clamp(24px, 3vw, 32px)" }}
            >
              Facial
              <br />
              biometrics
            </h2>
            <p
              className="bp-editorial"
              style={{ fontSize: "14px", opacity: 0.7, lineHeight: 1.4 }}
            >
              {isLoaded
                ? "Move your head slightly. Blink naturally."
                : "Initializing face engine…"}
            </p>
          </div>

          {errorMSG && (
            <div
              className="mb-4 px-4 py-3"
              style={{
                borderLeft: "2px solid #FF6B8F",
                background: "rgba(255, 107, 143, 0.06)",
              }}
            >
              <p
                className="bp-label"
                style={{ color: "#FF6B8F", fontSize: "11px" }}
              >
                {errorMSG}
              </p>
            </div>
          )}

          {allowInsecureDevBypass() && (
            <button
              type="button"
              onClick={() => {
                stopCamera();
                setMediaMode("upload");
                setErrorMSG(null);
              }}
              className="bp-label w-full text-center mb-3"
              style={{
                padding: "6px",
                fontSize: "10px",
                color: "var(--dim)",
              }}
            >
              USE GALLERY UPLOAD INSTEAD (DEV)
            </button>
          )}

          {/* Round camera viewport */}
          <div className="bp-viewport-round mx-auto mb-5" style={{ width: "min(100%, 320px)" }}>
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
              className="absolute inset-0 z-[2]"
              style={{ transform: "scaleX(-1)", opacity: 0.7 }}
            />

            {/* Countdown */}
            {countdown !== null && countdown > 0 && (
              <div
                className="absolute inset-0 z-[4] flex items-center justify-center"
                style={{ background: "rgba(255, 255, 255, 0.45)" }}
              >
                <span
                  className="bp-display"
                  style={{
                    fontSize: "clamp(96px, 16vw, 180px)",
                    color: "var(--teal)",
                    textShadow: "0 0 40px rgba(201, 123, 94, 0.5)",
                  }}
                >
                  {countdown}
                </span>
              </div>
            )}
          </div>

          {/* Overlay readouts (below the circle, since corners don't apply) */}
          <div className="flex items-center justify-center gap-5 mb-4 flex-wrap">
            <div className="bp-readout" style={{ fontSize: "10px" }}>
              LANDMARKS · {(landmarks?.length || 0).toString().padStart(3, "0")}
            </div>
            <div className="bp-readout" style={{ fontSize: "10px" }}>
              LIVENESS · {liveness.score}%
            </div>
            <div
              className="bp-readout"
              style={{
                fontSize: "10px",
                color: passThreshold ? "var(--teal)" : "var(--dim)",
              }}
            >
              THRESHOLD · {LIVENESS_THRESHOLD}%
            </div>
          </div>

          {/* Status panel */}
          <div className="space-y-0">
            <div
              className="flex items-center justify-between py-2.5"
              style={{ borderTop: "1px solid var(--bone-10)" }}
            >
              <span className="bp-label">ENGINE</span>
              <span
                className="bp-readout"
                style={{
                  fontSize: "10px",
                  color: isLoaded ? "var(--teal)" : "var(--dim)",
                }}
              >
                {isLoaded ? "LOADED" : "LOADING"}
              </span>
            </div>
            <div
              className="flex items-center justify-between py-2.5"
              style={{ borderTop: "1px solid var(--bone-10)" }}
            >
              <span className="bp-label">FACE</span>
              <span
                className="bp-readout"
                style={{
                  fontSize: "10px",
                  color: faceDetected ? "var(--teal)" : "var(--dim)",
                }}
              >
                {faceDetected ? "CENTERED" : "SEEKING"}
              </span>
            </div>
            <div
              className="flex items-center justify-between py-2.5"
              style={{
                borderTop: "1px solid var(--bone-10)",
                borderBottom: "1px solid var(--bone-10)",
              }}
            >
              <span className="bp-label">LIVENESS</span>
              <span
                className="bp-readout"
                style={{
                  fontSize: "11px",
                  color: passThreshold ? "var(--teal)" : "#FF6B8F",
                }}
              >
                {liveness.score}/100
              </span>
            </div>
          </div>
        </>
      )}

      {status === "uploading" && (
        <div className="h-[420px] flex flex-col items-center justify-center gap-3">
          <span
            className="w-[8px] h-[8px] rounded-full animate-dot-pulse"
            style={{
              background: "var(--teal)",
              boxShadow: "0 0 12px var(--teal)",
            }}
          />
          <span className="bp-label" style={{ color: "var(--bone)" }}>
            CAPTURING · BIOMETRIC TEMPLATE
          </span>
        </div>
      )}

      {status === "zk" && (
        <div className="h-[420px] flex flex-col items-center justify-center gap-3 text-center">
          <span
            className="w-[8px] h-[8px] rounded-full animate-dot-pulse"
            style={{
              background: "var(--teal)",
              boxShadow: "0 0 12px var(--teal)",
            }}
          />
          <span className="bp-label" style={{ color: "var(--bone)" }}>
            GENERATING · ZK PROOF
          </span>
          <span className="bp-label" style={{ fontSize: "9px", opacity: 0.5 }}>
            COMMITTING TO SOLANA · LIGHT PROTOCOL
          </span>
        </div>
      )}

      {status === "result" && (
        <div className="h-[420px] flex flex-col items-center justify-center text-center">
          {errorMSG ? (
            <>
              <div
                className="bp-eyebrow mb-3"
                style={{ color: "#FF6B8F" }}
              >
                SCAN · FAILED
              </div>
              <h3
                className="bp-display mb-4"
                style={{ fontSize: "28px" }}
              >
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
                  setStatus("scanning");
                  setErrorMSG(null);
                  setCountdown(null);
                  if (typeof window !== "undefined" && isInsecureContext() && allowInsecureDevBypass()) {
                    setMediaMode("upload");
                    stopCamera();
                  }
                }}
                className="bp-button"
              >
                Retry Scan
              </button>
            </>
          ) : (
            <>
              <div className="bp-eyebrow mb-3">STATUS · PASS</div>
              <h3
                className="bp-display mb-4"
                style={{ fontSize: "28px", color: "var(--teal)" }}
              >
                Face captured
              </h3>
              <p
                className="bp-editorial mb-6 max-w-xs"
                style={{ fontSize: "14px", opacity: 0.7 }}
              >
                Biometric template registered.
              </p>
              {zkResult && (
                <a
                  href={zkResult.solscanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bp-label mb-4"
                  style={{ fontSize: "10px", color: "var(--teal)" }}
                >
                  ON-CHAIN · {zkResult.txSignature.slice(0, 8)}…{zkResult.txSignature.slice(-4)} ↗
                </a>
              )}
              <div className="flex items-center gap-2">
                <span
                  className="w-[6px] h-[6px] rounded-full animate-dot-pulse"
                  style={{ background: "var(--teal)" }}
                />
                <span className="bp-label">PROCEEDING · BREATH</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
