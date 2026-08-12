import Link from "next/link";
import { DocsView } from "@/components/views/DocsView";

export default function Docs() {
  return (
    <main>
      <header className="topbar">
        <div className="brandWrap">
          <Link className="brand" href="/" aria-label="ANTIDOTE home">
            <span className="mark" aria-hidden="true"><i /></span>
            <span>ANTIDOTE</span>
          </Link>
          <span className="caseId">FIELD MANUAL</span>
        </div>
        <nav className="viewTabs" aria-label="Case views">
          <Link className="viewTabsLink" href="/case">
            <span className="tabNumeral">I</span>
            <span>BACK TO LIVE CASE</span>
          </Link>
        </nav>
      </header>
      <DocsView />
      <footer className="appFooter">ANTIDOTE · causal recovery for poisoned AI memory</footer>
    </main>
  );
}
