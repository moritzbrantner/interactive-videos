import { Table, type TableColumnDef } from '@moritzbrantner/tables/table';
import { useMemo } from 'react';

import type { HotspotActivation } from '@/components/remotion/hotspot';
import { formatClock, slowestRequests, type LatencyBin } from '@/data/latency';
import { latencyScene } from '@/video/latency-spec';
import type { BinPayload } from '@/video/latency-video';

// Glossary entries are the spec's narration terms.
const glossary: Record<string, { title: string; body: string }> = Object.fromEntries(
  (latencyScene.interaction?.terms ?? []).map((term) => [term.id, { title: term.title, body: term.body }]),
);

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

/** The insight panel body for a clicked bar or subtitle term. */
export function LatencyInsight({ activation }: { activation: HotspotActivation }) {
  const payload = activation.payload as BinPayload | undefined;
  if (payload?.kind === 'bin') return <BinInsight bin={payload.bin} />;
  const term = glossary[activation.id];
  if (!term) return null;
  return (
    <>
      <h2>{term.title}</h2>
      <p>{term.body}</p>
    </>
  );
}
