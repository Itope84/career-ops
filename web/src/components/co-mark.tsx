import { instrumentSerif } from "@/lib/fonts";

// Brand mark for the temitops checkout — "TO" (Temitope's career-ops) on
// brand orange in Instrument Serif. Matches the favicon (src/app/icon.svg)
// so the app reads as a sibling. Kept visually distinct from an upstream/
// sibling checkout's "co" mark so the two are easy to tell apart at a glance.
export function CoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`${instrumentSerif.className} inline-flex shrink-0 items-center justify-center rounded-md bg-brand text-white`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.78),
        letterSpacing: "0.01em",
        lineHeight: 1,
        paddingBottom: Math.round(size * 0.08),
      }}
    >
      TO
    </span>
  );
}
