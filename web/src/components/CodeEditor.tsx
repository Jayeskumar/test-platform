import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo } from 'react';
import { isInternalText, rememberInternalCopy } from '../lib/proctor';
import { useTheme } from '../lib/theme';

const LANGS: Record<string, () => any> = {
  python: () => python(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  cpp: () => cpp(),
  c: () => cpp(),
  java: () => java(),
  go: () => go(),
  rust: () => rust(),
  sql: () => sql(),
};

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
  value, onChange, language, readOnly, onPaste, onCopy, minHeight, blockExternalPaste, onBlockedPaste, fontSize,
}: {
  /** Editor font size in px; changing it reconfigures the view so gutters re-measure. */
  fontSize?: number;
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
  const extensions = useMemo(() => {
    const ext = [surface, EditorView.lineWrapping];
    if (fontSize) ext.push(EditorView.theme({ '&': { fontSize: `${fontSize}px` } }));
    const lang = LANGS[language];
    if (lang) ext.push(lang());
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
  }, [language, onPaste, onCopy, blockExternalPaste, onBlockedPaste, fontSize]);
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={resolved === 'dark' ? oneDark : 'light'}
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
