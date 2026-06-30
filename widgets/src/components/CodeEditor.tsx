// CodeEditor — an editable counterpart to CodeBlock: a transparent <textarea>
// laid exactly over a shiki-highlighted layer, so you edit raw text while seeing
// live syntax highlighting (the react-simple-code-editor technique). It reuses
// CodeBlock's shiki singleton via useHighlightedHtml, so the rendered code looks
// identical whether you're reading (CodeBlock) or editing (here).
//
// Alignment: the textarea is in normal flow and auto-grows to its content
// height, defining the editor box; the highlight layer is absolutely positioned
// over it with the SAME font/size/line-height/padding (see `.ofw-code--editor`
// in widget.css). The textarea's own text is transparent (only its caret shows),
// so the colors come from the layer beneath. With `lineNumbers`, the textarea is
// padded by the gutter width so its text stays aligned with the numbered layer.
import * as React from "react";
import { normalizeLang, useHighlightedHtml } from "./CodeBlock";

const TAB = "  "; // two-space soft tab inserted on Tab (keeps focus in the editor)

export interface CodeEditorProps {
  /** Current source text (controlled). */
  value: string;
  /** Called with the next text on every edit. */
  onChange: (next: string) => void;
  /** Language name, file extension, or filename. Unknown → no highlight. */
  lang?: string | null;
  /** Show a left line-number gutter (matches CodeBlock; the textarea is padded
   *  to align its text with the gutter-offset highlight beneath). */
  lineNumbers?: boolean;
  /** Extra class(es) merged onto the `.ofw-code` wrapper. */
  className?: string;
  placeholder?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
  /** Receives the underlying <textarea> (so a parent can focus it). */
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
}

export function CodeEditor({
  value,
  onChange,
  lang,
  lineNumbers = false,
  className,
  placeholder,
  onKeyDown,
  onBlur,
  textareaRef,
}: CodeEditorProps) {
  const resolved = normalizeLang(lang);
  const html = useHighlightedHtml(value, resolved);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Grow the textarea to its content so it (in normal flow) sets the editor
  // height; the absolutely-positioned highlight layer then fills the same box.
  const resize = React.useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  React.useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  const setRef = React.useCallback(
    (el: HTMLTextAreaElement | null) => {
      taRef.current = el;
      textareaRef?.(el);
    },
    [textareaRef],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab inserts a soft tab instead of leaving the editor — basic code-editing
      // ergonomics. Anything else defers to the consumer (e.g. Escape to cancel).
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const el = e.currentTarget;
        const { selectionStart: s, selectionEnd: end } = el;
        const next = value.slice(0, s) + TAB + value.slice(end);
        onChange(next);
        // Restore the caret after the inserted tab on the next frame.
        requestAnimationFrame(() => {
          if (taRef.current) taRef.current.selectionStart = taRef.current.selectionEnd = s + TAB.length;
        });
        return;
      }
      onKeyDown?.(e);
    },
    [value, onChange, onKeyDown],
  );

  const cls = [
    "ofw-code",
    "ofw-code--editor",
    lineNumbers ? "ofw-code--numbered" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} data-lang={resolved ?? "text"}>
      <div className="ofw-code__editor">
        {html ? (
          <div className="ofw-code__hl" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="ofw-code__hl" aria-hidden="true">
            <pre className="ofw-code__raw">
              <code>{value || ""}</code>
            </pre>
          </div>
        )}
        <textarea
          ref={setRef}
          className="ofw-code__textarea"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
        />
      </div>
    </div>
  );
}

export default CodeEditor;
