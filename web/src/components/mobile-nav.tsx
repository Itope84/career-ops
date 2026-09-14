"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { CoMark } from "@/components/co-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkerPills } from "@/components/jobs/worker-pills";
import { UsageMeter } from "@/components/usage-meter";
import { instrumentSerif } from "@/lib/fonts";
import { NAV_ITEMS, isActivePath } from "@/lib/nav-items";
import { useJobs } from "@/components/jobs/job-store";

// Mobile navigation (< md): A bottom tab bar for primary routes, and a right slide-over 
// drawer for "More".
const STYLE = `
.co-mnav { position: sticky; top: 0; z-index: 30; background: var(--bg); padding-top: calc(env(safe-area-inset-top) + .8rem); }
.co-bottom-nav {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 50;
  background: var(--bg);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
  display: flex; justify-content: space-around; align-items: center;
}
/* This inline sheet loads after the Tailwind bundle, so the display:flex above
   outranks the markup's md:hidden — hide explicitly at the same breakpoint. */
@media (min-width: 768px) { .co-bottom-nav { display: none; } }
.co-mscrim { position: fixed; inset: 0; z-index: 60; background: rgba(8,8,12,.45); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); opacity: 0; pointer-events: none; transition: opacity .3s ease; }
.co-mscrim.open { opacity: 1; pointer-events: auto; }
.co-mdrawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 61; width: min(20rem,86vw); display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; transform: translateX(102%); transition: transform .34s cubic-bezier(.32,.72,0,1); will-change: transform; box-shadow: -16px 0 48px -16px rgba(0,0,0,.4); padding-top: calc(env(safe-area-inset-top) + .25rem); }
.co-mdrawer.open { transform: translateX(0); }
.co-msafe { padding-bottom: calc(1rem + env(safe-area-inset-bottom)); }
.co-pulse { animation: co-pulse 1.6s ease-in-out infinite; }
@keyframes co-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .co-mdrawer, .co-mscrim { transition: none; } .co-pulse { animation: none; } }
`;

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const { jobs } = useJobs();
  const running = jobs.filter((j) => j.status === "running").length;

  useEffect(() => { setOpen(false); }, [pathname]);

  // Scroll-lock + Escape + trap focus
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prevOverflow; document.removeEventListener("keydown", onKey); };
  }, [open]);

  // Swipe-right-to-close
  const drag = useRef({ x0: 0, dx: 0, active: false });
  const onTouchStart = (e: React.TouchEvent) => { drag.current = { x0: e.touches[0].clientX, dx: 0, active: true }; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!drag.current.active || !panelRef.current) return;
    const dx = Math.max(0, e.touches[0].clientX - drag.current.x0);
    drag.current.dx = dx;
    panelRef.current.style.transition = "none";
    panelRef.current.style.transform = `translateX(${dx}px)`;
  };
  const onTouchEnd = () => {
    if (!panelRef.current) return;
    panelRef.current.style.transition = "";
    panelRef.current.style.transform = "";
    if (drag.current.dx > 90) setOpen(false);
    drag.current.active = false;
  };

  const mainNavKeys = ["/", "/explore", "/pipeline"];
  const mainItems = NAV_ITEMS.filter((n) => mainNavKeys.includes(n.href));
  const moreItems = NAV_ITEMS.filter((n) => !mainNavKeys.includes(n.href));

  return (
    <>
      <style>{STYLE}</style>

      {/* Top Header - Kept slim for mobile */}
      <header className="co-mnav flex items-center gap-2 border-b border-border px-4 pb-3 md:hidden">
        <Link href="/" className="flex min-h-[44px] items-center gap-2" aria-label="temitops home">
          <CoMark size={26} />
          <span className={`${instrumentSerif.className} relative -top-px text-xl text-landing`}>temitops</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
           {running > 0 && <span aria-hidden className="co-pulse size-3 rounded-full bg-brand ring-2 ring-surface" />}
        </div>
      </header>

      {/* Bottom Nav Bar */}
      <nav className="co-bottom-nav md:hidden pb-[env(safe-area-inset-bottom)] pt-2 px-2">
        {mainItems.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-colors",
                active ? "text-brand" : "text-muted hover:text-foreground"
              )}
            >
              <Icon className="size-[22px]" />
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-colors",
            open ? "text-brand" : "text-muted hover:text-foreground"
          )}
        >
          <MoreHorizontal className="size-[22px]" />
          <span>More</span>
        </button>
      </nav>

      {/* Scrim & Drawer */}
      <div className={cn("co-mscrim md:hidden", open && "open")} onClick={() => setOpen(false)} aria-hidden />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        // TypeScript standard: boolean or undefined for inert, but React uses a specific type in newer versions.
        // We'll just cast it as any to avoid type errors if the standard differs.
        {...({ inert: !open ? "" : undefined } as any)}
        className={cn("co-mdrawer border-l border-border bg-surface md:hidden", open && "open")}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <span className={`${instrumentSerif.className} text-lg text-landing`}>More</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {moreItems.map(({ href, label, icon: Icon, chip }) => {
            const active = isActivePath(href, pathname);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] transition-colors",
                  active ? "bg-brand-soft text-brand-text" : "text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Icon className="size-5" />
                {label}
                {chip && (
                  <span className="ml-auto rounded-full border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-text">
                    {chip}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 mt-2">
          <WorkerPills />
        </div>

        <div className="co-msafe mt-auto space-y-3 border-t border-border px-4 pt-4 mb-16">
          <UsageMeter />
          <div className="flex items-center justify-between">
            <span className={`${instrumentSerif.className} text-sm text-faint`}>local-first · v0</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}
