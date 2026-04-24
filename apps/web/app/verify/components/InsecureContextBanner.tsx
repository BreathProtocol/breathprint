"use client";

import { useEffect, useState } from "react";
import { allowInsecureDevBypass, isInsecureContext } from "../../../lib/insecureContext";

/**
 * Explains why camera/mic/GPS fail on http:// + LAN IP and points to HTTPS / localhost.
 */
export default function InsecureContextBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isInsecureContext());
  }, []);

  if (!show) return null;

  return (
    <div className="w-full max-w-2xl mx-auto mb-4">
      <div
        className="px-4 py-3"
        style={{ border: "1px solid var(--teal-20)" }}
      >
        <div className="bp-eyebrow mb-2">WARNING · INSECURE CONTEXT</div>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            letterSpacing: "0.06em",
            color: "var(--bone)",
            lineHeight: 1.55,
          }}
        >
          You&apos;re using <strong>http://</strong> with your Wi-Fi IP. iOS and
          Android often <strong>block camera and mic</strong> here (same rule as
          GPS).
        </p>
        <p
          className="mt-2"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            letterSpacing: "0.06em",
            color: "var(--bone)",
            lineHeight: 1.55,
          }}
        >
          <strong>Fix:</strong> use <strong>HTTPS</strong> (
          <code style={{ color: "var(--teal)" }}>
            next dev --experimental-https
          </code>
          , ngrok, or Cloudflare Tunnel), or test on a PC with{" "}
          <strong>http://localhost</strong>.
        </p>
        {allowInsecureDevBypass() && (
          <p
            className="mt-2 bp-label"
            style={{ color: "var(--teal)", fontSize: "10px" }}
          >
            DEV · GALLERY UPLOAD AVAILABLE WHERE SHOWN
          </p>
        )}
      </div>
    </div>
  );
}
