"use client";

import type { Billing, Plan } from "@/lib/plans";

/** Segmented control: Recurring Billing vs One-Time Payment for a Premium plan. */
export default function BillingToggle({
  plan,
  value,
  onChange,
  disabled,
}: {
  plan: Plan;
  value: Billing;
  onChange: (b: Billing) => void;
  disabled?: boolean;
}) {
  const opts: [Billing, string][] = [
    ["recurring", "Recurring Billing"],
    ["once", "One-Time Payment"],
  ];
  return (
    <div>
      <div role="radiogroup" aria-label={`${plan.name} payment option`} className="grid grid-cols-2 gap-1 rounded-full bg-neutral-900 p-1 text-xs">
        {opts.map(([b, label]) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={value === b}
            disabled={disabled}
            onClick={() => onChange(b)}
            className={`rounded-full px-2 py-1.5 font-medium transition ${
              value === b ? "bg-violet-600 text-white" : "text-neutral-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-400" aria-live="polite">
        {value === "recurring"
          ? `${plan.blurb}. Renews automatically until you cancel.`
          : `Pay once for ${plan.days} days. No renewal, nothing to cancel.`}
      </p>
    </div>
  );
}
