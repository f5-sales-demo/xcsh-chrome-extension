/**
 * The xcsh terminal stylesheet, injected as a string at panel boot (Task 10).
 * Pixel-faithful to the old inline CSS but driven entirely off the `--*` token
 * custom properties from `injectTokens` (Task 2), so the look is single-sourced.
 * Notable carry-forwards: the F5 user-message block (`.msg-user` red `┃` accent
 * via `border-left` + italic `.user-body` on `--deep-charcoal`), the gutter grid
 * (`.row`), the `✻` `.spin` keyframes, and the powerline `.seg`/`.sep` statusbar.
 */
export const PANEL_CSS = `
* { box-sizing: border-box; }
html,body { margin:0; height:100%; }
body { background: var(--charcoal); color: var(--bright-white);
  font: 13px/1.5 var(--font-mono); display:flex; flex-direction:column; position:relative; }
header { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--subtle-gray); }
header .mark { color: var(--f5-red); font-weight:700; letter-spacing:.05em; }
header .sub { color: var(--dim); }
#sess { font-size:11px; color: var(--dim); white-space:nowrap; margin-left:auto; }
.dot { width:8px; height:8px; border-radius:50%; background: var(--alert-red); }
.dot.on { background: var(--signal-green); }
#mode { background: var(--deep-charcoal); color: var(--bright-white); border:1px solid var(--subtle-gray);
  border-radius:6px; padding:4px 8px; font:inherit; font-size:12px; cursor:pointer; }
#mode:hover { border-color: var(--f5-red); }
.chip { display:flex; align-items:center; gap:8px; padding:6px 12px; border-bottom:1px solid var(--subtle-gray);
  color: var(--dim); font-size:12px; }
.chip .title { color: var(--bright-white); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.chip button { margin-left:auto; background:none; border:1px solid var(--subtle-gray); color: var(--dim);
  border-radius:6px; padding:2px 8px; cursor:pointer; font:inherit; }
.chip button + button { margin-left:6px; }
#messages { flex:1; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
.row { display:grid; grid-template-columns: var(--gutter) 1fr; column-gap:8px; }
.gutter { color: var(--bright-white); text-align:center; }
.g-thinking, .g-user { color: var(--f5-red); }
.g-tool-ok { color: var(--chrome-accent); }
.g-tool-err, .g-error { color: var(--alert-red); }
.content .body a { color: var(--chrome-accent); }
.msg-user { background: var(--deep-charcoal); border-left:3px solid var(--f5-red); }
.user-body { font-style: italic; color: var(--bright-white); }
.thinking { color: var(--dim); }
.tool-body { color: var(--cool-gray); font-size:12px; }
.error { color: var(--alert-red); }
pre.code { background:#05070a; border:1px solid var(--subtle-gray); border-radius:6px; padding:8px; overflow:auto; }
code { background:#05070a; padding:1px 5px; border-radius:4px; }
.spin { animation: spin 1s steps(8) infinite; } @keyframes spin { to { opacity:.4 } }
.statusbar { display:flex; align-items:center; font-size:11px; border-top:1px solid var(--subtle-gray); }
.seg { position:relative; padding:2px 10px 2px 8px; }
.seg .sep { position:absolute; right:-7px; top:0; z-index:1; }
.seg-context { margin-left:auto; }
form#composer { display:flex; gap:8px; padding:10px 12px; border-top:1px solid var(--subtle-gray); }
#input { flex:1; resize:none; min-height:38px; max-height:140px; background: var(--deep-charcoal);
  color: var(--bright-white); border:1px solid var(--subtle-gray); border-radius:8px; padding:8px 10px; font:inherit; }
#send, #stop { background: var(--f5-red); color:#fff; border:none; border-radius:8px; padding:0 14px; cursor:pointer; font:inherit; }
#send:disabled { opacity:.5; cursor:default; }
.activation-overlay { position:absolute; inset:0; z-index:5; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:10px; background: var(--charcoal); padding:24px; }
.activation-overlay .ov-spinner { color: var(--f5-red); font-size:20px; }
.activation-overlay .ov-title { color: var(--bright-white); font-size:13px; letter-spacing:.04em; }
.activation-overlay .ov-gates { list-style:none; margin:8px 0 0; padding:0; width:100%; max-width:260px; }
.activation-overlay .ov-gate { display:flex; align-items:center; gap:8px; padding:4px 0; color: var(--dim); }
.activation-overlay .ov-gate .ov-ico { width:14px; text-align:center; }
.activation-overlay .ov-gate .ov-label { flex:1; }
.activation-overlay .ov-gate .ov-ms { color: var(--cool-gray); font-size:11px; white-space:nowrap; }
.activation-overlay .ov-passed { color: var(--bright-white); }
.activation-overlay .ov-passed .ov-ico { color: var(--signal-green); }
.activation-overlay .ov-active { color: var(--bright-white); }
.activation-overlay .ov-stalled, .activation-overlay .ov-stalled .ov-ico { color: var(--alert-red); }
.activation-overlay .ov-retry { margin-top:10px; background: var(--f5-red); color:#fff; border:none;
  border-radius:8px; padding:6px 16px; cursor:pointer; font:inherit; }
`;
