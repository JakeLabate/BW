import { completeness, openGaps, proposedFacts, useBrand } from "../lib/store";
import { timeAgo } from "../lib/ui";

export default function Dashboard() {
  const { brand, modules, facts, gaps, content, messages, runs } = useBrand();
  const b = brand!;
  const c = completeness(modules);
  const proposed = proposedFacts(facts);
  const profileGaps = openGaps(gaps, "profile");
  const marketGaps = openGaps(gaps, "market");
  const queued = content.filter((x) => x.status === "queued" || x.status === "approved");
  const drafts = content.filter((x) => x.status === "draft");

  return (
    <>
      <div className="head">
        <h1>{b.name}</h1>
        <p>{b.one_liner ?? "The loop below is the whole product. Collect, store, spot the gaps, generate, publish."}</p>
      </div>

      <div className="grid three" style={{ marginBottom: 22 }}>
        <div className="stat">
          <div className="n">{c.requiredFilled}/{c.requiredTotal}</div>
          <div className="l">Required profile fields confirmed</div>
          <div className="meter" style={{ marginTop: 10 }}>
            <i style={{ width: `${c.pct}%` }} />
          </div>
        </div>
        <div className={`stat${proposed.length ? " hot" : ""}`}>
          <div className="n">{proposed.length}</div>
          <div className="l">Facts waiting for your yes or no</div>
        </div>
        <div className={`stat${marketGaps.length ? " hot" : ""}`}>
          <div className="n">{marketGaps.length}</div>
          <div className="l">Market gaps found in the inbox</div>
        </div>
      </div>

      <div className="section-title">The loop</div>
      <div className="loop">
        <a className="node" href={`#/b/${b.id}/integrations`}>
          <div className="k">1. Collect</div>
          <div className="t">Integrations</div>
          <div className="d">
            The website, pasted material, AI reading the logo and past posts, and the customer
            inbox. Each one with its own settings.
          </div>
        </a>
        <a className="node" href={`#/b/${b.id}/brand`}>
          <div className="k">2. Store</div>
          <div className="t">My Brand</div>
          <div className="d">
            {c.fieldsFilled} of {c.fieldsTotal} fields have a confirmed value. Nothing is used until you confirm it.
          </div>
        </a>
        <a className="node" href={`#/b/${b.id}/generate`}>
          <div className="k">3. Generate</div>
          <div className="t">Posts and campaigns</div>
          <div className="d">{drafts.length} drafts written from confirmed facts only.</div>
        </a>
        <a className="node" href={`#/b/${b.id}/queue`}>
          <div className="k">4. Publish</div>
          <div className="t">The queue</div>
          <div className="d">{queued.length} approved and scheduled on your cadence.</div>
        </a>
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <a className="node card gap" href={`#/b/${b.id}/brand`} style={{ textDecoration: "none", color: "inherit", background: "var(--amber-soft)", borderColor: "var(--amber-line)" }}>
          <div className="k" style={{ color: "var(--amber)", fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 600 }}>
            Profile gap
          </div>
          <div className="t" style={{ fontFamily: "var(--display)", fontSize: 17, fontWeight: 600, margin: "3px 0 5px" }}>
            {profileGaps.length} required fields still empty
          </div>
          <div className="d small">
            They live on My Brand under Needs attention, where you see them and fill them in the same place.
          </div>
        </a>
        <a className="node card gap" href={`#/b/${b.id}/brand`} style={{ textDecoration: "none", color: "inherit", background: "var(--amber-soft)", borderColor: "var(--amber-line)" }}>
          <div className="k" style={{ color: "var(--amber)", fontSize: 11.5, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 600 }}>
            Market gap
          </div>
          <div className="t" style={{ fontFamily: "var(--display)", fontSize: 17, fontWeight: 600, margin: "3px 0 5px" }}>
            {marketGaps.length} things customers keep asking for
          </div>
          <div className="d small">
            Read out of {messages.filter((m) => m.direction === "inbound").length} customer messages. They sit on My Brand, above the fields they would change.
          </div>
        </a>
      </div>

      {runs.length > 0 && (
        <>
          <div className="section-title">Recent runs</div>
          <div className="card scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Result</th>
                  <th className="right">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.kind}</td>
                    <td>
                      <span className={`pill ${r.status === "done" ? "green" : r.status === "failed" ? "red" : ""}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="small muted">
                      {r.error ?? summarise(r.detail)}
                    </td>
                    <td className="right small muted">{timeAgo(r.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function summarise(detail: Record<string, unknown>) {
  const bits: string[] = [];
  if (typeof detail.pages_read === "number") bits.push(`${detail.pages_read} pages read`);
  if (typeof detail.proposed === "number") bits.push(`${detail.proposed} facts proposed`);
  if (typeof detail.gaps_found === "number") bits.push(`${detail.gaps_found} gaps`);
  if (typeof detail.drafted === "number") bits.push(`${detail.drafted} drafts`);
  if (Array.isArray(detail.pages_failed) && detail.pages_failed.length) {
    bits.push(`${detail.pages_failed.length} pages blocked`);
  }
  return bits.join(", ") || "-";
}
