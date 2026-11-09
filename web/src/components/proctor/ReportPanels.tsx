import { Camera, ChevronLeft, ChevronRight, Globe, IdCard, Laptop, Link2, Trash2, Unlock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { cx, duration } from '../../lib/format';
import { Badge, Button, Card, ErrorBox } from '../ui';

export interface MediaItem { id: number; kind: 'snapshot' | 'identity_selfie' | 'identity_document'; t: number; faces: number | null; reason: string; url: string }
export interface AccessRow { t: number; ip: string | null; user_agent: string | null; fingerprint: string | null; device_id: string | null }
export interface SharedWith { attemptId: number; name: string; assessmentId: number; kind: 'device' | 'fingerprint' | 'network' }

const faceBadge = (m: MediaItem) => {
  if (m.faces == null) return { text: 'not analyzed', cls: 'bg-ink-700 text-ink-200' };
  if (m.faces === 0) return { text: 'no face', cls: 'bg-rose-500/90 text-white' };
  if (m.faces > 1) return { text: `${m.faces} people`, cls: 'bg-rose-500/90 text-white' };
  return { text: '1 face', cls: 'bg-emerald-500/80 text-on-accent' };
};
const flagged = (m: MediaItem) => m.faces != null && m.faces !== 1;

function Lightbox({ items, index, startedAt, onClose }: { items: MediaItem[]; index: number; startedAt: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => Math.min(items.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [items.length, onClose]);
  const m = items[i];
  const b = faceBadge(m);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/90 p-4" role="dialog" aria-modal="true" aria-label="Snapshot viewer" onClick={onClose}>
      <div className="relative max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <img src={m.url} alt={`Snapshot at T+${duration(m.t - startedAt)}`} className="max-h-[75vh] rounded-lg" />
        <div className="mt-2 flex items-center gap-3 text-sm text-ink-200">
          <span className={cx('rounded px-1.5 py-0.5 text-xs', b.cls)}>{b.text}</span>
          <span className="font-mono">T+{duration(m.t - startedAt)}</span>
          <span className="text-ink-400">{m.kind === 'snapshot' ? m.reason.replace('_', ' ') : m.kind.replace('_', ' ')}</span>
          <span className="ml-auto text-ink-400">{i + 1}/{items.length}</span>
        </div>
        <button onClick={onClose} className="absolute -top-3 -right-3 rounded-full bg-ink-800 p-1.5 text-ink-200" aria-label="Close"><X className="size-4" /></button>
        {i > 0 && <button onClick={() => setI(i - 1)} className="absolute top-1/2 -left-12 rounded-full bg-ink-800 p-2 text-ink-200" aria-label="Previous"><ChevronLeft className="size-5" /></button>}
        {i < items.length - 1 && <button onClick={() => setI(i + 1)} className="absolute top-1/2 -right-12 rounded-full bg-ink-800 p-2 text-ink-200" aria-label="Next"><ChevronRight className="size-5" /></button>}
      </div>
    </div>
  );
}

export function ProctoringPanel({ attemptId, media, startedAt, retentionDays, webcam, onDeleted }: {
  attemptId: number; media: MediaItem[]; startedAt: number; retentionDays: number; webcam: boolean; onDeleted: () => void;
}) {
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const selfie = [...media].reverse().find((m) => m.kind === 'identity_selfie');
  const doc = [...media].reverse().find((m) => m.kind === 'identity_document');
  const snaps = media.filter((m) => m.kind === 'snapshot');
  const shown = onlyFlagged ? snaps.filter(flagged) : snaps;
  const del = async () => {
    if (!confirm('Permanently delete all webcam images, ID photos and IP/device logs for this candidate?')) return;
    try { await api.del(`/api/attempts/${attemptId}/proctoring`); onDeleted(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Camera className="size-5 text-ember-400" />
        <h2 className="font-semibold text-ink-100">Proctoring</h2>
        <span className="text-xs text-ink-500">auto-deleted {retentionDays} days after submission</span>
        {media.length > 0 && <Button size="sm" variant="ghost" className="ml-auto" onClick={del}><Trash2 className="size-3.5" /> Delete proctoring data</Button>}
      </div>
      <ErrorBox error={err} />
      {!media.length && <p className="text-sm text-ink-400">{webcam ? 'No images were received for this attempt.' : 'No images on file.'}</p>}
      {(selfie || doc) && (
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-400"><IdCard className="size-3.5" /> Identity — compare with the snapshots below</div>
          <div className="grid max-w-xl grid-cols-2 gap-3">
            {[['Selfie', selfie], ['Photo ID', doc]].map(([label, m]) => (
              <figure key={label as string}>
                {m ? <button onClick={() => setOpen(media.indexOf(m as MediaItem) + 10_000)} className="block w-full"><img src={(m as MediaItem).url} alt={label as string} className="aspect-[4/3] w-full rounded-lg border border-ink-700 object-cover" /></button>
                  : <div className="grid aspect-[4/3] place-items-center rounded-lg border border-dashed border-ink-700 text-xs text-ink-500">missing</div>}
                <figcaption className="mt-1 text-xs text-ink-400">{label as string}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
      {snaps.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-ink-300">{snaps.length} snapshots</span>
            <Badge className="border-rose-500/30 text-rose-300">{snaps.filter((m) => m.faces === 0).length} no face</Badge>
            <Badge className="border-rose-500/30 text-rose-300">{snaps.filter((m) => (m.faces ?? 1) > 1).length} multiple people</Badge>
            {snaps.some((m) => m.faces == null) && <Badge>{snaps.filter((m) => m.faces == null).length} not analyzed</Badge>}
            <label className="ml-auto flex items-center gap-1.5 text-ink-300"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="accent-ember-500" /> Flagged only</label>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {shown.map((m) => {
              const b = faceBadge(m);
              return (
                <button key={m.id} onClick={() => setOpen(shown.indexOf(m))} className={cx('group relative overflow-hidden rounded-md border text-left', flagged(m) ? 'border-rose-500/70' : 'border-ink-700')} title={`T+${duration(m.t - startedAt)} · ${b.text}`}>
                  <img src={m.url} alt={`Snapshot at T+${duration(m.t - startedAt)}`} loading="lazy" className="aspect-[4/3] w-full object-cover transition-opacity group-hover:opacity-80" />
                  <span className={cx('absolute top-1 left-1 rounded px-1 text-[10px]', b.cls)}>{b.text}</span>
                  <span className="absolute right-1 bottom-1 rounded bg-ink-950/80 px-1 font-mono text-[10px] text-ink-200">T+{duration(m.t - startedAt)}</span>
                </button>
              );
            })}
            {!shown.length && <p className="col-span-full text-sm text-emerald-300">No flagged snapshots.</p>}
          </div>
        </>
      )}
      {open != null && (open >= 10_000
        ? <Lightbox items={media.filter((m) => m.kind !== 'snapshot')} index={media.filter((m) => m.kind !== 'snapshot').indexOf(media[open - 10_000])} startedAt={startedAt} onClose={() => setOpen(null)} />
        : <Lightbox items={shown} index={open} startedAt={startedAt} onClose={() => setOpen(null)} />)}
    </Card>
  );
}

function browserOf(ua: string | null) {
  if (!ua) return 'Unknown browser';
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [b, os].filter(Boolean).join(' on ');
}

export function AccessPanel({ attemptId, access, sharedWith, startedAt, canUnlock, onChanged }: {
  attemptId: number; access: AccessRow[]; sharedWith: SharedWith[]; startedAt: number | null; canUnlock: boolean; onChanged: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const devices = [...new Set(access.map((a) => a.device_id ?? a.fingerprint).filter(Boolean))];
  const short = (s: string | null) => (s ? s.slice(0, 8) : '—');
  const unlock = async () => {
    await api.post(`/api/attempts/${attemptId}/unlock-device`);
    setMsg('Unlocked — the next browser the candidate opens the link in will take over.');
    onChanged();
  };
  const KIND = {
    device: { label: 'same browser', cls: 'border-rose-500/40 text-rose-300' },
    fingerprint: { label: 'same device fingerprint', cls: 'border-amber-500/40 text-amber-300' },
    network: { label: 'same network', cls: 'border-ink-600 text-ink-300' },
  };
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Laptop className="size-5 text-ember-400" />
        <h2 className="font-semibold text-ink-100">Devices & network</h2>
        <span className="text-xs text-ink-500">{devices.length} device{devices.length === 1 ? '' : 's'} · {new Set(access.map((a) => a.ip)).size} network{new Set(access.map((a) => a.ip)).size === 1 ? '' : 's'}</span>
        {canUnlock && <Button size="sm" variant="ghost" className="ml-auto" onClick={unlock}><Unlock className="size-3.5" /> Unlock device</Button>}
      </div>
      {msg && <p className="mb-2 text-xs text-emerald-300">{msg}</p>}
      {sharedWith.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {sharedWith.map((s) => (
            <li key={s.attemptId} className="flex flex-wrap items-center gap-2 text-sm">
              <Link2 className="size-3.5 text-ink-400" />
              <Badge className={KIND[s.kind].cls}>{KIND[s.kind].label}</Badge>
              <span className="text-ink-300">as</span>
              <Link to={`/hiring/attempts/${s.attemptId}`} className="text-ember-300 hover:text-ember-200">{s.name}</Link>
            </li>
          ))}
        </ul>
      )}
      {access.length ? (
        <div className="overflow-x-auto rounded-lg border border-ink-800">
          <table className="w-full text-xs">
            <thead className="bg-ink-850 text-left text-ink-400"><tr><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">IP address</th><th className="px-3 py-2 font-medium">Browser</th><th className="px-3 py-2 font-medium">Browser id</th><th className="px-3 py-2 font-medium">Fingerprint</th></tr></thead>
            <tbody>
              {access.map((a, i) => (
                <tr key={i} className="border-t border-ink-800">
                  <td className="px-3 py-1.5 font-mono text-ink-300">{startedAt && a.t >= startedAt ? `T+${duration(a.t - startedAt)}` : new Date(a.t).toLocaleString()}</td>
                  <td className="px-3 py-1.5 font-mono text-ink-200"><Globe className="mr-1 inline size-3 text-ink-500" />{a.ip ?? '—'}</td>
                  <td className="px-3 py-1.5 text-ink-300">{browserOf(a.user_agent)}</td>
                  <td className="px-3 py-1.5 font-mono text-ink-400">{short(a.device_id)}</td>
                  <td className="px-3 py-1.5 font-mono text-ink-400">{short(a.fingerprint)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-ink-400">No access recorded.</p>}
      <p className="mt-2 text-[11px] text-ink-500">A shared network is common in offices and universities and is shown for context only. A shared browser means the same browser profile was used for both tests.</p>
    </Card>
  );
}
