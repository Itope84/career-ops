"use client";

import { useState } from "react";
import { ConfigForm } from "@/components/config-form";
import { ProfileEditor } from "@/components/profile-editor";
import { PortalsEditor } from "@/components/portals-editor";
import { cn } from "@/lib/cn";

export default function ConfigPage() {
  const [tab, setTab] = useState<"profile" | "portals" | "engine">("profile");

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 pb-24">
      <h1 className="font-display text-2xl tracking-tight text-landing mb-6">Settings</h1>
      
      <div className="flex gap-2 border-b border-border mb-8 overflow-x-auto hide-scrollbar pb-px">
        <button 
          onClick={() => setTab("profile")}
          className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap max-sm:min-h-[44px]", tab === "profile" ? "border-brand text-foreground" : "border-transparent text-muted hover:text-foreground")}
        >
          Profile
        </button>
        <button 
          onClick={() => setTab("portals")}
          className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap max-sm:min-h-[44px]", tab === "portals" ? "border-brand text-foreground" : "border-transparent text-muted hover:text-foreground")}
        >
          Sources
        </button>
        <button 
          onClick={() => setTab("engine")}
          className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap max-sm:min-h-[44px]", tab === "engine" ? "border-brand text-foreground" : "border-transparent text-muted hover:text-foreground")}
        >
          AI Engine
        </button>
      </div>

      {tab === "profile" && <ProfileEditor />}
      {tab === "portals" && <PortalsEditor />}
      {tab === "engine" && <ConfigForm />}
    </div>
  );
}
