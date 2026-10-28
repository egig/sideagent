/**
 * Neutral, host-friendly theme. Everything derives from a few public tokens; set them on :root
 * (or any ancestor) to match your design system, e.g. `--sideagent-accent: var(--primary)`.
 */
export const CSS = `
.sa-root{
  --sa-bg:var(--sideagent-bg,#ffffff);
  --sa-fg:var(--sideagent-fg,#171717);
  --sa-muted:var(--sideagent-muted,#6b6b6b);
  --sa-border:var(--sideagent-border,#e5e5e5);
  --sa-surface:var(--sideagent-surface,#f5f5f5);
  --sa-accent:var(--sideagent-accent,#171717);
  --sa-accent-fg:var(--sideagent-accent-fg,#ffffff);
  --sa-danger:var(--sideagent-danger,#b42318);
  --sa-radius:var(--sideagent-radius,10px);
  --sa-font:var(--sideagent-font,inherit);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){
  .sa-root[data-theme=auto]{
    --sa-bg:var(--sideagent-bg,#171717);--sa-fg:var(--sideagent-fg,#f5f5f5);--sa-muted:var(--sideagent-muted,#a3a3a3);
    --sa-border:var(--sideagent-border,#2e2e2e);--sa-surface:var(--sideagent-surface,#262626);
    --sa-accent:var(--sideagent-accent,#f5f5f5);--sa-accent-fg:var(--sideagent-accent-fg,#171717);color-scheme:dark}
}
:is(.dark,[data-theme=dark],[data-bs-theme=dark]) .sa-root[data-theme=auto],
.sa-root[data-theme=dark]{
  --sa-bg:var(--sideagent-bg,#171717);--sa-fg:var(--sideagent-fg,#f5f5f5);--sa-muted:var(--sideagent-muted,#a3a3a3);
  --sa-border:var(--sideagent-border,#2e2e2e);--sa-surface:var(--sideagent-surface,#262626);
  --sa-accent:var(--sideagent-accent,#f5f5f5);--sa-accent-fg:var(--sideagent-accent-fg,#171717);color-scheme:dark}
.sa-root{font-family:var(--sa-font);font-size:14px;line-height:1.5;color:var(--sa-fg);box-sizing:border-box;-webkit-font-smoothing:antialiased}
.sa-root *{box-sizing:border-box}
.sa-panel{display:flex;flex-direction:column;background:var(--sa-bg);border:1px solid var(--sa-border);overflow:hidden}
.sa-floating .sa-panel{position:fixed;right:16px;bottom:80px;width:min(400px,calc(100vw - 32px));height:min(600px,calc(100vh - 104px));border-radius:calc(var(--sa-radius) + 4px);box-shadow:0 8px 30px rgba(0,0,0,.12);z-index:2147483000}
.sa-sidebar .sa-panel{position:fixed;top:0;right:0;bottom:0;width:min(400px,100vw);border-width:0 0 0 1px;z-index:2147483000}
.sa-shell{display:flex;height:100dvh;width:100%;min-width:0}
.sa-shell-main{flex:1;min-width:0;overflow:auto;position:relative}
.sa-docked{display:contents}
.sa-docked .sa-panel{position:relative;flex:none;max-width:70vw;height:100%;border-width:0 0 0 1px;z-index:auto}
.sa-resizer{position:absolute;top:0;bottom:0;left:-3px;width:7px;cursor:col-resize;touch-action:none;z-index:1}
.sa-resizer::after{content:"";position:absolute;top:0;bottom:0;left:3px;width:2px;background:transparent;transition:background .15s}
.sa-resizer:hover::after,.sa-resizer:focus-visible::after,.sa-resizing .sa-resizer::after{background:var(--sa-muted)}
.sa-resizer:focus-visible{outline:none}
.sa-resizing{user-select:none;cursor:col-resize}
.sa-fab{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));width:48px;height:48px;border-radius:50%;border:0;background:var(--sa-accent);color:var(--sa-accent-fg);cursor:pointer;display:grid;place-items:center;box-shadow:0 4px 14px rgba(0,0,0,.2);z-index:2147483000}
.sa-header{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--sa-border)}
.sa-title{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sa-btn{border:1px solid var(--sa-border);background:transparent;color:var(--sa-fg);border-radius:calc(var(--sa-radius) - 2px);padding:4px 9px;min-height:28px;font:inherit;font-size:12px;cursor:pointer}
.sa-btn:hover{background:var(--sa-surface)}
.sa-btn[aria-pressed=true]{background:var(--sa-surface);border-color:var(--sa-muted)}
.sa-btn-primary{background:var(--sa-accent);color:var(--sa-accent-fg);border-color:var(--sa-accent)}
.sa-btn-primary:hover{background:var(--sa-accent);opacity:.88}
.sa-btn:disabled{opacity:.5;cursor:not-allowed}
.sa-root :is(button,textarea):focus-visible{outline:2px solid var(--sa-fg);outline-offset:2px}
.sa-viewport{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:14px 12px;display:flex;flex-direction:column;gap:10px}
.sa-empty{color:var(--sa-muted);text-align:center;margin:auto;padding:24px}
.sa-msg{max-width:90%;white-space:pre-wrap;word-break:break-word}
.sa-user{align-self:flex-end;background:var(--sa-surface);padding:7px 12px;border-radius:calc(var(--sa-radius) + 4px)}
.sa-assistant{align-self:flex-start}
.sa-md{white-space:normal;min-width:0}
.sa-md>:first-child{margin-top:0}.sa-md>:last-child{margin-bottom:0}
.sa-md :is(p,ul,ol,pre,table,blockquote){margin:0 0 .6em}
.sa-md :is(ul,ol){padding-left:1.4em}
.sa-md :is(h1,h2,h3,h4){font-size:1em;font-weight:600;margin:.8em 0 .3em}
.sa-md a{color:inherit;text-decoration:underline}
.sa-md code{font-family:ui-monospace,monospace;font-size:.9em;background:var(--sa-surface);padding:1px 4px;border-radius:4px}
.sa-md pre{background:var(--sa-surface);padding:8px 10px;border-radius:calc(var(--sa-radius) - 2px);overflow-x:auto}
.sa-md pre code{background:none;padding:0}
.sa-md blockquote{border-left:3px solid var(--sa-border);padding-left:10px;color:var(--sa-muted);margin-left:0}
.sa-md table{border-collapse:collapse;display:block;overflow-x:auto}
.sa-md :is(th,td){border:1px solid var(--sa-border);padding:3px 8px;text-align:left}
.sa-icon-btn{display:inline-grid;place-items:center;min-width:28px;padding:4px}
.sa-icon-btn svg{width:15px;height:15px}
.sa-tool{align-self:stretch;border:1px solid var(--sa-border);border-radius:var(--sa-radius);padding:8px 10px;font-size:13px;min-width:0}
.sa-tool-head{display:flex;align-items:center;gap:6px;font-weight:600;font-size:12.5px;margin-bottom:6px}
.sa-tool[data-state=done] .sa-tool-head svg{color:var(--sa-muted)}
.sa-tool[data-state=error] .sa-tool-head,.sa-tool[data-state=rejected] .sa-tool-head{color:var(--sa-danger)}
.sa-spin{animation:sa-rot 1s linear infinite}
@keyframes sa-rot{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.sa-spin{animation:none}}
.sa-table-wrap{overflow:auto;max-height:240px;border:1px solid var(--sa-border);border-radius:calc(var(--sa-radius) - 2px)}
.sa-table{border-collapse:collapse;width:100%;font-size:12.5px}
.sa-table th,.sa-table td{padding:5px 9px;text-align:left;white-space:nowrap;border-bottom:1px solid var(--sa-border)}
.sa-table th{position:sticky;top:0;background:var(--sa-surface);font-weight:600;color:var(--sa-muted)}
.sa-table tr:last-child td{border-bottom:0}
.sa-table .sa-num{text-align:right;font-variant-numeric:tabular-nums}
.sa-more{color:var(--sa-muted);font-size:12px;margin-top:4px}
.sa-fields{margin:0;display:grid;gap:4px}
.sa-field{display:grid;grid-template-columns:minmax(80px,35%) 1fr;gap:8px}
.sa-field dt{color:var(--sa-muted)}
.sa-field dd{margin:0;word-break:break-word}
.sa-list{margin:0;padding-left:18px}
.sa-sources{margin:0;padding:0;list-style:none;display:grid;gap:4px}
.sa-sources li{display:flex;align-items:center;gap:6px}
.sa-sources svg{flex:none;color:var(--sa-muted)}
.sa-sources a{color:inherit;text-decoration:underline;text-underline-offset:2px;display:inline-flex;align-items:center;gap:4px}
.sa-details{margin-top:6px}
.sa-details summary{cursor:pointer;color:var(--sa-muted);font-size:12px;list-style:none;display:flex;align-items:center;gap:2px}
.sa-details summary::-webkit-details-marker{display:none}
.sa-details[open] summary svg{transform:rotate(90deg)}
.sa-details pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;font-size:11.5px}
.sa-approval-title{display:flex;align-items:center;gap:6px}
.sa-approval{margin:0 12px 8px;border:1px solid var(--sa-fg);border-radius:var(--sa-radius);padding:10px;background:var(--sa-surface)}
.sa-approval pre{margin:6px 0;white-space:pre-wrap;word-break:break-word;max-height:120px;overflow:auto;font-size:12px}
.sa-approval-text{margin:6px 0}
.sa-approval .sa-fields{margin:0 0 6px}
.sa-approval .sa-row{margin-top:8px}
.sa-row{display:flex;gap:8px}
.sa-composer{display:flex;flex-direction:column;gap:4px;margin:0 12px 12px;padding:10px 10px 8px 14px;border:1px solid var(--sa-border);border-radius:18px;background:var(--sa-surface)}
.sa-input{width:100%;resize:none;border:0;background:transparent;padding:2px 0;font:inherit;color:inherit;max-height:160px}
.sa-root .sa-input:focus-visible{outline:none}
.sa-input::placeholder{color:var(--sa-muted)}
.sa-composer-bar{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sa-hint{color:var(--sa-muted);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sa-send{flex:none;margin-left:auto;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;border:0;background:var(--sa-accent);color:var(--sa-accent-fg);cursor:pointer}
.sa-send:hover{opacity:.88}
.sa-send:disabled{opacity:.35;cursor:not-allowed}
.sa-send svg{width:16px;height:16px}
.sa-chatwrap{display:flex;flex-direction:column;flex:1;min-height:0}
.sa-chatwrap[hidden]{display:none}
.sa-history{gap:6px}
.sa-back{align-self:flex-start;display:inline-flex;align-items:center;gap:4px;margin-bottom:4px}
.sa-thread{display:flex;gap:6px;align-items:stretch}
.sa-thread-open{flex:1;min-width:0;text-align:left;border:1px solid var(--sa-border);background:transparent;color:inherit;border-radius:var(--sa-radius);padding:8px 10px;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:2px}
.sa-thread-open:hover{background:var(--sa-surface)}
.sa-thread-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sa-error{color:var(--sa-danger)}
@media (max-width:640px){
  .sa-root .sa-panel{position:fixed;inset:0;width:auto!important;max-width:none;height:auto;border:0;border-radius:0;box-shadow:none;z-index:2147483000;
    padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
  .sa-resizer,.sa-mode-btn{display:none}
  .sa-input{font-size:16px}
  .sa-msg{max-width:100%}
  .sa-user{max-width:85%}
  .sa-approval{max-height:55dvh;overflow-y:auto}
}
@media (pointer:coarse){
  .sa-btn{min-height:36px}
  .sa-icon-btn{min-width:36px}
  .sa-icon-btn svg{width:17px;height:17px}
  .sa-send{width:36px;height:36px}
  .sa-hint{display:none}
}
`;
