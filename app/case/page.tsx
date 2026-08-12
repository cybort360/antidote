import type { Metadata } from "next";
import AntidoteApp from "@/components/AntidoteApp";

export const metadata: Metadata = {
  title: "Live case | ANTIDOTE",
  description: "Inspect the live ANTIDOTE case map, attacks, audit ledger, and causal trace.",
};

export default function Page() {
  return <AntidoteApp />;
}
