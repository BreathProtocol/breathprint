"use client";

/**
 * BreathPrint — Explorer
 *
 * Displays the user's on-chain biometric attestations stored as Light Protocol
 * compressed PDAs, with Solscan links for every transaction.
 *
 * Reachable at /explorer. Read-only — purely shows what's already on-chain.
 *
 * NOTE: Requires a connected Solana wallet. For local dev without a wallet,
 * pass `?wallet=<pubkey>` in the URL to inspect any account.
 */

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Connection, PublicKey } from "@solana/web3.js";
import { createRpc } from "@lightprotocol/stateless.js";

const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY ?? "";
const PROGRAM_ID =
  process.env.NEXT_PUBLIC_BREATHPRINT_PROGRAM_ID ??
  "BPrnt1111111111111111111111111111111111111";
const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet";

interface TxRecord {
  signature: string;
  slot: number;
  blockTime: number | null;
  type: "registration" | "verification" | "revocation" | "unknown";
  solscanUrl: string;
}

function solscanTx(sig: string) {
  return `https://solscan.io/tx/${sig}?cluster=${NETWORK}`;
}
function solscanAccount(addr: string) {
  return `https://solscan.io/account/${addr}?cluster=${NETWORK}`;
}

function shortHash(s: string, head = 6, tail = 4): string {
  if (!s || s.length < head + tail + 2) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function formatTime(ts: number | null) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default function ExplorerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-4">
          <span className="bp-label" style={{ color: "var(--bone)" }}>
            LOADING · EXPLORER
          </span>
        </div>
      }
    >
      <ExplorerContent />
    </Suspense>
  );
}

