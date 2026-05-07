"use client";

/**
 * Web3Auth — Solana Devnet provider.
 *
 * Wraps children with a Web3Auth modal context configured for Solana devnet.
 * Exposes `useSolanaWallet()` so any component (e.g. /explorer) can access
 * the connected pubkey, sign transactions, and disconnect.
 *
 * Coexists with the existing wagmi (EVM) provider — Web3Auth handles the
 * Solana-only flow for BreathPrint attestations.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CHAIN_NAMESPACES,
  WEB3AUTH_NETWORK,
  type IProvider,
} from "@web3auth/base";
import { Web3Auth } from "@web3auth/modal";
import { SolanaPrivateKeyProvider, SolanaWallet } from "@web3auth/solana-provider";
import { Connection, PublicKey } from "@solana/web3.js";

const CLIENT_ID = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID ?? "";
const NETWORK_ENV = process.env.NEXT_PUBLIC_WEB3AUTH_NETWORK ?? "sapphire_devnet";
const SOLANA_NETWORK =
  process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet";
const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY ?? "";

const RPC_URL = HELIUS_API_KEY
  ? `https://${SOLANA_NETWORK}.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : `https://api.${SOLANA_NETWORK}.solana.com`;

const chainConfig = {
  chainNamespace: CHAIN_NAMESPACES.SOLANA,
  // 0x1 = mainnet, 0x2 = testnet, 0x3 = devnet (per Web3Auth Solana convention)
  chainId: SOLANA_NETWORK === "mainnet-beta" ? "0x1" : "0x3",
  rpcTarget: RPC_URL,
  displayName: `Solana ${SOLANA_NETWORK}`,
  blockExplorerUrl: `https://solscan.io?cluster=${SOLANA_NETWORK}`,
  ticker: "SOL",
  tickerName: "Solana",
};

interface SolanaWalletContextValue {
  publicKey: PublicKey | null;
  address: string | null;
  provider: IProvider | null;
  connection: Connection;
  ready: boolean;
  loading: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Sign a UTF-8 message with the connected Solana key. Returns hex signature. */
  signMessage: (message: string) => Promise<string>;
}

const Ctx = createContext<SolanaWalletContextValue>({
  publicKey: null,
  address: null,
  provider: null,
  connection: new Connection(RPC_URL, "confirmed"),
  ready: false,
  loading: false,
  error: null,
  connect: async () => {},
  disconnect: async () => {},
  signMessage: async () => { throw new Error("Solana wallet not initialized"); },
});

export function useSolanaWallet() {
  return useContext(Ctx);
}

export default function Web3AuthSolanaProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [web3auth, setWeb3auth] = useState<Web3Auth | null>(null);
  const [provider, setProvider] = useState<IProvider | null>(null);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connection = useMemo(
    () => new Connection(RPC_URL, "confirmed"),
    []
  );

  // ── Init the modal once on mount ────────────────────────────
  useEffect(() => {
    if (!CLIENT_ID) {
      setError("NEXT_PUBLIC_WEB3AUTH_CLIENT_ID not set");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const privateKeyProvider = new SolanaPrivateKeyProvider({
          config: { chainConfig },
        });
        const w3a = new Web3Auth({
          clientId: CLIENT_ID,
          web3AuthNetwork:
            NETWORK_ENV === "sapphire_mainnet"
              ? WEB3AUTH_NETWORK.SAPPHIRE_MAINNET
              : WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
          privateKeyProvider,
        });
        await w3a.initModal();
        if (cancelled) return;
        setWeb3auth(w3a);
        if (w3a.connected && w3a.provider) {
          await syncProvider(w3a.provider);
        }
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Web3Auth init failed";
          setError(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncProvider = useCallback(async (p: IProvider) => {
    setProvider(p);
    try {
      const accounts = (await p.request({ method: "getAccounts" })) as string[];
      if (accounts && accounts[0]) {
        setPublicKey(new PublicKey(accounts[0]));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "getAccounts failed";
      setError(msg);
    }
  }, []);

  const connect = useCallback(async () => {
    if (!web3auth) return;
    setLoading(true);
    setError(null);
    try {
      const p = await web3auth.connect();
      if (p) await syncProvider(p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "connect failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [web3auth, syncProvider]);

  const disconnect = useCallback(async () => {
    if (!web3auth) return;
    setLoading(true);
    try {
      await web3auth.logout();
      setProvider(null);
      setPublicKey(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "disconnect failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [web3auth]);

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!provider) throw new Error("Wallet not connected");
    const solanaWallet = new SolanaWallet(provider);
    const bytes = new TextEncoder().encode(message);
    const signed = await solanaWallet.signMessage(bytes);
    return Buffer.from(signed).toString("hex");
  }, [provider]);

  const value: SolanaWalletContextValue = {
    publicKey,
    address: publicKey?.toBase58() ?? null,
    provider,
    connection,
    ready,
    loading,
    error,
    connect,
    disconnect,
    signMessage,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
