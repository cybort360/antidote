import type { Metadata } from "next";
import HowItWorksPage from "@/components/HowItWorksPage";

export const metadata: Metadata = {
  title: "ANTIDOTE | Causal recovery for agent memory",
  description: "Install ANTIDOTE, connect an agent through its REST API, record causal memory lineage, and verify recovery behavior.",
};

export default function Page() {
  return <HowItWorksPage />;
}
