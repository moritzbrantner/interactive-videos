import { Player, type PlayerRef } from '@remotion/player';
import { Table, type TableColumnDef } from '@moritzbrantner/tables/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { HotspotActivation } from '@/components/remotion/hotspot';
import { formatClock, slowestRequests, type LatencyBin } from '@/data/latency';
import {
  LatencyVideo,
  VIDEO_DURATION,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type BinPayload,
} from '@/video/latency-video';

const glossary: Record<string, { title: string; body: string }> = {
  'term:binned': {
    title: 'Binning',
    body: 'Two hundred thousand requests are too many marks to draw per frame. @moritzbrantner/charts aggregates them once into 48 buckets with counts and percentiles; the video only animates those 48 bars.',
  },
  'term:p95': {
    title: 'p95 latency',
    body: '95% of requests in the bucket finished faster than this. Unlike the average, it shows the slow tail that users actually notice.',
  },
  'term:incident': {
    title: 'The incident',
    body: 'Between 14:00 and 15:30 the dataset injects a heavier latency tail and 503 errors. Click one of the orange bars to see the slowest requests in that window.',
  },
};

// Percentiles are interpolated, so they are not whole milliseconds.
function formatMs(value: number | null) {
  return value === null ? '–' : `${Math.round(value).toLocaleString('en-US')} ms`;
}

type RequestRow = ReturnType<typeof slowestRequests>[number];

const requestColumns: TableColumnDef<RequestRow>[] = [
  { id: 'time', header: 'Time', accessor: (row) => formatClock(row.x) },
  { id: 'route', header: 'Route', accessor: (row) => row.properties.route },
  { id: 'status', header: 'Status', accessor: (row) => row.properties.status, align: 'end' },
  {
    id: 'latency',
    header: 'Latency',
    accessor: (row) => row.y,
    align: 'end',
    cell: (value) => formatMs(Number(value)),
  },
];

function BinInsight({ bin }: { bin: LatencyBin }) {
  const rows = useMemo(() => slowestRequests(bin), [bin]);
  const stats = [
    ['Requests', bin.pointCount.toLocaleString('en-US')],
    ['p50', formatMs(bin.p50)],
    ['p95', formatMs(bin.p95)],
    ['p99', formatMs(bin.p99)],
  ];
  return (
    <>
      <h2>
        {formatClock(bin.x0)}–{formatClock(bin.x1)}
      </h2>
      <dl className="stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>Slowest requests</h3>
      <Table
        ariaLabel="Slowest requests in this bucket"
        className="requests"
        density="compact"
        minWidth="100%"
        columns={requestColumns}
        rows={rows}
        rowKey={(row) => row.id}
      />
    </>
  );
}

export function App() {
  const player = useRef<PlayerRef>(null);
  const [activation, setActivation] = useState<HotspotActivation>();

  const onActivate = useCallback((next: HotspotActivation) => {
    player.current?.pause();
    setActivation(next);
  }, []);

  const resume = useCallback(() => {
    setActivation(undefined);
    player.current?.play();
  }, []);

  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const dismiss = () => setActivation(undefined);
    current.addEventListener('play', dismiss);
    return () => current.removeEventListener('play', dismiss);
  }, []);

  const inputProps = useMemo(
    () => ({ onActivate, selectedId: activation?.id }),
    [onActivate, activation?.id],
  );

  const payload = activation?.payload as BinPayload | undefined;
  const term = activation ? glossary[activation.id] : undefined;

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">interactive video · charts + remotion-primitives + tables</p>
        <h1>Latency explainer</h1>
        <p className="lede">
          Play the video, then click a bar or an underlined word. The video pauses and the panel shows
          the data behind it.
        </p>
      </header>
      <section className="stage">
        <Player
          ref={player}
          component={LatencyVideo}
          inputProps={inputProps}
          durationInFrames={VIDEO_DURATION}
          compositionWidth={VIDEO_WIDTH}
          compositionHeight={VIDEO_HEIGHT}
          fps={VIDEO_FPS}
          controls
          clickToPlay={false}
          style={{ width: '100%', aspectRatio: `${VIDEO_WIDTH} / ${VIDEO_HEIGHT}` }}
        />
        <aside className="insight" aria-live="polite">
          {activation ? (
            <>
              <p className="eyebrow">paused at {(activation.frame / VIDEO_FPS).toFixed(1)} s</p>
              {payload?.kind === 'bin' ? (
                <BinInsight bin={payload.bin} />
              ) : term ? (
                <>
                  <h2>{term.title}</h2>
                  <p>{term.body}</p>
                </>
              ) : null}
              <button type="button" onClick={resume}>
                Resume
              </button>
            </>
          ) : (
            <p className="empty">Nothing selected yet.</p>
          )}
        </aside>
      </section>
    </main>
  );
}
