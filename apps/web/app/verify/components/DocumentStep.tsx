"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { apiPostForm, apiPost, getApiBase } from "../../../lib/api";

interface DocumentStepProps {
  sessionId: string;
  onSuccess: () => void;
  onFail: (reason: string) => void;
}

type ExtractedData = {
  name: string;
  cpf: string;
  dateOfBirth: string;
  documentNumber: string;
};

export default function DocumentStep({
  sessionId,
  onSuccess,
}: DocumentStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [docType, setDocType] = useState<string>("CNH");
  const [status, setStatus] = useState<"capture" | "uploading" | "review">("capture");

  const [extractedData, setExtractedData] = useState<ExtractedData>({
    name: "",
    cpf: "",
    dateOfBirth: "",
    documentNumber: "",
  });
  const [errorMSG, setErrorMSG] = useState<string | null>(null);
  const [ocrMeta, setOcrMeta] = useState<{
    engine: string;
    confidence: number;
    autoRotateDegrees?: number;
  } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedObjectUrlRef = useRef<string | null>(null);

  const revokePreviewUrl = () => {
    if (capturedObjectUrlRef.current) {
      URL.revokeObjectURL(capturedObjectUrlRef.current);
      capturedObjectUrlRef.current = null;
    }
  };

  useEffect(() => {
    async function initCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1920, max: 4096 },
            height: { ideal: 1080, max: 2160 },
          },
          audio: false,
        });
        streamRef.current = s;
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        console.warn("Camera failed to load. Will fallback to file upload.", e);
      }
    }
    initCamera();

    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      revokePreviewUrl();
    };
  }, []);

  useEffect(() => {
    if (status !== "capture" || !stream) return;
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    void v.play().catch(() => {});
  }, [status, stream]);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video.videoWidth || !video.videoHeight) {
      setErrorMSG("Camera is still starting — wait a second and try again.");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
        revokePreviewUrl();
        const imageUrl = URL.createObjectURL(blob);
        capturedObjectUrlRef.current = imageUrl;
        setCapturedImage(imageUrl);
        uploadDocument(file);
      }
    }, "image/jpeg", 0.9);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      revokePreviewUrl();
      const imageUrl = URL.createObjectURL(file);
      capturedObjectUrlRef.current = imageUrl;
      setCapturedImage(imageUrl);
      uploadDocument(file);
    }
  };

  const uploadDocument = async (file: File) => {
    setStatus("uploading");
    setErrorMSG(null);

    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("documentType", docType);
    formData.append("document", file);

    try {
      const res = await apiPostForm("/v1/verify/document", formData);
      const raw = await res.text();
      let data: {
        error?: string;
        extractedData?: ExtractedData;
        ocrConfidence?: number;
        ocrEngine?: string;
        ocrAutoRotateDegrees?: number;
      } = {};

      if (raw.trim()) {
        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          setStatus("capture");
          revokePreviewUrl();
          setCapturedImage(null);
          setErrorMSG(
            res.ok
              ? "Server returned a non-JSON response."
              : `Server error ${res.status}. ${raw.slice(0, 160).replace(/\s+/g, " ")}`
          );
          return;
        }
      }

      if (!res.ok) {
        setStatus("capture");
        revokePreviewUrl();
        setCapturedImage(null);
        const msg =
          typeof data.error === "string"
            ? data.error
            : `Request failed (HTTP ${res.status}). Check the API terminal for errors.`;
        setErrorMSG(msg);
        return;
      }

      if (!data.extractedData) {
        setStatus("capture");
        revokePreviewUrl();
        setCapturedImage(null);
        setErrorMSG("Invalid document response from server.");
        return;
      }

      setExtractedData(data.extractedData);
      if (typeof data.ocrConfidence === "number" && data.ocrEngine) {
        setOcrMeta({
          engine: String(data.ocrEngine),
          confidence: data.ocrConfidence,
          autoRotateDegrees:
            typeof data.ocrAutoRotateDegrees === "number" ? data.ocrAutoRotateDegrees : undefined,
        });
      } else {
        setOcrMeta(null);
      }
      setStatus("review");
    } catch (e) {
      setStatus("capture");
      revokePreviewUrl();
      setCapturedImage(null);
      const hint = getApiBase();
      const err = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|networkerror|load failed|aborted/i.test(err)) {
        setErrorMSG(
          `Cannot reach the API at ${hint}. Start it with pnpm dev (port 3001) and refresh.`
        );
      } else {
        setErrorMSG(`Upload failed: ${err}`);
      }
    }
  };

  const confirmData = async () => {
    setStatus("uploading");
    setErrorMSG(null);
    try {
      const res = await apiPost("/v1/verify/document/confirm", {
        sessionId,
        ...extractedData,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("review");
        setErrorMSG(
          typeof data.error === "string"
            ? data.error
            : Array.isArray(data.error)
            ? "Invalid form data."
            : "Could not confirm document."
        );
        return;
      }
      onSuccess();
    } catch {
      setStatus("review");
      setErrorMSG("Network error. Could not confirm data.");
    }
  };

  const handleChange = (field: keyof ExtractedData, value: string) => {
    setExtractedData((prev) => ({ ...prev, [field]: value }));
  };

  const fieldInputStyle: React.CSSProperties = {
    width: "100%",
    background: "transparent",
    color: "var(--bone)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    letterSpacing: "0.08em",
    padding: "10px 0",
    border: "none",
    borderBottom: "1px solid var(--bone-10)",
    outline: "none",
  };

  return (
    <div className="bp-card w-full max-w-xl mx-auto p-6">
      {/* CAPTURE */}
      {status === "capture" && (
        <>
          <div className="mb-5">
            <div className="bp-eyebrow mb-2">STEP · 00 / DOCUMENT</div>
            <h2
              className="bp-display mb-3"
              style={{ fontSize: "clamp(24px, 3vw, 32px)" }}
            >
              Identity
              <br />
              document
            </h2>
            <p
              className="bp-editorial"
              style={{ fontSize: "14px", opacity: 0.7, lineHeight: 1.4 }}
            >
              Fit the whole {docType} in the frame. Hold steady, good light.
            </p>
          </div>

          {/* Doc type toggle — underlined mono tabs */}
          <div className="flex mb-5" style={{ borderBottom: "1px solid var(--bone-10)" }}>
            {["CNH", "RG"].map((type) => (
              <button
                key={type}
                onClick={() => setDocType(type)}
                className="flex-1 py-3 bp-label transition-colors"
                style={{
                  fontSize: "10px",
                  color: docType === type ? "var(--teal)" : "var(--dim)",
                  borderBottom:
                    docType === type
                      ? "1px solid var(--teal)"
                      : "1px solid transparent",
                  marginBottom: "-1px",
                }}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Camera viewport */}
          <div className="bp-viewport mb-5" style={{ aspectRatio: "16 / 10" }}>
            <span className="bp-corner-bl" />
            <span className="bp-corner-br" />
            {stream ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* ID-1 card guide overlay */}
                <div className="absolute inset-0 z-[2] pointer-events-none flex items-center justify-center p-4">
                  <div
                    className="relative"
                    style={{
                      width: "min(100%, 520px)",
                      aspectRatio: "85 / 54",
                      outline: "1px solid var(--teal)",
                      boxShadow: "0 0 0 9999px rgba(255, 255, 255, 0.65)",
                    }}
                  >
                    <span className="absolute top-0 left-0 w-6 h-6" style={{ borderTop: "2px solid var(--teal)", borderLeft: "2px solid var(--teal)" }} />
                    <span className="absolute top-0 right-0 w-6 h-6" style={{ borderTop: "2px solid var(--teal)", borderRight: "2px solid var(--teal)" }} />
                    <span className="absolute bottom-0 left-0 w-6 h-6" style={{ borderBottom: "2px solid var(--teal)", borderLeft: "2px solid var(--teal)" }} />
                    <span className="absolute bottom-0 right-0 w-6 h-6" style={{ borderBottom: "2px solid var(--teal)", borderRight: "2px solid var(--teal)" }} />
                  </div>
                </div>
                <div className="absolute top-3 right-3 z-[4] text-right space-y-1">
                  <div className="bp-readout" style={{ fontSize: "10px" }}>
                    DOC · {docType}
                  </div>
                  <div className="bp-readout" style={{ fontSize: "10px" }}>
                    STATE · READY
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6">
                <span className="bp-label">CAMERA · UNAVAILABLE</span>
                <p
                  className="bp-editorial text-center max-w-[280px]"
                  style={{ fontSize: "13px", opacity: 0.6 }}
                >
                  Use <strong>Choose photo</strong> below. http:// + Wi-Fi IP
                  often blocks camera.
                </p>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
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

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileUpload}
          />
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleCapture}
              disabled={!stream}
              className="bp-button flex-1 justify-center"
            >
              Capture
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="bp-button flex-1 justify-center"
            >
              Choose photo
            </button>
          </div>
        </>
      )}

      {/* UPLOADING */}
      {status === "uploading" && (
        <div className="h-64 flex flex-col items-center justify-center gap-3">
          <span
            className="w-[8px] h-[8px] rounded-full animate-dot-pulse"
            style={{
              background: "var(--teal)",
              boxShadow: "0 0 12px var(--teal)",
            }}
          />
          <span className="bp-label" style={{ color: "var(--bone)" }}>
            SCANNING · OCR ENGINE
          </span>
        </div>
      )}

      {/* REVIEW */}
      {status === "review" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="mb-5">
            <div className="bp-eyebrow mb-2">EXTRACTED · RECORD</div>
            <h2
              className="bp-display mb-3"
              style={{ fontSize: "clamp(22px, 3vw, 30px)" }}
            >
              Review data
            </h2>
            {ocrMeta && (
              <p
                className="bp-editorial"
                style={{ fontSize: "14px", opacity: 0.7, lineHeight: 1.4 }}
              >
                Correct any mistakes before confirming.
              </p>
            )}
          </div>

          {/* Thumbnail */}
          {capturedImage && (
            <div
              className="bp-viewport mb-5"
              style={{ aspectRatio: "16 / 10" }}
            >
              <span className="bp-corner-bl" />
              <span className="bp-corner-br" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={capturedImage}
                alt="Captured"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* OCR meta readout */}
          {ocrMeta && (
            <div className="mb-5 space-y-0">
              <div
                className="flex items-center justify-between py-2"
                style={{ borderTop: "1px solid var(--bone-10)" }}
              >
                <span className="bp-label">ENGINE</span>
                <span className="bp-readout" style={{ fontSize: "10px" }}>
                  {ocrMeta.engine.toUpperCase()}
                </span>
              </div>
              <div
                className="flex items-center justify-between py-2"
                style={{ borderTop: "1px solid var(--bone-10)" }}
              >
                <span className="bp-label">CONF</span>
                <span className="bp-readout" style={{ fontSize: "10px" }}>
                  {ocrMeta.confidence}%
                </span>
              </div>
              <div
                className="flex items-center justify-between py-2"
                style={{
                  borderTop: "1px solid var(--bone-10)",
                  borderBottom: "1px solid var(--bone-10)",
                }}
              >
                <span className="bp-label">ROTATE</span>
                <span className="bp-readout" style={{ fontSize: "10px" }}>
                  {ocrMeta.autoRotateDegrees ?? 0}°
                </span>
              </div>
            </div>
          )}

          {/* Editable fields */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="bp-label block mb-1">NAME</label>
              <input
                type="text"
                value={extractedData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                style={fieldInputStyle}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="bp-label block mb-1">CPF</label>
                <input
                  type="text"
                  value={extractedData.cpf}
                  onChange={(e) => handleChange("cpf", e.target.value)}
                  style={fieldInputStyle}
                />
              </div>
              <div>
                <label className="bp-label block mb-1">DOC · N°</label>
                <input
                  type="text"
                  value={extractedData.documentNumber}
                  onChange={(e) =>
                    handleChange("documentNumber", e.target.value)
                  }
                  style={fieldInputStyle}
                />
              </div>
            </div>
            <div>
              <label className="bp-label block mb-1">DATE OF BIRTH</label>
              <input
                type="text"
                value={extractedData.dateOfBirth}
                onChange={(e) => handleChange("dateOfBirth", e.target.value)}
                style={fieldInputStyle}
              />
            </div>
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

          <div className="flex gap-3">
            <button
              onClick={() => {
                revokePreviewUrl();
                setStatus("capture");
                setCapturedImage(null);
                setErrorMSG(null);
                setOcrMeta(null);
              }}
              className="bp-button flex-1 justify-center"
            >
              Retake
            </button>
            <button
              onClick={confirmData}
              className="bp-button flex-1 justify-center"
              style={{ borderColor: "var(--teal)", color: "var(--teal)" }}
            >
              Confirm
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
