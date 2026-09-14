"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

const REVEAL = 72; // px — width of the red delete panel
const THRESHOLD = 36; // px of leftward drag before it snaps open

// Mobile swipe-left-to-reveal-delete, generic over any row content. Desktop is
// untouched by design — no touch events fire from a mouse, so dragX simply
// never moves off 0 there; the delete panel itself is also sm:hidden as a
// visual backstop. No `X`/skip conflict: this is a real, permanent delete
// (caller decides what that means), distinct from any existing hide affordance.
export function SwipeToDelete({
  onDelete,
  className,
  children,
}: {
  onDelete: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [dragX, setDragX] = useState(0); // 0..-REVEAL
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    setDragging(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startX.current == null) return;
    const dx = e.touches[0].clientX - startX.current;
    const base = open ? -REVEAL : 0;
    setDragX(Math.min(0, Math.max(-REVEAL, base + dx)));
  };
  const onTouchEnd = () => {
    setDragging(false);
    startX.current = null;
    if (dragX <= -THRESHOLD) {
      setOpen(true);
      setDragX(-REVEAL);
    } else {
      setOpen(false);
      setDragX(0);
    }
  };
  const close = () => {
    setOpen(false);
    setDragX(0);
  };

  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute inset-y-0 right-0 flex sm:hidden"
        style={{ width: REVEAL }}
        aria-hidden={!open}
      >
        <button
          type="button"
          onClick={() => {
            close();
            onDelete();
          }}
          aria-label="Delete"
          className="flex h-full w-full items-center justify-center bg-red-600 text-white active:bg-red-700"
        >
          <Trash2 className="size-5" />
        </button>
      </div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={open ? close : undefined}
        style={{ transform: `translateX(${dragX}px)` }}
        className={cn("relative bg-surface", !dragging && "transition-transform duration-150 ease-out", className)}
      >
        {children}
      </div>
    </div>
  );
}
