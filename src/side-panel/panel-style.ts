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
  font: 13px/1.5 var(--font-mono); position:relative; }
/* Preact mounts into #root, so the full-height flex column must live here (not on
   body) — otherwise #root shrinks to content and the transcript's flex:1 has no
   height to grow into, stranding the composer below empty space. #root is also the
   positioning context for the activation overlay (position:absolute; inset:0). */
#root { height:100%; display:flex; flex-direction:column; position:relative; }
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
#messages { flex:1; min-height:0; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
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
/* The statusline is embedded ON the composer's top border (xcsh-style), not a
   separate bar above it: absolutely positioned so its chips straddle the frame. */
.statusbar { position:absolute; top:-11px; left:12px; right:12px; display:flex; align-items:center; height:20px; font-size:11px; }
.statusbar .seg { position:relative; display:flex; align-items:center; height:20px; padding:2px 10px; white-space:nowrap; }
/* Powerline caps: CSS clip-path triangles sized to EXACTLY the segment height
   (height:100% of the 20px .seg), each filled with its segment's own background so
   the chip bleeds into a seamless slanted point. Width 9.4px is the measured MesloLGS
   powerline slope (glyph inkW/inkH ~= 0.47) at 20px, so it reads identically to the
   iTerm2 cap while being immune to the font glyph's 1.32x ink overscan. See #213. */
.statusbar .sep-r { position:absolute; right:-9.4px; top:0; height:100%; width:9.4px; z-index:1; clip-path:polygon(0 0, 100% 50%, 0 100%); }
.statusbar .sep-l { position:absolute; left:-9.4px; top:0; height:100%; width:9.4px; z-index:1; clip-path:polygon(100% 0, 0 50%, 100% 100%); }
.seg-spacer { flex:1; }
/* Composer — the shared "InputBar" look: a rounded, red-bordered box holding the
   editor on top and a footer toolbar (mode pill + icon send) below. Radius scale
   4/6/8 and layout mirror the VSCode extension so both surfaces read as one. */
form#composer { position:relative; display:flex; flex-direction:column; margin:20px 12px 10px; background: var(--deep-charcoal);
  border:1px solid var(--f5-red); border-radius:8px; }
.inputEditorContainer { padding:10px 12px; }
#input { display:block; width:100%; resize:none; min-height:20px; max-height:140px; overflow-y:auto;
  background:transparent; color: var(--bright-white); border:none; outline:none; padding:0; font:inherit; line-height:1.5; }
#input::placeholder { color: var(--dim); }
.inputFooter { display:flex; align-items:center; gap:4px; padding:4px 8px; border-top:1px solid var(--subtle-gray); }
.footerSpacer { flex:1; }
.footerBtn { display:flex; align-items:center; gap:4px; background:none; border:none; color: var(--cool-gray);
  cursor:pointer; padding:4px 8px; border-radius:4px; font:inherit; font-size:12px; }
.footerBtn:hover { color: var(--bright-white); }
.modeBtn { color: var(--bright-white); border:1px solid var(--subtle-gray); border-radius:6px; font-weight:500; }
.modeBtn:hover { border-color: var(--f5-red); }
.sendBtn { background: var(--f5-red); color:#fff; border-radius:6px; padding:4px 8px; }
.sendBtn:disabled { opacity:.5; cursor:default; }
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
.body.error .msg-retry { margin-left:8px; background:transparent; color: var(--f5-red); border:1px solid var(--f5-red);
  border-radius:6px; padding:1px 8px; cursor:pointer; font:inherit; font-size:0.85em; vertical-align:baseline; }
`;
