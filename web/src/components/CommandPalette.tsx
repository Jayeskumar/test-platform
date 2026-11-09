import { ArrowRight, ClipboardList, Flag, Code2, Database, FileQuestion, Gauge, Home, LayoutDashboard, ListChecks, Moon, Plus, Search, Sun, Trophy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import { cx, DIFFICULTY_CLS } from '../lib/format';
import { useTheme } from '../lib/theme';

interface Item { id: string; label: string; group: string; icon: any; hint?: string; hintCls?: string; run: () => void; keywords?: string }

/** Ctrl/⌘+K: jump to any page, problem or assessment. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [problems, setProblems] = useState<any[] | null>(null);
  const [assessments, setAssessments] = useState<any[] | null>(null);
  const nav = useNavigate();
  const { user } = useAuth();
  const { resolved, setMode } = useTheme();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    const openEv = () => setOpen(true);
    window.addEventListener('keydown', h);
    window.addEventListener('crucible:palette', openEv);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('crucible:palette', openEv); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSel(0);
    setTimeout(() => input.current?.focus(), 0);
    if (!problems) api.get<{ problems: any[] }>('/api/problems').then((r) => setProblems(r.problems)).catch(() => setProblems([]));
    if (isStaff(user) && !assessments) api.get<{ assessments: any[] }>('/api/assessments').then((r) => setAssessments(r.assessments)).catch(() => setAssessments([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (to: string) => () => { setOpen(false); nav(to); };
  const items = useMemo<Item[]>(() => {
    const pages: Item[] = [
      { id: 'p-home', label: 'Home', group: 'Go to', icon: Home, run: go('/') },
      { id: 'p-practice', label: 'Practice problems', group: 'Go to', icon: Code2, run: go('/problems') },
      { id: 'p-contests', label: 'Contests', group: 'Go to', icon: Flag, run: go('/contests') },
      { id: 'p-board', label: 'Leaderboard', group: 'Go to', icon: Trophy, run: go('/leaderboard') },
      ...(user ? [{ id: 'p-progress', label: 'My progress', group: 'Go to', icon: Gauge, run: go('/dashboard') }] : []),
      ...(isStaff(user) ? [
        { id: 'p-hiring', label: 'Hiring dashboard', group: 'Go to', icon: LayoutDashboard, run: go('/hiring') },
        { id: 'p-library', label: 'Question library', group: 'Go to', icon: FileQuestion, run: go('/library') },
        { id: 'a-new-asmt', label: 'New assessment', group: 'Create', icon: Plus, run: go('/hiring/new') },
        { id: 'a-new-q', label: 'New question', group: 'Create', icon: Plus, run: go('/library/new') },
      ] : []),
      { id: 'a-theme', label: `Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`, group: 'Preferences', icon: resolved === 'dark' ? Sun : Moon, run: () => { setMode(resolved === 'dark' ? 'light' : 'dark'); setOpen(false); }, keywords: 'theme dark light mode' },
    ];
    const probs: Item[] = (problems ?? []).map((p) => ({
      id: `q-${p.id}`, label: p.title, group: 'Problems', icon: p.type === 'sql' ? Database : p.type === 'mcq' ? ListChecks : Code2,
      hint: p.difficulty, hintCls: DIFFICULTY_CLS[p.difficulty as 'easy'], keywords: p.tags.join(' '), run: go(`/problems/${p.slug}`),
    }));
    const asmts: Item[] = (assessments ?? []).map((a) => ({
      id: `as-${a.id}`, label: a.title, group: 'Assessments', icon: ClipboardList, hint: `${a.completed}/${a.invited} done`, run: go(`/hiring/${a.id}`),
    }));
    return [...pages, ...asmts, ...probs];
  }, [problems, assessments, user, resolved]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = items.filter((i) => words.every((w) => `${i.label} ${i.group} ${i.keywords ?? ''} ${i.hint ?? ''}`.toLowerCase().includes(w))).slice(0, 40);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { list.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  if (!open) return null;
  let lastGroup = '';
  return (
    <div className="no-print fixed inset-0 z-[70] flex items-start justify-center bg-ink-950/70 px-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl shadow-black/30" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-ink-800 px-4">
          <Search className="size-4 text-ink-400" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); shown[sel]?.run(); }
              else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Search problems, assessments and pages…"
            className="h-12 flex-1 bg-transparent text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[sel] ? `pal-${shown[sel].id}` : undefined}
          />
          <kbd className="rounded border border-ink-700 px-1.5 text-[10px] text-ink-400">Esc</kbd>
        </div>
        <ul ref={list} id="palette-list" role="listbox" className="max-h-[50vh] overflow-auto p-2">
          {shown.map((i, idx) => {
            const header = i.group !== lastGroup ? (lastGroup = i.group) : null;
            return (
              <li key={i.id} role="presentation">
                {header && <div className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">{header}</div>}
                <button
                  id={`pal-${i.id}`}
                  role="option"
                  aria-selected={idx === sel}
                  data-idx={idx}
                  onMouseMove={() => setSel(idx)}
                  onClick={i.run}
                  className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm', idx === sel ? 'bg-ink-800 text-ink-100' : 'text-ink-200')}
                >
                  <i.icon className="size-4 shrink-0 text-ink-400" />
                  <span className="flex-1 truncate">{i.label}</span>
                  {i.hint && <span className={cx('text-xs capitalize', i.hintCls ?? 'text-ink-500')}>{i.hint}</span>}
                  {idx === sel && <ArrowRight className="size-3.5 text-ink-400" />}
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="px-3 py-8 text-center text-sm text-ink-400">No matches for “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}

export const openPalette = () => window.dispatchEvent(new Event('crucible:palette'));
