"use client";

import { useState } from "react";
import { Asterisk } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CoverField } from "@/lib/cover/types";

const CUSTOM = "__custom__"; // sentinel for the "Other — write your own" choice

const inputBase =
  "w-full rounded-xl border border-border bg-surface/60 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand/50 focus:ring-2 focus:ring-brand/20";

// Renders one CoverField as a real input and reports its value up as a string.
// single-select → radio group; multi-select → checkbox group (values joined by
// " | "); confirm → editable textarea prefilled with the field's default.
export function CoverFieldRow({
  field: f,
  value,
  onChange,
}: {
  field: CoverField;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-baseline gap-1 text-sm font-medium text-foreground">
        {f.label}
        {f.required && <Asterisk className="size-3 text-brand" />}
      </label>
      {f.help && <p className="text-xs text-muted">{f.help}</p>}

      {f.type === "single-select" ? (
        <SingleSelect field={f} value={value} onChange={onChange} />
      ) : f.type === "multi-select" ? (
        <MultiSelect field={f} value={value} onChange={onChange} />
      ) : f.type === "textarea" || f.type === "confirm" ? (
        <textarea
          rows={f.type === "confirm" ? 4 : 3}
          value={value}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputBase, "resize-y")}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputBase}
        />
      )}
    </div>
  );
}

function optionClass(active: boolean): string {
  return cn(
    "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition-colors",
    active ? "border-brand/50 bg-brand-soft text-brand-text" : "border-border hover:bg-surface-hover",
  );
}

function SingleSelect({ field: f, value, onChange }: { field: CoverField; value: string; onChange: (v: string) => void }) {
  const options = f.options ?? [];
  const isCustom = value !== "" && !options.includes(value);
  const [customText, setCustomText] = useState(isCustom ? value : "");
  return (
    <div className="space-y-1.5">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <label key={opt} className={optionClass(active)}>
            <input
              type="radio"
              name={f.id}
              checked={active}
              onChange={() => onChange(opt)}
              className="mt-0.5 size-4 accent-brand"
            />
            <span>{opt}</span>
          </label>
        );
      })}
      {f.allowCustom && (
        <div className={optionClass(isCustom)}>
          <input
            type="radio"
            name={f.id}
            checked={isCustom}
            onChange={() => onChange(customText)}
            className="mt-0.5 size-4 accent-brand"
          />
          <input
            type="text"
            value={isCustom ? value : customText}
            placeholder="Other — write your own"
            onFocus={() => onChange(customText)}
            onChange={(e) => {
              setCustomText(e.target.value);
              onChange(e.target.value);
            }}
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>
      )}
    </div>
  );
}

function MultiSelect({ field: f, value, onChange }: { field: CoverField; value: string; onChange: (v: string) => void }) {
  const options = f.options ?? [];
  const tokens = value ? value.split(" | ").filter(Boolean) : [];
  const known = new Set(tokens.filter((t) => options.includes(t)));
  const customInit = tokens.filter((t) => !options.includes(t)).join(", ");
  const [customText, setCustomText] = useState(customInit);

  const emit = (nextKnown: Set<string>, custom: string) => {
    const parts = [...options.filter((o) => nextKnown.has(o)), ...(custom.trim() ? [custom.trim()] : [])];
    onChange(parts.join(" | "));
  };
  return (
    <div className="space-y-1.5">
      {options.map((opt) => {
        const active = known.has(opt);
        return (
          <label key={opt} className={optionClass(active)}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => {
                const next = new Set(known);
                if (e.target.checked) next.add(opt);
                else next.delete(opt);
                emit(next, customText);
              }}
              className="mt-0.5 size-4 accent-brand"
            />
            <span>{opt}</span>
          </label>
        );
      })}
      {f.allowCustom && (
        <input
          type="text"
          value={customText}
          placeholder="Anything else — write your own"
          onChange={(e) => {
            setCustomText(e.target.value);
            emit(known, e.target.value);
          }}
          className={inputBase}
        />
      )}
    </div>
  );
}
