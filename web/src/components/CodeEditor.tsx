import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { type Extension, Prec } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useState } from 'react';
import { isInternalText, rememberInternalCopy } from '../lib/proctor';
import { useTheme } from '../lib/theme';

/** Language grammars load on demand, so a Python user never downloads the Rust parser. */
const LANGS: Record<string, () => Promise<Extension>> = {
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  c: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  java: () => import('@codemirror/lang-java').then((m) => m.java()),
  go: () => import('@codemirror/lang-go').then((m) => m.go()),
  rust: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
};
const langCache = new Map<string, Extension>();

function useLanguage(id: string): Extension | null {
  const [ext, setExt] = useState<Extension | null>(() => langCache.get(id) ?? null);
  useEffect(() => {
    let alive = true;
    const cached = langCache.get(id);
    if (cached) { setExt(cached); return; }
    setExt(null);
    LANGS[id]?.().then((e) => { langCache.set(id, e); if (alive) setExt(e); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);
  return ext;
}

/** Light syntax colors, each at least 4.5:1 on white (CodeMirror's default orange is 3.8:1). */
const lightTheme: Extension = [
  EditorView.theme({}, { dark: false }),
  syntaxHighlighting(HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#b3261e' },
    { tag: [t.string, t.special(t.string), t.regexp], color: '#0a3069' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: '#5c6670', fontStyle: 'italic' },
    { tag: [t.number, t.bool, t.null, t.atom], color: '#0550ae' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: '#6f42c1' },
    { tag: [t.typeName, t.className, t.namespace, t.meta, t.processingInstruction], color: '#8a3a00' },
    { tag: [t.definition(t.variableName), t.propertyName], color: '#1f2328' },
    { tag: [t.operator, t.punctuation, t.bracket], color: '#1f2328' },
    { tag: t.invalid, color: '#b3261e', textDecoration: 'underline' },
  ])),
];

/** Surface colors follow the app palette (CSS variables), so the editor matches both themes. */
const surface = Prec.highest(EditorView.theme({
  '&': { backgroundColor: 'var(--color-ink-900)', color: 'var(--color-ink-100)' },
  '.cm-content': { caretColor: 'var(--color-ember-400)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-ember-400)' },
  '.cm-gutters': { backgroundColor: 'var(--color-ink-900)', color: 'var(--color-ink-500)', borderRight: '1px solid var(--color-ink-800)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--color-ink-700) 35%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-ink-200)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in oklab, var(--color-ember-500) 28%, transparent) !important' },
  '.cm-tooltip, .cm-panels': { backgroundColor: 'var(--color-ink-850)', border: '1px solid var(--color-ink-700)' },
}));

export function CodeEditor({
  value, onChange, language, readOnly, onPaste, onCopy, minHeight, blockExternalPaste, onBlockedPaste, fontSize, ariaLabel,
}: {
  /** Editor font size in px; changing it reconfigures the view so gutters re-measure. */
  fontSize?: number;
  /** Accessible name for the editor. */
  ariaLabel?: string;
  value: string;
  onChange?: (v: string) => void;
  language: string;
  readOnly?: boolean;
  onPaste?: (chars: number) => void;
  onCopy?: () => void;
  minHeight?: string;
  /** Only allow pasting/dropping text that was copied inside the test. */
  blockExternalPaste?: boolean;
  onBlockedPaste?: () => void;
}) {
  const { resolved } = useTheme();
  const langExt = useLanguage(language);
  const extensions = useMemo(() => {
    const ext = [surface, EditorView.lineWrapping];
    if (fontSize) ext.push(EditorView.theme({ '&': { fontSize: `${fontSize}px` } }));
    ext.push(EditorView.contentAttributes.of({
      'aria-label': ariaLabel ?? (readOnly ? `Code (${language}, read-only)` : `Code editor (${language})`),
      ...(readOnly ? { tabindex: '0' } : {}),
    }));
    if (langExt) ext.push(langExt);
    if (onPaste || onCopy || blockExternalPaste) {
      const remember = (view: EditorView) => {
        const sel = view.state.selection.main;
        rememberInternalCopy(view.state.sliceDoc(sel.from, sel.to));
      };
      ext.push(EditorView.domEventHandlers({
        paste: (e) => {
          const text = e.clipboardData?.getData('text') ?? '';
          if (blockExternalPaste && text && !isInternalText(text)) {
            e.preventDefault();
            onBlockedPaste?.();
            return true;
          }
          onPaste?.(text.length);
          return false;
        },
        drop: (e) => {
          const text = e.dataTransfer?.getData('text/plain') ?? '';
          if (blockExternalPaste && text && !isInternalText(text)) {
            e.preventDefault();
            onBlockedPaste?.();
            return true;
          }
          return false;
        },
        copy: (_e, view) => { remember(view); onCopy?.(); return false; },
        cut: (_e, view) => { remember(view); return false; },
      }));
    }
    return ext;
  }, [langExt, onPaste, onCopy, blockExternalPaste, onBlockedPaste, fontSize, ariaLabel, readOnly, language]);
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={resolved === 'dark' ? oneDark : lightTheme}
      extensions={extensions}
      readOnly={readOnly}
      editable={!readOnly}
      height="100%"
      minHeight={minHeight}
      basicSetup={{ tabSize: 4, foldGutter: false, highlightActiveLine: !readOnly }}
      className="h-full"
    />
  );
}
