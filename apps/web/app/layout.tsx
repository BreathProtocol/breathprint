// @repo/ui/styles.css dropped — reskin uses the local overrides in globals.css.
// If UI package components are wired in later, run `npm --workspace=@repo/ui run build:styles` first.
import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import AmbientBackground from "../components/layout/AmbientBackground";
import HUD from "../components/layout/HUD";
import Cursor from "../components/layout/Cursor";
import Web3AuthSolanaProvider from "../components/Web3AuthSolanaProvider";

export const metadata: Metadata = {
  title: "BreathPrint — Verification",
  description: "Next Generation Biometric Identity Verification",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@200;300;400&family=JetBrains+Mono:wght@300;400;500&family=Cormorant+Garamond:ital,wght@1,300;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        <Script id="ignore-wallet-extension-errors" strategy="beforeInteractive">
          {`(function(){
  function ignore(msg,stack){
    var b=(msg||"")+"\\n"+(stack||"");
    return /failed to connect to metamask/i.test(b)||/nkbihfbeogaeaoehlefnkodbefgpgknn/i.test(b);
  }
  window.addEventListener("unhandledrejection",function(e){
    var r=e.reason,m=r&&r.message?r.message:String(r==null?"":r),s=r&&r.stack?r.stack:"";
    if(ignore(m,s))e.preventDefault();
  },true);
  window.addEventListener("error",function(e){
    if(ignore(e.message,e.error&&e.error.stack))e.preventDefault();
  },true);
})();`}
        </Script>
        <AmbientBackground />
        <Web3AuthSolanaProvider>
          <div className="relative z-[1] min-h-screen">{children}</div>
        </Web3AuthSolanaProvider>
        <HUD />
        <Cursor />
      </body>
    </html>
  );
}
