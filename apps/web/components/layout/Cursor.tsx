"use client";

import { useEffect, useRef } from "react";

/**
 * Custom cursor — 24px teal-bordered circle + teal dot.
 * Snappy eased follow (lerp 0.35).
 * Disabled on touch / coarse pointers via media query in globals.css.
 */
export default function Cursor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(hover: none), (pointer: coarse)").matches) return;

    const el = ref.current;
    if (!el) return;

    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 2;
    let cx = tx;
    let cy = ty;
    let raf = 0;

    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
    };

    const loop = () => {
      cx += (tx - cx) * 0.35;
      cy += (ty - cy) * 0.35;
      el.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    raf = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="hidden md:block fixed top-0 left-0 z-[100] pointer-events-none w-6 h-6 rounded-full"
      style={{
        border: "1px solid var(--teal)",
        boxShadow: "0 0 8px rgba(122, 224, 212, 0.4)",
        willChange: "transform",
      }}
    >
      <span
        className="absolute top-1/2 left-1/2 w-[2px] h-[2px] rounded-full"
        style={{
          background: "var(--teal)",
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}
