"use client";

import { motion } from "framer-motion";

const STEPS = [
  { key: "geolocation", label: "Location", code: "00" },
  { key: "face", label: "Face", code: "01" },
  { key: "breath", label: "Breath", code: "02" },
];

interface ProgressBarProps {
  currentStep: string;
}

export default function ProgressBar({ currentStep }: ProgressBarProps) {
  const stepOrder = STEPS.map((s) => s.key);
  const currentIndex = stepOrder.indexOf(currentStep);
  const activeIndex =
    currentStep === "complete"
      ? STEPS.length
      : currentStep === "failed"
      ? -1
      : currentIndex;

  return (
    <div className="w-full flex items-start gap-6 mb-10">
      {STEPS.map((step, i) => {
        const isCompleted = i < activeIndex;
        const isActive = i === activeIndex;
        const color = isCompleted || isActive ? "var(--teal)" : "var(--dim)";

        return (
          <div key={step.key} className="flex-1 flex flex-col gap-3">
            {/* Bar segment */}
            <div
              className="w-full h-px relative"
              style={{ background: "var(--bone-10)" }}
            >
              <motion.div
                className="absolute inset-y-0 left-0 h-px"
                initial={{ width: "0%" }}
                animate={{ width: isCompleted || isActive ? "100%" : "0%" }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
                style={{
                  background: "var(--teal)",
                  boxShadow: isActive ? "0 0 6px var(--teal)" : "none",
                }}
              />
            </div>
            {/* Label */}
            <div className="flex items-center gap-2">
              <span className="bp-readout" style={{ fontSize: "9px", color }}>
                {step.code}
              </span>
              <span className="bp-label" style={{ fontSize: "10px", color }}>
                {step.label}
              </span>
              {isActive && (
                <span
                  className="w-[5px] h-[5px] rounded-full animate-dot-pulse ml-auto"
                  style={{
                    background: "var(--teal)",
                    boxShadow: "0 0 8px var(--teal)",
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
