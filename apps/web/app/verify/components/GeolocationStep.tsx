"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { apiPost } from "../../../lib/api";
import { allowInsecureDevBypass, isInsecureContext } from "../../../lib/insecureContext";

interface GeolocationStepProps {
  sessionId: string;
  onSuccess: () => void;
  onFail: (reason: string) => void;
}

export default function GeolocationStep({
  sessionId,
  onSuccess,
  onFail,
}: GeolocationStepProps) {
  const [loading, setLoading] = useState(false);
  const [errorMSG, setErrorMSG] = useState<string | null>(null);
  const [successMSG, setSuccessMSG] = useState<string | null>(null);
  const [secureContext, setSecureContext] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    setSecureContext(!isInsecureContext());
  }, []);

  const submitCoordsToApi = async (latitude: number, longitude: number) => {
    setLoading(true);
    setErrorMSG(null);
    setCoords({ lat: latitude, lon: longitude });
    try {
      const res = await apiPost("/v1/verify/geolocation", {
        sessionId,
        latitude,
        longitude,
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMSG(data.error || "Verification failed");
        setLoading(false);
        return;
      }

      if (data.allowed) {
        setSuccessMSG(
          `Location verified: ${data.ipCountry || "Brazil"} ${data.ipRegion ? `(${data.ipRegion})` : ""}`
        );
        setTimeout(() => {
          onSuccess();
        }, 1500);
      } else {
        if (data.vpnDetected) {
          setLoading(false);
          const err = "Suspicious network detected. Please disable any VPNs and try again.";
          setErrorMSG(err);
          onFail(err);
        } else {
          setLoading(false);
          const err = "You are outside our approved jurisdiction. Verification blocked.";
          setErrorMSG(err);
          onFail(err);
        }
      }
    } catch {
      setLoading(false);
      setErrorMSG("Network error checking location");
    }
  };

  const bypassWithDevCoordinates = () => {
    void submitCoordsToApi(-23.5505, -46.6333);
  };

  const requestGeolocation = () => {
    setLoading(true);
    setErrorMSG(null);

    if (!navigator.geolocation) {
      setLoading(false);
      setErrorMSG("Geolocation is not supported by your browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        void submitCoordsToApi(latitude, longitude);
      },
      () => {
        setLoading(false);
        if (isInsecureContext()) {
          setErrorMSG(
            "Your phone's Location is fine — browsers block GPS on http:// pages opened by Wi-Fi IP (not a secure context). Use \u201CDev bypass\u201D below, or use HTTPS / localhost."
          );
        } else {
          setErrorMSG(
            "Location access denied for this site. Allow Location in browser/site settings, then tap Verify again."
          );
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  const latReadout = coords ? coords.lat.toFixed(4) : "--.----";
  const lonReadout = coords ? coords.lon.toFixed(4) : "--.----";

  return (
    <div className="bp-card w-full max-w-md mx-auto p-6">
      {/* Editorial header */}
      <div className="mb-6">
        <div className="bp-eyebrow mb-2">STEP · 01 / LOCATION</div>
        <h2
          className="bp-display mb-3"
          style={{ fontSize: "clamp(24px, 3vw, 32px)" }}
        >
          Verify your
          <br />
          jurisdiction
        </h2>
        <p
          className="bp-editorial"
          style={{ fontSize: "15px", opacity: 0.7, lineHeight: 1.4 }}
        >
          We need to confirm you are currently located in an approved
          jurisdiction.
        </p>
      </div>

      {/* Map frame */}
      <div
        className="bp-viewport mb-6"
        style={{ aspectRatio: "16 / 9" }}
      >
        <span className="bp-corner-bl" />
        <span className="bp-corner-br" />

        {/* Crosshair lines */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, transparent calc(50% - 0.5px), rgba(122, 224, 212, 0.25) 50%, transparent calc(50% + 0.5px)), linear-gradient(to bottom, transparent calc(50% - 0.5px), rgba(122, 224, 212, 0.25) 50%, transparent calc(50% + 0.5px))",
          }}
        />

        {/* Concentric rings + pulsing dot */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="absolute w-24 h-24 rounded-full animate-dot-pulse"
            style={{
              border: "1px solid var(--teal-20)",
              animationDuration: "3s",
            }}
          />
          <span
            className="absolute w-16 h-16 rounded-full animate-dot-pulse"
            style={{
              border: "1px solid var(--teal-20)",
              animationDuration: "4s",
              animationDelay: "0.5s",
            }}
          />
          <span
            className="w-[10px] h-[10px] rounded-full animate-dot-pulse"
            style={{
              background: "var(--teal)",
              boxShadow: "0 0 12px var(--teal)",
            }}
          />
        </div>

        {/* Readout overlay */}
        <div className="absolute top-3 right-3 z-[4] text-right space-y-1">
          <div className="bp-readout" style={{ fontSize: "10px" }}>
            LAT · {latReadout}°
          </div>
          <div className="bp-readout" style={{ fontSize: "10px" }}>
            LON · {lonReadout}°
          </div>
        </div>
      </div>

      {/* Tabular readouts */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div
          className="flex justify-between py-2 px-3"
          style={{ borderBottom: "1px solid var(--bone-10)" }}
        >
          <span className="bp-label">REGION</span>
          <span className="bp-readout" style={{ fontSize: "10px" }}>
            {coords ? "SP" : "—"}
          </span>
        </div>
        <div
          className="flex justify-between py-2 px-3"
          style={{ borderBottom: "1px solid var(--bone-10)" }}
        >
          <span className="bp-label">VPN</span>
          <span
            className="bp-readout"
            style={{
              fontSize: "10px",
              color: successMSG ? "var(--teal)" : "var(--bone)",
            }}
          >
            {successMSG ? "CLEAR" : "CHECK"}
          </span>
        </div>
      </div>

      {/* Dev context warning */}
      {!secureContext && allowInsecureDevBypass() && (
        <div
          className="mb-4 px-4 py-3"
          style={{ border: "1px solid var(--teal-20)" }}
        >
          <div className="bp-eyebrow mb-1.5">NOTE · HTTP CONTEXT</div>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--bone)",
              lineHeight: 1.5,
            }}
          >
            You&apos;re on <strong>http://</strong> via a network IP. Most
            mobile browsers <strong>will not run GPS</strong> here (security
            rule).
          </p>
        </div>
      )}

      {errorMSG && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 px-4 py-3"
          style={{ borderLeft: "2px solid #FF6B8F", background: "rgba(255, 107, 143, 0.06)" }}
        >
          <div className="bp-eyebrow mb-1.5" style={{ color: "#FF6B8F" }}>
            FAULT
          </div>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--bone)",
              lineHeight: 1.5,
            }}
          >
            {errorMSG}
          </p>
        </motion.div>
      )}

      {successMSG && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 px-4 py-3"
          style={{
            borderLeft: "2px solid var(--teal)",
            background: "var(--teal-10)",
          }}
        >
          <div className="bp-eyebrow mb-1.5">STATUS · PASS</div>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--bone)",
              lineHeight: 1.5,
            }}
          >
            {successMSG}
          </p>
        </motion.div>
      )}

      {!successMSG && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={requestGeolocation}
            disabled={loading}
            className="bp-button w-full justify-center flex items-center gap-2"
          >
            {loading ? (
              <>
                <span
                  className="w-[6px] h-[6px] rounded-full animate-dot-pulse"
                  style={{ background: "var(--teal)" }}
                />
                <span>Verifying</span>
              </>
            ) : (
              <span>Verify My Location (GPS)</span>
            )}
          </button>
          {!secureContext && allowInsecureDevBypass() && (
            <button
              type="button"
              onClick={bypassWithDevCoordinates}
              disabled={loading}
              className="bp-button w-full justify-center"
              style={{ fontSize: "10px", padding: "10px 16px" }}
            >
              Dev bypass · Brazil coordinates
            </button>
          )}
        </div>
      )}
    </div>
  );
}
