/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Enterprise fintech compliance palette: slate/zinc neutrals as
        // the base, with emerald/amber/red reserved exclusively for
        // reconciliation-status and risk-tier semantics (never used
        // decoratively elsewhere), so color always means the same thing.
        status: {
          matched: "#059669", // emerald-600 — MATCHED
          mismatch: "#d97706", // amber-600 — AMOUNT_MISMATCH / TIER_2
          missing: "#dc2626", // red-600 — MISSING_SFT / MISSING_GSTR / TIER_1
        },
      },
    },
  },
  plugins: [],
};
