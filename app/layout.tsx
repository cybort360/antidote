import "./styles.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ANTIDOTE | Causal recovery for poisoned AI memory",
  description: "Trace, revoke, and repair the downstream influence of compromised agent memory."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <template
          dangerouslySetInnerHTML={{
            __html: "<!-- ANTIDOTE_DIRECTION_CONTRACT | THESIS: Memory influence should feel like a live toxicology assay, not a blue security dashboard. | OWN-WORLD: bone paper, carbon ink, safety orange, contamination rose, rounded field instruments, and precise causal diagrams. | STORY: One memory enters, influence spreads, ANTIDOTE exposes the chain, then the developer installs the recovery loop and proves the repair. | FIRST VIEWPORT: oversized consequence at left, an interactive causal assay at right, and OPEN LIVE CASE fixed in the compact instrument header. | FORM: toxicology assay sequence, candidate 5, seed eeb59423. | FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->",
          }}
        />
        {children}
      </body>
    </html>
  );
}
