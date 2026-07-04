import type { ComponentChildren } from 'preact';
import { renderMarkdown } from '../../markdown-render';
import { GLYPHS } from '../../ui/theme/tokens';

export function GutterRow({
  glyph,
  glyphClass,
  children,
}: {
  glyph: string;
  glyphClass?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="row">
      <div class={`gutter ${glyphClass ?? ''}`}>{glyph}</div>
      <div class="content">{children}</div>
    </div>
  );
}

export function AssistantMessage({ text }: { text: string }) {
  // renderMarkdown output is trusted (escaped + tiny allow-list); user text never reaches here.
  return (
    <GutterRow glyph={GLYPHS.assistant} glyphClass="g-assistant">
      <div class="body" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
    </GutterRow>
  );
}

export function UserMessage({ text }: { text: string }) {
  return (
    <div class="msg-user">
      <GutterRow glyph={GLYPHS.userGutter} glyphClass="g-user">
        <div class="body user-body">{text}</div>
      </GutterRow>
    </div>
  );
}

export function ToolMessage({ tool, ok, text }: { tool: string; ok: boolean; text: string }) {
  return (
    <GutterRow glyph={GLYPHS.assistant} glyphClass={ok ? 'g-tool-ok' : 'g-tool-err'}>
      <div class="body tool-body">{`${tool}: ${ok ? '✓' : '✗'} ${text}`}</div>
    </GutterRow>
  );
}

export function ThinkingIndicator({ level }: { level?: number }) {
  const lvl = level != null ? GLYPHS.thinkingLevels[Math.min(level, GLYPHS.thinkingLevels.length - 1)] : null;
  return (
    <GutterRow glyph={GLYPHS.thinking} glyphClass="g-thinking spin">
      <div class="body thinking">Thinking…{lvl ? ` ${lvl}` : ''}</div>
    </GutterRow>
  );
}

export function ErrorMessage({ text }: { text: string }) {
  return (
    <GutterRow glyph={GLYPHS.system} glyphClass="g-error">
      <div class="body error">{text}</div>
    </GutterRow>
  );
}
