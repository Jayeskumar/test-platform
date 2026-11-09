import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo } from 'react';

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

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--color-ink-950)' },
  '.cm-gutters': { backgroundColor: 'var(--color-ink-950)', borderRight: '1px solid var(--color-ink-800)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.03)' },
});

export function CodeEditor({
  value, onChange, language, readOnly, onPaste, onCopy, minHeight,
}: {
  value: string;
  onChange?: (v: string) => void;
  language: string;
  readOnly?: boolean;
  onPaste?: (chars: number) => void;
  onCopy?: () => void;
  minHeight?: string;
}) {
  const extensions = useMemo(() => {
    const ext = [theme, EditorView.lineWrapping];
    const lang = LANGS[language];
    if (lang) ext.push(lang());
    if (onPaste || onCopy) {
      ext.push(EditorView.domEventHandlers({
        paste: (e) => { onPaste?.(e.clipboardData?.getData('text')?.length ?? 0); return false; },
        copy: () => { onCopy?.(); return false; },
      }));
    }
    return ext;
  }, [language, onPaste, onCopy]);
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={oneDark}
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
