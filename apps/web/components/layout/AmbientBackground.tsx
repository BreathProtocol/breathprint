/**
 * Ambient cream background — shared across every non-landing route.
 * The 3D helix only lives on /landing.html. App pages get a calmer
 * vocabulary: cream paper, warm violet/teal glows, faint grain + scanlines.
 *
 * Fixed, z-0, pointer-events-none. Rendered once from layout.tsx.
 */
export default function AmbientBackground() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
      style={{ background: "var(--obsidian)" }}
    >
      {/* Warm glow layer — soft tan + terracotta nebulas on cream */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 1100px 800px at 22% 28%, rgba(233, 214, 196, 0.55), transparent 65%),
            radial-gradient(ellipse 900px 700px at 78% 72%, rgba(201, 123, 94, 0.10), transparent 65%),
            radial-gradient(ellipse 700px 520px at 50% 50%, rgba(251, 246, 236, 0.60), transparent 70%)
          `,
        }}
      />

      {/* Paper grid — 1px lines every 80px */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(31, 26, 20, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(31, 26, 20, 0.04) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
        }}
      />

      {/* Vignette — soft dark fall-off at the edges */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(31, 26, 20, 0.08) 100%)",
          mixBlendMode: "multiply",
        }}
      />

      {/* Grain — inline SVG fractalNoise, multiply for warm texture */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.08,
          mixBlendMode: "multiply",
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='5'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
          backgroundRepeat: "repeat",
        }}
      />

      {/* Scanlines */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "repeating-linear-gradient(to bottom, rgba(31, 26, 20, 0.025) 0 1px, transparent 1px 3px)",
          opacity: 0.4,
        }}
      />
    </div>
  );
}
