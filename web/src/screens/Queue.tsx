import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useBrand } from "../lib/store";
import { PLATFORMS, type ContentItem, type ContentStatus, type Platform } from "../lib/types";
import { Busy, CopyButton, Empty, Notice, useAction } from "../lib/ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FILTERS: Array<[string, ContentStatus[]]> = [
  ["To review", ["draft"]],
  ["Scheduled", ["approved", "queued"]],
  ["Published", ["published"]],
  ["Archived", ["archived"]],
];

export default function Queue() {
  const { brand, content, schedules, reload } = useBrand();
  const b = brand!;
  const [tab, setTab] = useState(0);

  const taken = useMemo(
    () =>
      content
        .filter((c) => c.scheduled_for && c.status !== "archived")
        .map((c) => new Date(c.scheduled_for!).getTime()),
    [content],
  );

  const shown = useMemo(
    () =>
      content
        .filter((c) => FILTERS[tab][1].includes(c.status))
        .sort((a, x) => (a.scheduled_for ?? a.created_at).localeCompare(x.scheduled_for ?? x.created_at)),
    [content, tab],
  );

  return (
    <>
      <div className="head">
        <h1>Queue</h1>
        <p>
          Approve what is right, fix what is nearly right, and it lands on the cadence below.
          Publishing to Facebook and LinkedIn is a copy out for now, not an API push.
        </p>
      </div>

      <Cadence brandId={b.id} schedules={schedules} onDone={reload} />

      <div className="row" style={{ margin: "22px 0 14px" }}>
        {FILTERS.map(([label, statuses], i) => (
          <button key={label} className={i === tab ? "ok" : ""} onClick={() => setTab(i)}>
            {label}
            <span className="count" style={{ marginLeft: 6 }}>
              {content.filter((c) => statuses.includes(c.status)).length}
            </span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty title="Nothing here">
          <p className="tight">
            {tab === 0 ? (
              <>
                Write some on the <a href={`#/b/${b.id}/generate`}>Generate tab</a>.
              </>
            ) : (
              "Approve a draft and it shows up here."
            )}
          </p>
        </Empty>
      ) : (
        <div className="stack">
          {shown.map((item) => (
            <Post key={item.id} item={item} schedules={schedules} taken={taken} onDone={reload} />
          ))}
        </div>
      )}
    </>
  );
}

function Cadence({
  brandId,
  schedules,
  onDone,
}: {
  brandId: string;
  schedules: { id: string; platform: Platform; days_of_week: number[]; time_of_day: string; active: boolean }[];
  onDone: () => Promise<void>;
}) {
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const existing = schedules.find((s) => s.platform === platform);
  const [days, setDays] = useState<number[]>(existing?.days_of_week ?? [2, 4]);
  const [time, setTime] = useState((existing?.time_of_day ?? "09:00").slice(0, 5));

  const save = useAction(async () => {
    if (!days.length) throw new Error("Pick at least one day.");
    const { error } = await supabase.from("schedules").upsert(
      {
        brand_id: brandId,
        platform,
        days_of_week: days,
        time_of_day: `${time}:00`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        active: true,
      },
      { onConflict: "brand_id,platform" },
    );
    if (error) throw error;
    await onDone();
    return "Cadence saved.";
  });

  return (
    <div className="card">
      <h3>Publishing cadence</h3>
      <p className="sub">
        Approving a post drops it into the next free slot on this schedule.
      </p>
      <Notice kind="err">{save.error}</Notice>
      <Notice kind="ok">{save.done}</Notice>

      <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
        <div style={{ flex: "0 1 180px" }}>
          <label htmlFor="cp">Platform</label>
          <select
            id="cp"
            value={platform}
            onChange={(e) => {
              const p = e.target.value as Platform;
              setPlatform(p);
              const s = schedules.find((x) => x.platform === p);
              setDays(s?.days_of_week ?? [2, 4]);
              setTime((s?.time_of_day ?? "09:00").slice(0, 5));
            }}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: "0 1 130px" }}>
          <label htmlFor="ctime">Time</label>
          <input id="ctime" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div style={{ flex: "1 1 240px" }}>
          <label>Days</label>
          <div className="days">
            {DAYS.map((d, i) => (
              <button
                key={d}
                className={days.includes(i) ? "on sm" : "sm"}
                onClick={() => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort()))}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => save.run()} disabled={save.busy}>
          <Busy busy={save.busy}>Save</Busy>
        </button>
      </div>

      {schedules.length > 0 && (
        <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
          Active:{" "}
          {schedules
            .filter((s) => s.active)
            .map((s) => `${s.platform} ${s.days_of_week.map((d) => DAYS[d]).join("/")} at ${s.time_of_day.slice(0, 5)}`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

function Post({
  item,
  schedules,
  taken,
  onDone,
}: {
  item: ContentItem;
  schedules: { platform: Platform; days_of_week: number[]; time_of_day: string }[];
  taken: number[];
  onDone: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body);

  const update = useAction(async (patch: Partial<ContentItem>) => {
    const { error } = await supabase.from("content_items").update(patch).eq("id", item.id);
    if (error) throw error;
    await onDone();
  });

  const approve = useAction(async () => {
    const slot = nextSlot(schedules.find((s) => s.platform === item.platform), taken);
    const { error } = await supabase
      .from("content_items")
      .update({ status: "queued", scheduled_for: slot, body })
      .eq("id", item.id);
    if (error) throw error;
    await onDone();
  });

  const full = `${item.body}${item.hashtags ? `\n\n${item.hashtags}` : ""}`;

  return (
    <div className="post">
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <span className="pill violet">{item.platform}</span>
          <span className={`pill ${item.status === "published" ? "green" : item.status === "draft" ? "amber" : ""}`}>
            {item.status}
          </span>
          {item.scheduled_for && (
            <span className="small muted">
              {new Date(item.scheduled_for).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        {item.title && <span className="small muted">{item.title}</span>}
      </div>

      <Notice kind="err">{update.error ?? approve.error}</Notice>

      {editing ? (
        <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ marginTop: 10 }} />
      ) : (
        <div className="body">{item.body}</div>
      )}
      {item.hashtags && <div className="tags">{item.hashtags}</div>}

      {item.grounded_in?.length > 0 && (
        <div className="small muted" style={{ marginTop: 8 }}>
          Grounded in: {item.grounded_in.join(", ")}
        </div>
      )}

      <div className="foot">
        {item.status === "draft" && (
          <>
            {editing ? (
              <>
                <button className="primary sm" onClick={() => { void update.run({ body }); setEditing(false); }}>
                  Save edit
                </button>
                <button className="ghost sm" onClick={() => { setBody(item.body); setEditing(false); }}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="primary sm" onClick={() => approve.run()} disabled={approve.busy}>
                  <Busy busy={approve.busy}>Approve and schedule</Busy>
                </button>
                <button className="sm" onClick={() => setEditing(true)}>
                  Edit
                </button>
              </>
            )}
            <button className="ghost sm danger" onClick={() => update.run({ status: "archived" })}>
              Discard
            </button>
          </>
        )}

        {(item.status === "queued" || item.status === "approved") && (
          <>
            <CopyButton text={full} label="Copy for posting" />
            <button
              className="sm ok"
              onClick={() => update.run({ status: "published", published_at: new Date().toISOString() })}
            >
              Mark published
            </button>
            <button className="ghost sm" onClick={() => update.run({ status: "draft", scheduled_for: null })}>
              Back to drafts
            </button>
          </>
        )}

        {item.status === "published" && <CopyButton text={full} />}
        {item.status === "archived" && (
          <button className="sm" onClick={() => update.run({ status: "draft" })}>
            Restore
          </button>
        )}
      </div>
    </div>
  );
}

/** Next matching day and time on the cadence that is not already spoken for. */
function nextSlot(schedule: { days_of_week: number[]; time_of_day: string } | undefined, taken: number[]) {
  const days = schedule?.days_of_week?.length ? schedule.days_of_week : [2, 4];
  const [h, m] = (schedule?.time_of_day ?? "09:00").split(":").map(Number);
  const now = new Date();
  for (let i = 0; i < 120; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (!days.includes(d.getDay())) continue;
    if (d.getTime() <= now.getTime() + 3600_000) continue;
    if (taken.some((t) => Math.abs(t - d.getTime()) < 60_000)) continue;
    return d.toISOString();
  }
  return new Date(now.getTime() + 86400_000).toISOString();
}
