"use client";

import type { PayMethod } from "@/lib/plans";

/** Segmented control: pay by Card (charged in USD) or M-Pesa (charged in KES). */
export default function MethodToggle({
  value,
  onChange,
  disabled,
  label = "Payment method",
}: {
  value: PayMethod;
  onChange: (m: PayMethod) => void;
  disabled?: boolean;
  label?: string;
}) {
  const opts: [PayMethod, string][] = [
    ["card", "Card · USD"],
    ["mpesa", "M-Pesa · KES"],
  ];
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1 rounded-full bg-neutral-900 p-1 text-xs">
      {opts.map(([m, text]) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          disabled={disabled}
          onClick={() => onChange(m)}
          className={`rounded-full px-2 py-1.5 font-medium transition ${
            value === m ? "bg-violet-600 text-white" : "text-neutral-400 hover:text-white"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
