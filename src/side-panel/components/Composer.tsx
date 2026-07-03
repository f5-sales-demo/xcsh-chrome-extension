import { useRef } from 'preact/hooks';

export function Composer({
  disabled,
  sending,
  onSend,
  onStop,
}: {
  disabled: boolean;
  sending: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const el = ref.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text) return;
    onSend(text);
    el.value = '';
    el.style.height = 'auto';
  }

  function autosize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  return (
    <form
      id="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        id="input"
        ref={ref}
        placeholder="ask xcsh about this page…"
        rows={1}
        onInput={autosize}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {sending ? (
        <button id="stop" type="button" onClick={onStop}>
          stop
        </button>
      ) : (
        <button id="send" type="submit" disabled={disabled}>
          send
        </button>
      )}
    </form>
  );
}
