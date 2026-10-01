import PricingCards from "@/components/PricingCards";
import { FREE_MATCHES, TEASE_SECONDS } from "@/lib/plans";

export const metadata = { title: "Premium" };

export default function PricingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Go Premium</h1>
        <p className="mt-2 text-neutral-400">
          Your first {FREE_MATCHES} matches are free. After that, video is blurred after {TEASE_SECONDS} seconds.
          Premium removes the limit and unlocks the Boys / Girls / Both filter.
        </p>
      </div>
      <PricingCards />
    </div>
  );
}