function ExplorerContent() {
  const params = useSearchParams();
  const walletParam = params.get("wallet");

  const [wallet, setWallet] = useState<PublicKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [txs, setTxs] = useState<TxRecord[]>([]);

  useEffect(() => {
    if (walletParam) {
      try {
        setWallet(new PublicKey(walletParam));
      } catch {
        setError("Invalid wallet address in ?wallet= param");
        setLoading(false);
      }
    } else {
      // No wallet — show empty state with hint
      setLoading(false);
    }
  }, [walletParam]);

  const rpc = useMemo(() => {
    if (!HELIUS_API_KEY) return null;
    const url = `https://${NETWORK}.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
    return createRpc(url, url);
  }, []);

  useEffect(() => {
    if (!wallet || !rpc) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sigs = await rpc.getCompressionSignaturesForOwner(wallet);
        const records: TxRecord[] = (sigs.items ?? []).map((sig: any) => ({
          signature: sig.signature,
          slot: sig.slot ?? 0,
          blockTime: sig.blockTime ?? null,
          type: classifyTxType(sig),
          solscanUrl: solscanTx(sig.signature),
        }));
        if (!cancelled) setTxs(records);
      } catch (e: any) {
        if (!cancelled) {
          setError(
            e?.message ??
              "Failed to query Light Protocol compression signatures. " +
                "Check NEXT_PUBLIC_HELIUS_API_KEY."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, rpc]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-start p-4 pt-24 md:pt-28">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="mb-10">
          <div className="bp-eyebrow mb-4">EXPLORER · ON-CHAIN ATTESTATIONS</div>
          <h1
            className="bp-display"
            style={{ fontSize: "clamp(36px, 6vw, 64px)" }}
          >
            <span className="block">Your biometric</span>
            <span
              className="block"
              style={{ color: "var(--teal)", opacity: 0.92 }}
            >
              ledger
            </span>
          </h1>
          <p
            className="bp-editorial mt-4"
            style={{
              fontSize: "clamp(14px, 1.4vw, 17px)",
              color: "var(--bone)",
              opacity: 0.7,
            }}
          >
            Every face registration and breathing verification is committed to
            Solana as a Light Protocol compressed account. Raw biometrics never
            leave your device — only the Poseidon hash commitment is on-chain.
          </p>
        </div>

        {/* Identity card */}
        <div className="bp-card w-full p-6 md:p-8 mb-6">
          <div className="bp-eyebrow mb-3">SPECIMEN</div>
          {wallet ? (
            <>
              <div
                className="bp-readout mb-2"
                style={{ fontSize: "13px", wordBreak: "break-all" }}
              >
                {wallet.toBase58()}
              </div>
              <a
                href={solscanAccount(wallet.toBase58())}
                target="_blank"
                rel="noopener noreferrer"
                className="bp-label"
                style={{ color: "var(--teal)" }}
              >
                VIEW WALLET ON SOLSCAN ↗
              </a>
            </>
          ) : (
            <p className="bp-editorial" style={{ opacity: 0.7 }}>
              No wallet connected. Append <code>?wallet=&lt;pubkey&gt;</code> to
              the URL to inspect a specimen, or finish a verification at{" "}
              <a
                href="/verify"
                className="bp-label"
                style={{ color: "var(--teal)" }}
              >
                /verify
              </a>
              .
            </p>
          )}

          <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="bp-eyebrow">PROGRAM</div>
              <a
                href={solscanAccount(PROGRAM_ID)}
                target="_blank"
                rel="noopener noreferrer"
                className="bp-readout"
                style={{ color: "var(--teal)", fontSize: "12px" }}
              >
                {shortHash(PROGRAM_ID, 8, 6)} ↗
              </a>
            </div>
            <div>
              <div className="bp-eyebrow">STORAGE</div>
              <div
                className="bp-readout"
                style={{ fontSize: "12px", opacity: 0.7 }}
              >
                LIGHT · ZK COMPRESSED
              </div>
              <div
                className="bp-readout"
                style={{ fontSize: "10px", opacity: 0.5 }}
              >
                ~0.000015 SOL / acct
              </div>
            </div>
          </div>
        </div>

        {/* Errors */}
        {error && (
          <div
            className="bp-card w-full p-6 mb-6"
            style={{ borderColor: "rgba(255, 107, 143, 0.35)" }}
          >
            <div
              className="bp-eyebrow"
              style={{ color: "#FF6B8F" }}
            >
              EXPLORER · ERROR
            </div>
            <p
              className="bp-editorial mt-2"
              style={{ fontSize: "14px", color: "#FF6B8F" }}
            >
              {error}
            </p>
          </div>
        )}

        {/* Tx history */}
        <div className="bp-card w-full p-6 md:p-8">
          <div className="flex items-center justify-between mb-4">
            <div className="bp-eyebrow">TRANSACTIONS · {txs.length}</div>
            {loading && (
              <span
                className="bp-label"
                style={{ color: "var(--dim)", fontSize: "10px" }}
              >
                FETCHING…
              </span>
            )}
          </div>

          {!loading && txs.length === 0 && wallet && !error && (
            <p
              className="bp-editorial"
              style={{ fontSize: "14px", opacity: 0.6 }}
            >
              No on-chain attestations yet for this specimen. Complete a
              verification at <a href="/verify" style={{ color: "var(--teal)" }}>/verify</a>.
            </p>
          )}

          {txs.length > 0 && (
            <div className="space-y-3">
              {txs.map((tx) => (
                <a
                  key={tx.signature}
                  href={tx.solscanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 rounded border transition hover:border-[var(--teal)]"
                  style={{ borderColor: "rgba(255,255,255,0.08)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div
                        className="bp-readout truncate"
                        style={{ fontSize: "13px" }}
                      >
                        {shortHash(tx.signature, 12, 8)}
                      </div>
                      <div
                        className="bp-label mt-1"
                        style={{
                          fontSize: "10px",
                          color:
                            tx.type === "verification"
                              ? "var(--teal)"
                              : tx.type === "revocation"
                                ? "#FF6B8F"
                                : "var(--bone)",
                        }}
                      >
                        {tx.type.toUpperCase()}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div
                        className="bp-readout"
                        style={{ fontSize: "11px", opacity: 0.7 }}
                      >
                        SLOT {tx.slot.toLocaleString()}
                      </div>
                      <div
                        className="bp-readout"
                        style={{ fontSize: "10px", opacity: 0.5 }}
                      >
                        {formatTime(tx.blockTime)}
                      </div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function classifyTxType(sig: any): TxRecord["type"] {
  // Without parsing program logs, we can't perfectly classify. The Light
  // Protocol indexer doesn't expose discriminators here. As a heuristic:
  // first-seen signature for an owner is treated as registration, subsequent
  // ones as verifications. Refinement: parse instruction data via getTransaction.
  const t = (sig?.type ?? "").toString().toLowerCase();
  if (t.includes("verify")) return "verification";
  if (t.includes("revoke")) return "revocation";
  if (t.includes("register")) return "registration";
  return "unknown";
}
