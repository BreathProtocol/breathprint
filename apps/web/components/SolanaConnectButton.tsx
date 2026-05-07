"use client";

import { useSolanaWallet } from "./Web3AuthSolanaProvider";

function shortAddress(a: string, head = 4, tail = 4) {
  if (a.length < head + tail + 2) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export default function SolanaConnectButton() {
  const { ready, loading, address, connect, disconnect, error } = useSolanaWallet();

  if (!ready) {
    return (
      <button className="bp-button" disabled>
        <span className="bp-label" style={{ fontSize: "10px", opacity: 0.5 }}>
          INIT · WEB3AUTH
        </span>
      </button>
    );
  }

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="bp-readout"
          style={{ fontSize: "11px", color: "var(--teal)" }}
          title={address}
        >
          {shortAddress(address, 5, 5)}
        </span>
        <button
          className="bp-button"
          onClick={() => void disconnect()}
          disabled={loading}
        >
          <span className="bp-label" style={{ fontSize: "10px" }}>
            DISCONNECT
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        className="bp-button"
        onClick={() => void connect()}
        disabled={loading}
      >
        <span className="bp-label" style={{ fontSize: "10px" }}>
          {loading ? "CONNECTING…" : "CONNECT · SOLANA"}
        </span>
      </button>
      {error && (
        <span className="bp-label" style={{ fontSize: "9px", color: "#FF6B8F" }}>
          {error.slice(0, 40)}
        </span>
      )}
    </div>
  );
}
