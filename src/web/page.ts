import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PAYTACA_LOGO, PAYTACA_AI_LOGO } from './assets.js'

const require = createRequire(new URL('.', import.meta.url).href)
const ALPINE_JS = fs.readFileSync(
  path.join(path.dirname(require.resolve('alpinejs/package.json')), 'dist', 'cdn.min.js'),
  'utf8'
)

export function renderPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Paytaca</title>
<link rel="icon" type="image/png" href="${PAYTACA_LOGO}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --sans:'Rubik',system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:'JetBrains Mono',ui-monospace,'SF Mono','Cascadia Code',monospace;
  --bg:#ecf3f3;
  --surface:rgba(255,255,255,0.72);
  --surface-2:#f0f4f5;
  --surface-3:rgba(255,255,255,0.85);
  --ink:#1c2833;
  --ink-2:#4c4f4f;
  --ink-3:#9e9e9e;
  --line:rgba(0,0,0,0.08);
  --line-2:rgba(0,0,0,0.05);
  --accent:#3C64F6;
  --accent-strong:#2b4fd8;
  --accent-soft:rgba(60,100,246,0.12);
  --ok:#28a745;
  --ok-soft:rgba(40,167,69,0.12);
  --warn:#d4a017;
  --warn-soft:rgba(255,193,7,0.12);
  --err:#e5484d;
  --err-soft:rgba(229,72,77,0.1);
  --r:16px;--r-sm:10px;
  --shadow:0 2px 8px rgba(0,0,0,0.05);
  --glass-hi:inset 0 1px 0 rgba(255,255,255,0.6);
  --grad:linear-gradient(to right bottom,rgba(59,123,246,0.9),rgba(54,129,232,0.9),rgba(49,139,218,0.9),rgba(44,149,204,0.9),rgba(39,159,190,0.9));
  --on-ink:#fff;
}
[data-theme="dark"]{
  --bg:#273746;
  --surface:rgba(28,40,51,0.7);
  --surface-2:#1c2833;
  --surface-3:rgba(39,55,70,0.85);
  --ink:#eef2f5;
  --ink-2:#c8c8c8;
  --ink-3:#8a949e;
  --line:rgba(255,255,255,0.1);
  --line-2:rgba(255,255,255,0.07);
  --accent:#5b82f8;
  --accent-strong:#7ea0fa;
  --accent-soft:rgba(91,130,248,0.16);
  --ok:#4ade80;
  --ok-soft:rgba(74,222,128,0.15);
  --warn:#fbbf24;
  --warn-soft:rgba(255,193,7,0.15);
  --err:#f05253;
  --err-soft:rgba(240,82,83,0.15);
  --shadow:0 8px 32px rgba(0,0,0,0.35);
  --glass-hi:inset 0 1px 0 rgba(255,255,255,0.1);
  --on-ink:#eef2f5;
}
[x-cloak]{display:none!important}
body{font-family:var(--sans);background:var(--bg);color:var(--ink);font-size:14px;font-weight:300;line-height:1.55;min-height:100dvh;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
::selection{background:var(--accent);color:#fff}
.mono-break{font-family:var(--mono);font-size:11.5px;word-break:break-all}
.shell{display:flex;align-items:stretch;min-height:100dvh}
.sidebar{position:sticky;top:0;flex:none;width:236px;height:100dvh;display:flex;flex-direction:column;background:var(--surface);backdrop-filter:blur(16px) saturate(180%);-webkit-backdrop-filter:blur(16px) saturate(180%);border-right:1px solid var(--line);z-index:40}
.brand{display:flex;align-items:center;gap:11px;padding:20px 18px;border-bottom:1px solid var(--line-2)}
.brand-logo{width:30px;height:auto;flex:none;border-radius:8px;display:block}
.brand-name{font-size:16px;font-weight:500;letter-spacing:-0.02em;color:var(--ink)}
.nav{flex:1;display:flex;flex-direction:column;gap:3px;padding:14px 12px}
.nav-label{font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-3);padding:6px 10px 8px}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:var(--r-sm);font-size:13.5px;font-weight:400;color:var(--ink-2);cursor:pointer;user-select:none;transition:background .12s ease-out,color .12s ease-out}
.nav-item:hover{background:var(--surface-3);color:var(--ink)}
.nav-item.active{background:var(--accent);color:#fff;box-shadow:0 4px 20px rgba(31,38,135,0.18)}
.nav-item .idx{font-family:var(--mono);font-size:10px;color:var(--ink-3)}
.nav-item.active .idx{color:rgba(255,255,255,0.7)}
.nav-ico{width:20px;height:20px;flex:none;border-radius:5px;display:block}
.sidebar-foot{display:flex;flex-direction:column;gap:10px;padding:16px 18px;border-top:1px solid var(--line-2)}
.net{display:flex;align-items:center;gap:9px;font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:0.1em;color:var(--ink-2)}
.dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.dot.chipnet{background:var(--warn);box-shadow:0 0 0 3px var(--warn-soft)}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 30px;background:var(--surface);backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);border-bottom:1px solid var(--line)}
.page-title{font-size:15px;font-weight:500;letter-spacing:-0.01em;color:var(--ink)}
.topbar-actions{display:flex;align-items:center;gap:10px}
.live-pill{display:flex;align-items:center;gap:7px;padding:6px 11px;border:1px solid var(--line);border-radius:999px;background:var(--surface-3);font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3)}
.live-pill .live-dot{width:6px;height:6px;border-radius:50%;background:var(--ink-3)}
.live-pill.ws-live{color:var(--ink-2)}
.live-pill.ws-live .live-dot{background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.tx-toast{position:fixed;top:74px;right:30px;z-index:150;display:flex;flex-direction:column;gap:4px;min-width:240px;max-width:320px;padding:14px 16px;background:var(--surface-3);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--line);color:var(--ink);border-radius:var(--r);box-shadow:0 10px 32px rgba(0,0,0,0.28);animation:modalIn .2s cubic-bezier(.16,1,.3,1)}
.tx-toast .t{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--ink-3)}
.tx-toast .a{font-size:17px;font-weight:500;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.tx-toast a{font-family:var(--mono);font-size:10.5px;color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.tx-toast a:hover{color:var(--accent-strong)}
.content{width:100%;max-width:1400px;margin:0 auto;padding:26px 30px 56px}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
.span-4{grid-column:span 4}.span-5{grid-column:span 5}.span-6{grid-column:span 6}.span-7{grid-column:span 7}.span-8{grid-column:span 8}.span-12{grid-column:span 12}
.grid>div{display:flex;flex-direction:column}.grid>div>.card{flex:1}
.card{background:var(--surface);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:var(--r);padding:20px;box-shadow:var(--shadow),var(--glass-hi)}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.card-title{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:0.13em;text-transform:uppercase;color:var(--ink-2)}
.action-bar{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 4px}
.action-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border:1px solid var(--line);border-radius:999px;background:var(--surface);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:var(--ink-2);font-family:var(--sans);font-size:13px;font-weight:400;cursor:pointer;user-select:none;transition:all .25s cubic-bezier(0.4,0,0.2,1)}
.action-btn:hover{color:var(--ink);border-color:var(--ink-3);transform:translateY(-1px)}
.action-btn.active{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 4px 20px rgba(31,38,135,0.18)}
.action-btn svg{flex:none}
.btn-close{margin-left:auto;flex:none;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:50%;background:transparent;color:var(--ink-3);font-size:12px;cursor:pointer;transition:color .12s,border-color .12s}
.btn-close:hover{color:var(--ink);border-color:var(--ink-3)}
.ai-head{display:flex;align-items:center;gap:14px;margin:6px 0 20px}
.ai-logo{width:44px;height:44px;border-radius:12px;flex:none;box-shadow:0 4px 20px rgba(31,38,135,0.12)}
.ai-title{font-size:18px;font-weight:500;letter-spacing:-0.01em;color:var(--ink)}
.ai-sub{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);margin-top:3px}
.balance-card{position:relative;overflow:hidden;background:var(--grad);border:1px solid rgba(255,255,255,0.2);color:#fff;box-shadow:0 8px 32px rgba(31,38,135,0.15);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
.balance-card .label{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.75);margin-bottom:14px}
.balance-card .value{display:flex;align-items:baseline;gap:9px;font-size:clamp(30px,3.4vw,42px);font-weight:600;letter-spacing:-0.035em;line-height:1;font-variant-numeric:tabular-nums}
.balance-card .value .unit{font-size:14px;font-weight:400;letter-spacing:0;color:rgba(255,255,255,0.75)}
.balance-card .sub{font-family:var(--mono);font-size:11.5px;color:rgba(255,255,255,0.75);margin-top:12px;min-height:18px}
.metric{padding:8px 0 2px}
.metric-value{font-size:clamp(30px,3vw,38px);font-weight:600;letter-spacing:-0.035em;line-height:1;color:var(--accent);font-variant-numeric:tabular-nums}
.metric-label{font-family:var(--mono);font-size:10.5px;letter-spacing:0.04em;color:var(--ink-3);margin-top:12px}
.refill-line{display:flex;align-items:center;gap:9px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line-2);font-size:12px;color:var(--ink-3);flex-wrap:wrap}
.field{margin-bottom:14px}.field:last-child{margin-bottom:0}
.field-label{display:block;font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:7px}
.field-input{width:100%;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm);color:var(--ink);font-size:13.5px;font-family:var(--sans);outline:none;transition:border-color .12s ease-out,box-shadow .12s ease-out,background .12s ease-out}
.field-input::placeholder{color:var(--ink-3)}
.field-input:focus{border-color:var(--accent);background:var(--surface);box-shadow:0 0 0 3px var(--accent-soft)}
textarea.field-input{resize:vertical;min-height:84px;line-height:1.5}
select.field-input{cursor:pointer}
input[type="number"]{-moz-appearance:textfield}input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
.field-hint{font-size:11px;color:var(--ink-3);margin-top:5px}
.field-error{font-family:var(--mono);font-size:11.5px;color:var(--err);margin-top:8px}
.field-success{font-family:var(--mono);font-size:11.5px;color:var(--ok);margin-top:8px}
.segmented{display:flex;gap:2px;padding:2px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm)}
.segmented-opt{flex:1;padding:7px 8px;text-align:center;font-size:12.5px;font-weight:400;color:var(--ink-3);border-radius:8px;cursor:pointer;user-select:none;transition:background .12s ease-out,color .12s ease-out}
.segmented-opt:hover{color:var(--ink-2)}
.segmented-opt.active{background:var(--surface-3);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,0.08)}
.inline-row{display:flex;gap:8px}
.inline-row>*{flex:1;min-width:0}
.inline-row .shrink{flex:none}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:10px 16px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface-3);color:var(--ink);font-family:var(--sans);font-size:13px;font-weight:400;cursor:pointer;white-space:nowrap;transition:background .12s ease-out,border-color .12s ease-out,transform .06s ease-out}
.btn:hover{border-color:var(--ink-3);background:var(--surface-2)}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.btn-primary{background:var(--grad);border:1px solid rgba(255,255,255,0.2);color:#fff;box-shadow:0 4px 20px rgba(31,38,135,0.12);transition:all .3s cubic-bezier(0.4,0,0.2,1)}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(31,38,135,0.18)}
.btn-primary:active{transform:translateY(1px)}
.btn-danger{background:transparent;border-color:var(--line);color:var(--err)}
.btn-danger:hover{border-color:var(--err);background:var(--err-soft)}
.btn-sm{padding:6px 11px;font-size:11.5px}
.btn-ghost{background:transparent;border-color:transparent;color:var(--ink-2)}
.btn-ghost:hover{background:var(--surface-2);border-color:transparent;color:var(--ink)}
.btn-group{display:flex;gap:8px;margin-top:16px}
.addr-display{font-family:var(--mono);font-size:12px;line-height:1.6;padding:12px;background:var(--surface-2);border:1px solid var(--line-2);border-radius:var(--r-sm);word-break:break-all}
.addr-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
.addr-label{font-family:var(--mono);font-size:9px;font-weight:500;letter-spacing:0.13em;text-transform:uppercase;color:var(--ink-3)}
.btn-copy{padding:3px 8px;border:1px solid var(--line);border-radius:3px;background:var(--surface);color:var(--ink-3);font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:0.06em;cursor:pointer;transition:border-color .12s,color .12s}
.btn-copy:hover{border-color:var(--accent);color:var(--accent)}
.qr-wrap{display:flex;justify-content:center;margin-top:16px}
.qr-wrap svg{width:100%;max-width:188px;height:auto;padding:9px;background:#fff;border:1px solid var(--line);border-radius:var(--r-sm)}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);padding:0 10px 10px;border-bottom:1px solid var(--line)}
.tbl td{padding:11px 10px;border-bottom:1px solid var(--line-2);vertical-align:middle}
.tbl tbody tr:hover{background:var(--surface-2)}
.tbl tr:last-child td{border-bottom:none}
.tbl-num{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:12px}
.hist-date a{color:var(--ink-2);text-decoration:none;border-bottom:1px dotted var(--line-2);font-family:var(--mono);font-size:11px}
.hist-date a:hover{color:var(--accent-strong);border-bottom-color:var(--accent)}.hist-addr{max-width:210px}
.hist-sub{font-family:var(--mono);font-size:10px;color:var(--ink-3);margin-top:2px}
.hist-amt{font-family:var(--mono);font-size:12px;font-variant-numeric:tabular-nums}
.hist-in{color:var(--accent-strong)}
.hist-out{color:var(--ink)}
.pill{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:0.06em}
.pill-in,.pill-active{background:var(--accent-soft);color:var(--accent-strong)}
.pill-out{background:var(--err-soft);color:var(--err)}
.pill-idle{background:var(--surface-2);color:var(--ink-3)}
.pill-ok{background:rgba(40,167,69,0.12);color:#28a745}
.pill-fail{background:var(--err-soft);color:var(--err)}
.pill-wait{background:rgba(255,193,7,0.12);color:#d4a017}
[data-theme="dark"] .pill-ok{background:rgba(40,167,69,0.18);color:#4ade80}
[data-theme="dark"] .pill-wait{background:rgba(255,193,7,0.18);color:#fbbf24}
.pagination{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:18px}
.pagination .page-info{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.empty{padding:30px 12px;text-align:center;font-family:var(--mono);font-size:11.5px;letter-spacing:0.02em;color:var(--ink-3)}
.empty::before{content:'[ '}
.empty::after{content:' ]'}
.token-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--line-2)}
.token-item:last-child{border-bottom:none}
.token-name{font-size:13.5px;font-weight:600}
.token-balance{font-family:var(--mono);font-size:12.5px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.plan-group{padding:16px 0;border-bottom:1px solid var(--line)}
.plan-group:first-child{padding-top:2px}
.plan-group:last-child{border-bottom:0;padding-bottom:2px}
.plan-model{font-size:13.5px;font-weight:600;margin-bottom:12px}
.plan-tiers{display:flex;gap:10px;flex-wrap:wrap}
.plan-tier{display:flex;align-items:center;gap:14px;border:1px solid var(--line);border-radius:var(--r-sm);padding:9px 14px;background:var(--surface-3)}
.plan-tier:hover{border-color:var(--accent);transform:translateY(-1px);transition:all .2s ease}
.plan-duration{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-2)}
.plan-price{font-size:13px;font-weight:600}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden}
.seg button{appearance:none;background:var(--surface-3);border:0;padding:8px 20px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:0.08em;color:var(--ink-3);cursor:pointer}
.seg button+.seg button{border-left:1px solid var(--line)}
.seg button.active{background:var(--accent);color:#fff}
.seg button .off{margin-left:6px;color:var(--accent)}
.seg button.active .off{color:rgba(255,255,255,0.75)}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:16px}
.gallery-item{margin:0;cursor:pointer}
.gallery-item img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border:1px solid var(--line);border-radius:var(--r-sm);transition:border-color .15s ease,opacity .15s ease;background:var(--surface-2)}
.gallery-item:hover img{border-color:var(--accent)}
.gallery-item figcaption{display:flex;justify-content:space-between;gap:8px;margin-top:7px;font-family:var(--mono);font-size:10px;color:var(--ink-3)}
.gallery-item .cap{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lightbox{display:none;position:fixed;inset:0;z-index:120;align-items:center;justify-content:center;padding:24px;background:rgba(15,25,35,0.7);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.lightbox.open{display:flex}
.lightbox-inner{width:100%;max-width:880px;animation:modalIn .2s cubic-bezier(.16,1,.3,1)}
.lightbox img{display:block;max-width:100%;max-height:74vh;margin:0 auto;border:1px solid rgba(255,255,255,0.14);border-radius:var(--r);background:var(--surface-3)}
.lightbox-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}
.lightbox-path{font-family:var(--mono);font-size:10.5px;color:rgba(255,255,255,0.75);opacity:.9;word-break:break-all}
.lightbox-actions{display:flex;gap:8px;flex-shrink:0}
.lightbox .btn{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.18);color:#fff}
.lightbox .btn:hover{background:rgba(255,255,255,0.18)}
.quote-box{margin-top:14px;padding:14px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm);font-family:var(--mono);font-size:12px;line-height:1.9;white-space:pre-line}
.warning-bar{display:flex;align-items:center;gap:8px;padding:9px 12px;margin-bottom:14px;background:var(--warn-soft);color:var(--warn);border:1px solid color-mix(in oklch,var(--warn) 28%,transparent);border-radius:var(--r-sm);font-size:12px;font-weight:500}
.kv{display:grid;grid-template-columns:auto 1fr;gap:7px 18px;font-size:12.5px}
.kv dt{font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-3);align-self:center}
.kv dd{font-weight:500;color:var(--ink)}
.modal-backdrop{display:none;position:fixed;inset:0;z-index:100;align-items:center;justify-content:center;padding:20px;background:rgba(15,25,35,0.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.modal-backdrop.open{display:flex}
.modal{width:100%;max-width:440px;padding:24px;background:var(--surface-3);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:var(--r);box-shadow:0 24px 60px -14px rgba(0,0,0,0.3),var(--glass-hi);animation:modalIn .2s cubic-bezier(.16,1,.3,1)}
.modal-title{font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px}
.modal-body{font-size:13.5px;line-height:1.75;color:var(--ink-2)}
.modal-body strong{color:var(--ink);font-weight:600}
.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}
@keyframes modalIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:200;display:flex;align-items:center;padding:10px 16px;border-radius:var(--r-sm);font-family:var(--mono);font-size:12px;font-weight:500;box-shadow:0 10px 30px -10px oklch(20% 0.02 258 / 0.35);animation:toastIn .2s cubic-bezier(.16,1,.3,1)}
.toast-ok{background:var(--ink);color:var(--bg)}
.toast-err{background:var(--err);color:#fff}
@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
@media(max-width:900px){
  .shell{flex-direction:column}
  .sidebar{position:static;width:auto;height:auto;flex-direction:row;align-items:center;gap:12px;padding:11px 14px;border-right:none;border-bottom:1px solid var(--line)}
  .brand{padding:0;border-bottom:none;gap:8px}
  .brand-logo{width:24px}
  .brand-name{display:none}
  .nav{flex-direction:row;gap:3px;padding:0;flex:1;justify-content:center}
  .nav-label{display:none}
  .nav-item{padding:7px 11px;font-size:12.5px}
  .nav-item .idx{display:none}
  .sidebar-foot{padding:0;border-top:none;flex-direction:row;gap:8px}
  .topbar{padding:12px 16px}
  .content{padding:18px 16px 44px}
  .grid{gap:12px}
  .span-4,.span-5,.span-6,.span-7,.span-8{grid-column:span 12}
  .action-btn{padding:9px 14px;font-size:12.5px}
}
@media(max-width:560px){
  .inline-row{flex-direction:column}
  .balance-card .value{font-size:30px}
  .action-bar{gap:8px}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style>
</head>
<body>
<div class="shell" x-data="app()" x-init="init()" x-cloak>
  <aside class="sidebar">
    <div class="brand">
      <img class="brand-logo" src="${PAYTACA_LOGO}" alt="Paytaca">
      <div class="brand-name">Paytaca</div>
    </div>
    <nav class="nav">
      <div class="nav-label">Navigate</div>
      <div class="nav-item" :class="{active: tab==='wallet'}" @click="tab='wallet'"><svg class="nav-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg><span class="idx">01</span>Wallet</div>
      <div class="nav-item" :class="{active: tab==='ai'}" @click="tab='ai'"><img class="nav-ico" src="${PAYTACA_AI_LOGO}" alt=""><span class="idx">02</span>AI</div>
    </nav>
    <div class="sidebar-foot">
      <div class="net"><span class="dot" :class="{chipnet: state?.network==='chipnet'}"></span><span x-text="state?.network==='chipnet' ? 'CHIPNET' : 'MAINNET'">MAINNET</span></div>
      <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;font-size:12px" @click="toggleTheme()">
        <span x-text="theme==='dark' ? '☀' : '☾'" style="font-size:14px"></span>
        <span x-text="theme==='dark' ? 'Light Mode' : 'Dark Mode'"></span>
      </button>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <div class="page-title"><span x-text="tab==='wallet' ? 'Wallet' : 'Paytaca AI'"></span></div>
      <div class="topbar-actions">
        <div class="live-pill" :class="wsStatus==='live' ? 'ws-live' : ''" :title="'Watchtower live feed: ' + wsStatus">
          <span class="live-dot"></span>
          <span x-text="wsStatus==='live' ? 'Live' : wsStatus==='connecting' ? 'Sync' : 'Off'"></span>
        </div>
        <button class="btn btn-sm" @click="load()" title="Refresh">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>
          Refresh
        </button>
      </div>
    </header>
    <main class="content">
      <div x-show="tab==='wallet'">
        <div class="grid">
          <div class="span-12">
            <div class="card balance-card">
              <div class="label">Available Balance</div>
              <div class="value"><span x-text="state ? state.balance.spendableBch : '—'"></span><span class="unit">BCH</span></div>
              <div class="sub" x-text="state?.balance?.usd ? '$' + Number(state.balance.usd).toFixed(2) + ' USD' : ''"></div>
            </div>
          </div>
        </div>
        <div class="action-bar">
          <button class="action-btn" :class="{active: walletAction==='send'}" @click="walletAction = walletAction==='send' ? null : 'send'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>Send</button>
          <button class="action-btn" :class="{active: walletAction==='receive'}" @click="walletAction = walletAction==='receive' ? null : 'receive'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7 7 17"/><path d="M16 17H7V8"/></svg>Receive</button>
          <button class="action-btn" :class="{active: walletAction==='swap'}" @click="walletAction = walletAction==='swap' ? null : 'swap'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>Swap</button>
        </div>
        <div class="grid" x-show="walletAction">
          <div class="span-12">
            <div class="card">
              <div class="card-head"><div class="card-title" x-text="walletAction==='send' ? 'Send' : walletAction==='receive' ? 'Receive' : 'Cauldron Swap'"></div><button class="btn-close" @click="walletAction=null" title="Close">✕</button></div>
              <template x-if="walletAction==='receive'"><div>
                <div class="segmented" style="margin-bottom:14px">
                  <div class="segmented-opt" :class="{active: rcvType==='bch'}" @click="rcvType='bch'; onRcvChange()">BCH</div>
                  <div class="segmented-opt" :class="{active: rcvType==='token'}" @click="rcvType='token'; onRcvChange()">CashToken</div>
                </div>
                <div class="inline-row">
                  <div style="flex:1;min-width:0">
                    <div x-show="rcvType==='token'" class="field"><label class="field-label">Token Category ID</label><input class="field-input" type="text" x-model="rcvCategory" @input="onRcvChange()" placeholder="64-character hex category ID"></div>
                    <div class="field"><label class="field-label">Amount (optional)</label><input class="field-input" type="number" x-model="rcvAmount" @input="onRcvChange()" placeholder="0.0" step="any" min="0"></div>
                    <div class="addr-display"><div class="addr-row"><span class="addr-label">Address</span><button class="btn-copy" @click="copyText(rcvView?.address)">COPY</button></div><div x-text="rcvView?.address || 'Loading…'"></div></div>
                    <template x-if="rcvView?.paymentUri"><div class="addr-display" style="margin-top:8px"><div class="addr-row"><span class="addr-label">Payment URI</span><button class="btn-copy" @click="copyText(rcvView?.paymentUri)">COPY</button></div><div style="font-size:10.5px;color:var(--ink-3)" x-text="rcvView?.paymentUri"></div></div></template>
                  </div>
                  <div class="qr-wrap" style="flex:none;width:220px;margin-top:0" x-html="rcvQrSvg"></div>
                </div>
              </div></template>
              <template x-if="walletAction==='send'"><div>
                <div class="segmented" style="margin-bottom:14px">
                  <div class="segmented-opt" :class="{active: sendType==='bch'}" @click="sendType='bch'; sendError=''; sendSuccess=''">BCH</div>
                  <div class="segmented-opt" :class="{active: sendType==='token'}" @click="sendType='token'; sendError=''; sendSuccess=''">CashToken</div>
                </div>
                <div x-show="sendType==='token'">
                  <div class="field"><label class="field-label">Token Category ID</label><select class="field-input" x-model="sendTokenPreset" @change="if(sendTokenPreset==='__custom__')sendCategory='';else sendCategory=sendTokenPreset"><option value="__custom__">Enter token category</option><option value="5932b2fd4915d6a75d3ec53282cd49118149a2176ee67ed68b1111ff0786f7fc">LIFT</option><option value="2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544">PUSD</option></select></div>
                  <div class="field" x-show="sendTokenPreset === '__custom__'"><input class="field-input" type="text" x-model="sendCategory" placeholder="Paste 64-char hex category ID"></div>
                  <div class="field"><label class="field-label">Token Amount (base units)</label><input class="field-input" type="text" x-model="sendTokenAmount" placeholder="e.g. 1000"></div>
                </div>
                <div x-show="sendType==='bch'">
                  <div class="field"><label class="field-label">Amount</label><div class="inline-row"><input class="field-input" type="number" x-model="sendAmount" placeholder="0.0" step="any" min="0"><select class="field-input shrink" x-model="sendCurrency" style="width:104px"><option value="bch">BCH</option><option value="sats">sats</option><option value="usd">USD</option></select></div></div>
                </div>
                <div class="field"><label class="field-label">Recipient Address</label><input class="field-input" type="text" x-model="sendAddress" placeholder="bitcoincash:q..."></div>
                <template x-if="sendType==='token' && sendAddress && !isTokenAddr(sendAddress)"><div class="warning-bar">Address is not token-aware (z-prefix). Tokens may be lost.</div></template>
                <div x-show="sendError" class="field-error" x-text="sendError"></div>
                <div x-show="sendSuccess" class="field-success" x-text="sendSuccess"></div>
                <button class="btn btn-primary" style="margin-top:14px;min-width:180px" @click="doSend()">Send</button>
              </div></template>
              <template x-if="walletAction==='swap'"><div>
                <template x-if="state?.network === 'chipnet'"><div class="warning-bar">Cauldron swaps are only available on mainnet.</div></template>
                <div class="field"><label class="field-label">Token</label><select class="field-input" x-model="swapToken"><option value="__custom__">Enter token category</option><template x-for="t in swapTokens" :key="t.category"><option :value="t.category" x-text="t.symbol + '  ·  ' + t.category.slice(0,10) + '…' + t.category.slice(-6)"></option></template></select></div>
                <div class="field" x-show="swapToken === '__custom__'"><input class="field-input" type="text" x-model="swapCustomCategory" placeholder="Paste 64-char hex category ID"></div>
                <div class="segmented" style="margin-bottom:14px">
                  <div class="segmented-opt" :class="{active: swapDir==='sell'}" @click="swapDir='sell'; swapQuoteText=''; pendingSwap=null">Sell Token → BCH</div>
                  <div class="segmented-opt" :class="{active: swapDir==='buy'}" @click="swapDir='buy'; swapQuoteText=''; pendingSwap=null">Buy Token ← BCH</div>
                </div>
                <div class="field"><label class="field-label" x-text="swapDir==='sell' ? 'Token Amount' : 'BCH Amount'"></label><input class="field-input" type="number" x-model="swapAmount" placeholder="0.0" step="any" min="0"></div>
                <div x-show="swapError" class="field-error" x-text="swapError"></div>
                <button class="btn btn-primary" style="margin-top:14px;min-width:180px" @click="doSwapQuote()" :disabled="swapBusy" x-text="swapBusy ? 'Fetching quote…' : 'Get Quote'"></button>
                <template x-if="swapQuoteText"><div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line-2)">
                  <div class="quote-box" style="margin-top:0" x-text="swapQuoteText"></div>
                  <div class="btn-group"><button class="btn" @click="swapQuoteText=''; pendingSwap=null">Cancel</button><button class="btn btn-primary" @click="doSwapExecute()" :disabled="swapExecBusy" x-text="swapExecBusy ? 'Executing…' : 'Confirm Swap'"></button></div>
                </div></template>
              </div></template>
            </div>
          </div>
        </div>
        <div class="grid" style="margin-top:20px">
          <div class="span-4">
            <div class="card">
              <div class="card-head"><div class="card-title">Tokens</div></div>
              <template x-if="!state?.tokens?.length"><div class="empty" x-text="state ? 'No tokens yet' : 'Loading…'"></div></template>
              <template x-for="t in state?.tokens || []" :key="t.category"><div class="token-item"><div class="token-name" x-text="t.symbol || t.name || 'Unknown'"></div><div class="token-balance" x-text="t.displayBalance"></div></div></template>
            </div>
          </div>
          <div class="span-8">
            <div class="card">
              <div class="card-head"><div class="card-title">History</div><select class="field-input" x-model="histType" @change="loadHistory(1)" style="width:auto;padding:5px 9px;font-size:11.5px"><option value="all">All</option><option value="incoming">Incoming</option><option value="outgoing">Outgoing</option></select></div>
              <template x-if="!histRecords.length && histLoading"><div class="empty">Loading…</div></template>
              <template x-if="!histRecords.length && !histLoading"><div class="empty">No transactions yet</div></template>
              <template x-if="histRecords.length"><div><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Counterparty</th><th style="text-align:right">Amount</th></tr></thead><tbody>
                <template x-for="(r, ri) in histRecords" :key="ri"><tr><td class="hist-date" style="white-space:nowrap"><a :href="r.explorer" target="_blank" rel="noopener" :title="'View '+r.txid+' on explorer'" x-text="r.dateText"></a></td><td><span class="pill" :class="r.type==='incoming'?'pill-in':'pill-out'" x-text="r.type==='incoming'?'IN':'OUT'"></span></td><td class="hist-addr"><span class="mono-break" :title="r.counterparty" x-text="r.partyShort"></span><div class="hist-sub" x-show="r.type==='outgoing' && r.fee" x-text="'fee '+r.fee+' BCH'"></div></td><td class="tbl-num" style="text-align:right"><div class="hist-amt" :class="r.type==='incoming'?'hist-in':'hist-out'" x-text="(r.type==='incoming'?'+':'-')+r.amountText+' BCH'"></div><div class="hist-sub" x-show="r.usd!=null" x-text="'≈ $'+r.usd+' USD'"></div></td></tr></template>
              </tbody></table><div class="pagination"><button class="btn btn-sm btn-ghost" @click="loadHistory(histPage - 1)" x-show="histPage > 1">← Prev</button><span class="page-info">Page <span x-text="histPage"></span> / <span x-text="histNumPages"></span></span><button class="btn btn-sm btn-ghost" @click="loadHistory(histPage + 1)" x-show="histHasNext">Next →</button></div></div></template>
            </div>
          </div>
        </div>
      </div>
      <div x-show="tab==='ai'">
        <div class="ai-head">
          <img class="ai-logo" src="${PAYTACA_AI_LOGO}" alt="">
          <div><div class="ai-title">Paytaca AI</div><div class="ai-sub">Chat credits · Image generation</div></div>
        </div>
        <div class="grid">
          <div class="span-4">
            <div class="card">
              <div class="card-head"><div class="card-title">Credits</div></div>
              <template x-if="state?.usage?.length"><div class="metric"><div class="metric-value" x-text="activeCreditsTotal(state) > 0 ? fmtDuration(activeCreditsTotal(state)) : '0m'"></div><div class="metric-label">remaining · <span x-text="activeCreditsCount(state)"></span> active session(s)</div></div></template>
              <template x-if="state && !state?.usage?.length"><div class="empty">No active sessions</div></template>
              <template x-if="!state"><div class="empty">Loading…</div></template>
              <div class="refill-line" x-show="state?.autoRefill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg><span x-text="'Auto-refill ' + (state.autoRefill?.enabled ? 'ON' : 'PAUSED') + ' · ' + state.autoRefill?.minutes + 'm top-up'"></span></div>
            </div>
          </div>
          <div class="span-8">
            <div class="card">
              <div class="card-head"><div class="card-title">Usage</div></div>
              <template x-if="state?.usage?.length"><table class="tbl"><thead><tr><th>Model</th><th>Status</th><th>Remaining</th><th>Used</th></tr></thead><tbody>
                <template x-for="(s, i) in state?.usage || []" :key="i"><tr><td style="font-size:12.5px" x-text="s.displayName || s.model || 'Unknown'"></td><td><span class="pill pill-active" x-show="s.active">ACTIVE</span><span class="pill pill-idle" x-show="!s.active">IDLE</span></td><td class="tbl-num" x-text="fmtDuration(s.remainingSeconds)"></td><td class="tbl-num" x-text="fmtDuration(s.usedSeconds)"></td></tr></template>
              </tbody></table></template>
              <template x-if="state && !state?.usage?.length"><div class="empty">No usage data</div></template>
              <template x-if="!state"><div class="empty">Loading…</div></template>
            </div>
          </div>
        </div>
        <div class="action-bar">
          <button class="action-btn" :class="{active: aiAction==='buy'}" @click="aiAction = aiAction==='buy' ? null : 'buy'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>Buy Credits</button>
          <button class="action-btn" :class="{active: aiAction==='refill'}" @click="aiAction = aiAction==='refill' ? null : 'refill'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>Auto-Refill</button>
          <button class="action-btn" :class="{active: aiAction==='images'}" @click="aiAction = aiAction==='images' ? null : 'images'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>Generate Images</button>
        </div>
        <div class="grid" x-show="aiAction==='buy' || aiAction==='refill'">
          <div class="span-12">
            <div class="card">
              <div class="card-head"><div class="card-title" x-text="aiAction==='buy' ? 'Buy Credits' : 'Auto-Refill'"></div><button class="btn-close" @click="aiAction=null" title="Close">✕</button></div>
              <template x-if="aiAction==='buy'"><div>
                <span class="pill pill-idle" x-show="state?.liftDiscountPercent" x-text="state.liftDiscountPercent + '% OFF WITH LIFT'"></span>
              <template x-if="state?.plans?.length"><div>
                <template x-for="plan in state?.plans || []" :key="plan.modelId">
                  <div class="plan-group">
                    <div class="plan-model" x-text="plan.displayName || plan.modelId"></div>
                    <div class="plan-tiers">
                      <template x-for="tier in plan.tiers || []" :key="tier.minutes">
                        <div class="plan-tier">
                          <span class="plan-duration" x-text="tier.durationDisplay"></span>
                          <span class="plan-price" x-text="tier.priceUsd != null ? '$' + tier.priceUsd.toFixed(2) : (tier.priceSats/1e8).toFixed(8) + ' BCH'"></span>
                          <button class="btn btn-sm btn-primary" @click="startPurchase(plan.modelId, tier.minutes, tier.priceUsd, tier.priceSats, tier.durationDisplay, plan.displayName || plan.modelId)">Buy</button>
                        </div>
                      </template>
                    </div>
                  </div>
                </template>
              </div></template>
              <template x-if="state && !state?.plans?.length"><div class="empty">No plans available</div></template>
              <template x-if="!state"><div class="empty">Loading…</div></template>
              </div></template>
              <template x-if="aiAction==='refill'"><div>
              <template x-if="state && (!state.autoRefill || refillEditing)"><div>
                <div style="font-size:12.5px;color:var(--ink-3);margin-bottom:12px">Auto-refill buys a new plan when credits run out. It tops up immediately if this model has no active credits.</div>
                <div class="inline-row">
                  <div class="field"><label class="field-label">Model</label><select class="field-input" x-model="refillModel"><option value="">Select model</option><template x-for="p in state?.plans || []" :key="p.modelId"><option :value="p.modelId" x-text="p.displayName || p.modelId"></option></template></select></div>
                  <div class="field"><label class="field-label">Top up (minutes)</label><select class="field-input" x-model="refillMinutes"><template x-for="m in [15,30,60]" :key="m"><option :value="String(m)" x-text="m"></option></template><template x-if="refillMinutes && ![15,30,60].includes(parseInt(refillMinutes))"><option :value="refillMinutes" x-text="refillMinutes"></option></template></select></div>
                </div>
                <div class="inline-row" style="margin-top:12px">
                  <div class="field"><label class="field-label">Budget cap (minutes, optional)</label><input class="field-input" type="number" min="1" x-model="refillMax" placeholder="Unlimited"></div>
                  <div class="field"><label class="field-label">Pay with</label><select class="field-input" x-model="refillPayMethod"><option value="bch">BCH</option><option value="lift">LIFT</option></select></div>
                </div>
                <div style="margin-top:6px;font-size:11.5px;color:var(--ink-3)">Budget cap must be at least twice the top-up and a whole-number multiple of it<span x-text="' (min ' + (parseInt(refillMinutes||'30')*2) + ' min, steps of ' + parseInt(refillMinutes||'30') + ')'"></span>.</div>
                <template x-if="refillNotice"><div style="margin-top:12px;font-size:12.5px;color:var(--ink-3)" x-text="refillNotice"></div></template>
                <div style="margin-top:16px;display:flex;gap:8px">
                  <button class="btn btn-sm btn-primary" @click="enableRefill()" x-text="refillEditing ? 'Save & Resume' : 'Enable Auto-Refill'"></button>
                  <button class="btn btn-sm" x-show="refillEditing" @click="cancelRefillEdit()">Cancel</button>
                </div>
              </div></template>
              <template x-if="state?.autoRefill && !refillEditing"><div>
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                  <dl class="kv">
                    <dt>Model</dt><dd x-text="state.autoRefill.model"></dd>
                    <dt>Every</dt><dd><span x-text="state.autoRefill.minutes"></span> min</dd>
                    <dt>Budget</dt><dd x-text="state.autoRefill.maxMinutes ? (state.autoRefill.remainingMinutes || 0) + ' of ' + state.autoRefill.maxMinutes + ' min left' : (state.autoRefill.remainingMinutes || 0) + ' min left (no cap)'"></dd>
                    <dt>Refills</dt><dd x-text="state.autoRefill.refillCount || 0"></dd>
                  </dl>
                  <span class="pill" :class="state.autoRefill.enabled ? 'pill-active' : ''" x-text="state.autoRefill.enabled ? 'ACTIVE' : 'PAUSED'"></span>
                </div>
                <template x-if="state.autoRefill.lastEvent"><div style="margin-top:12px;font-size:12px;color:var(--ink-3)" x-text="'Last: ' + state.autoRefill.lastEvent.action + '/' + state.autoRefill.lastEvent.status + (state.autoRefill.lastEvent.reason ? ' — ' + state.autoRefill.lastEvent.reason : '')"></div></template>
                <template x-if="refillNotice"><div style="margin-top:8px;font-size:12.5px;color:var(--ink-3)" x-text="refillNotice"></div></template>
                <template x-if="!state.autoRefill.enabled && state.autoRefill.maxMinutes && (state.autoRefill.remainingMinutes || 0) < (state.autoRefill.minutes || 0)"><div style="margin-top:8px;font-size:12.5px;color:var(--ink-3)">Budget exhausted — Edit to raise the cap before resuming.</div></template>
                <div style="margin-top:18px;display:flex;gap:8px">
                  <button class="btn btn-sm btn-primary" x-show="!state.autoRefill.enabled" @click="resumeRefill()">Resume</button>
                  <button class="btn btn-sm btn-danger" x-show="state.autoRefill.enabled" @click="pauseRefill()">Pause</button>
                  <button class="btn btn-sm" @click="startRefillEdit()">Edit</button>
                  <button class="btn btn-sm" @click="deleteRefill()">Delete</button>
                </div>
              </div></template>
              <template x-if="!state"><div class="empty">Loading…</div></template>
              </div></template>
            </div>
          </div>
        </div>
        <div x-show="aiAction==='images'" class="grid">
          <div class="span-5">
            <div class="card">
              <div class="card-head"><div class="card-title">Image Generation</div></div>
              <div class="field"><label class="field-label">Prompt</label><textarea class="field-input" x-model="imgPrompt" placeholder="Describe the image you want to create..."></textarea></div>
              <template x-if="state?.imageModels?.length"><div class="field"><label class="field-label">Model</label><select class="field-input" x-model="imgModel"><template x-for="m in state?.imageModels || []" :key="m.id"><option :value="m.id" x-text="m.name || m.id"></option></template></select></div></template>
              <div class="inline-row"><div class="field"><label class="field-label">Aspect Ratio</label><select class="field-input" x-model="imgAspect"><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="4:3">4:3</option><option value="3:4">3:4</option></select></div><div class="field"><label class="field-label">Quality</label><select class="field-input" x-model="imgQuality"><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra High</option><option value="max">Max</option></select></div></div>
              <button class="btn btn-primary" style="margin-top:14px;width:100%" @click="doImageQuote()" :disabled="imgQuoteBusy" x-text="imgQuoteBusy ? 'Quoting…' : 'Get Quote'"></button>
            </div>
            <div class="card" style="margin-top:14px">
              <div class="card-head"><div class="card-title">Order History</div></div>
              <template x-for="h in (state?.imageHistory || []).slice(0,10)" :key="h.id">
                <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line-2)">
                  <span class="pill" :class="{'pill-ok':h.status==='completed','pill-fail':h.status==='failed','pill-wait':h.status==='processing'||h.status==='pending','pill-idle':!h.status||(!['completed','failed','processing','pending'].includes(h.status))}" x-text="(h.status||'unknown').toUpperCase()"></span>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" x-text="h.model_display_name || h.model || 'Unknown'"></div>
                    <div style="font-size:11px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" x-text="h.prompt || 'No prompt'"></div>
                  </div>
                  <div style="text-align:right;flex-shrink:0;font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">
                    <div x-text="(h.created_at || '').slice(0,10)"></div>
                    <div x-show="h.price_usd != null || h.actual_cost_usd != null" x-text="'$' + (h.price_usd != null ? h.price_usd : h.actual_cost_usd).toFixed(2)"></div>
                  </div>
                  <template x-if="h.status==='completed' && h.filepath"><button class="btn btn-sm btn-ghost" style="flex-shrink:0;padding:4px 6px" @click.stop="openImage(h)" title="View image"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></button></template>
                </div>
              </template>
              <template x-if="state && !(state?.imageHistory || []).length"><div class="empty">No orders yet</div></template>
            </div>
          </div>
          <div class="span-7">
            <div class="card">
              <div class="card-head"><div class="card-title">Gallery</div><span class="pill pill-idle" x-show="(state?.imageHistory || []).filter(h => h.status === 'completed' && h.filepath).length" x-text="(state?.imageHistory || []).filter(h => h.status === 'completed' && h.filepath).length + ' SAVED'"></span></div>
              <template x-if="(state?.imageHistory || []).filter(h => h.status === 'completed' && h.filepath).length"><div class="gallery">
                <template x-for="h in (state?.imageHistory || []).filter(h => h.status === 'completed' && h.filepath)" :key="h.id">
                  <figure class="gallery-item" @click="openImage(h)">
                    <img :src="'/api/ai/images/' + h.id + '/file?token=' + token" :alt="h.prompt || 'Generated image'" loading="lazy">
                    <figcaption><span class="cap" x-text="imgCaption(h)"></span><span x-text="(h.completed_at || '').slice(0,10)"></span></figcaption>
                  </figure>
                </template>
              </div></template>
              <template x-if="state && !(state?.imageHistory || []).some(h => h.status === 'completed' && h.filepath)"><div class="empty">No images yet — generate your first one</div></template>
              <template x-if="!state"><div class="empty">Loading…</div></template>
              <div style="font-size:10.5px;color:var(--ink-3);font-family:var(--mono);margin-top:16px" x-show="state">files saved in ~/.paytaca/images · click an image to view</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
<div class="modal-backdrop" :class="{open: showPurchaseModal}" @click.self="showPurchaseModal=false"><div class="modal" role="dialog" aria-modal="true"><div class="modal-title">Confirm Purchase</div><div class="modal-body"><strong x-text="pendingPurchase?.displayName"></strong><br>Duration: <span x-text="pendingPurchase?.durationDisplay"></span></div><div class="seg" style="margin-top:16px" role="tablist"><button :class="{active: purchaseMethod==='bch'}" @click="purchaseMethod='bch'">BCH</button><button :class="{active: purchaseMethod==='lift'}" @click="purchaseMethod='lift'; loadLiftQuote()">LIFT<span class="off" x-show="state?.liftDiscountPercent" x-text="'-' + state.liftDiscountPercent + '%'"></span></button></div><div class="modal-body" style="margin-top:14px"><template x-if="purchaseMethod==='bch'"><div>Price: <strong x-text="bchPriceLabel(pendingPurchase)"></strong><br><span style="font-size:11.5px;color:var(--ink-3)" x-text="state?.balance ? 'BCH balance: ' + state.balance.spendableBch + ' BCH' : 'BCH balance unavailable'"></span><template x-if="bchInsufficient()"><div style="font-size:11.5px;color:var(--err);margin-top:4px">Insufficient BCH balance — top up or pay with LIFT</div></template></div></template><template x-if="purchaseMethod==='lift'"><div><s style="color:var(--ink-3);font-size:12px" x-text="bchPriceLabel(pendingPurchase)"></s> <strong x-text="liftPriceLabel(pendingPurchase)"></strong> <span class="pill pill-active" x-show="state?.liftDiscountPercent" x-text="state.liftDiscountPercent + '% OFF'"></span><br><span style="font-size:11.5px;color:var(--ink-3)" x-text="state?.lift ? 'LIFT balance: ' + state.lift.displayBalance : 'No LIFT tokens in this wallet'"></span><template x-if="liftQuoteBusy"><div style="font-size:11.5px;color:var(--ink-3);margin-top:6px">Estimating LIFT needed…</div></template><template x-if="liftQuoteError"><div style="font-size:11.5px;color:var(--err);margin-top:6px" x-text="liftQuoteError"></div></template><template x-if="liftQuote && !liftQuoteBusy && !liftQuoteError"><div style="font-size:11.5px;margin-top:6px">LIFT needed: <strong x-text="'≈ ' + liftQuote.display + ' ' + liftQuote.symbol"></strong></div></template><template x-if="liftInsufficient()"><div style="font-size:11.5px;color:var(--err);margin-top:4px">Insufficient LIFT balance — pay with BCH or top up LIFT</div></template></div></template></div><template x-if="purchaseError"><div style="font-size:12px;color:var(--err);margin-top:10px" x-text="purchaseError"></div></template><div class="modal-actions"><button class="btn" @click="showPurchaseModal=false">Cancel</button><button class="btn btn-primary" @click="confirmPurchase()" :disabled="purchaseBusy || (purchaseMethod==='bch' && bchInsufficient()) || (purchaseMethod==='lift' && (!state?.lift || liftQuoteBusy || liftInsufficient()))" x-text="purchaseBusy ? 'Processing…' : (purchaseMethod==='lift' ? 'Pay with LIFT' : 'Pay with BCH')"></button></div></div></div>
<div class="modal-backdrop" :class="{open: showSendModal}" @click.self="showSendModal=false"><div class="modal" role="dialog" aria-modal="true"><div class="modal-title">Confirm Send</div><template x-if="pendingSend?.type === 'bch'"><div class="modal-body"><strong>Send BCH</strong><br>Address: <span class="mono-break" x-text="pendingSend?.address"></span><br>Amount: <strong><span x-text="pendingSend?.amount"></span> <span x-text="pendingSend?.currency?.toUpperCase()"></span></strong></div></template><template x-if="pendingSend?.type === 'token'"><div class="modal-body"><strong>Send Token</strong><br>Category: <span class="mono-break" x-text="pendingSend?.category?.slice(0,16) + '…'"></span><br>Amount: <strong x-text="pendingSend?.tokenAmount"></strong><br>Address: <span class="mono-break" x-text="pendingSend?.address"></span></div></template><div class="modal-actions"><button class="btn" @click="showSendModal=false">Cancel</button><button class="btn btn-primary" @click="confirmSend()" :disabled="sendConfirmBusy" x-text="sendConfirmBusy ? 'Sending…' : 'Confirm & Send'"></button></div></div></div>
<div class="modal-backdrop" :class="{open: showImageQuoteModal}" @click.self="showImageQuoteModal=false"><div class="modal" role="dialog" aria-modal="true"><div class="modal-title">Image Generation</div><div class="modal-body">Model: <strong x-text="pendingImageQuote?.model || 'default'"></strong><br>Cost: <span class="tbl-num" x-text="pendingImageQuote?.amountSats ? (pendingImageQuote.amountSats / 1e8).toFixed(8) + ' BCH' : 'calculating...'"></span><span x-show="pendingImageQuote?.amountUsd != null" x-text="pendingImageQuote?.amountUsd != null ? ' · $' + pendingImageQuote.amountUsd.toFixed(2) + ' USD' : ''"></span><br>Order: <span class="mono-break" style="color:var(--ink-3)" x-text="pendingImageQuote?.orderId || 'pending'"></span></div><div class="modal-actions"><button class="btn" @click="showImageQuoteModal=false">Cancel</button><button class="btn btn-primary" @click="confirmImageGen()" :disabled="imgGenBusy" x-text="imgGenBusy ? 'Generating…' : 'Pay & Generate'"></button></div></div></div>
<div class="lightbox" :class="{open: lightbox}" @click.self="lightbox=null" @keydown.escape.window="lightbox=null" role="dialog" aria-modal="true">
  <div class="lightbox-inner">
    <img :src="lightbox ? '/api/ai/images/' + lightbox.id + '/file?token=' + token : ''" :alt="lightbox?.path || 'Generated image'">
    <div class="lightbox-bar">
      <span class="lightbox-path" x-text="lightbox?.path || lightbox?.id || ''"></span>
      <div class="lightbox-actions">
        <button class="btn btn-sm" @click="copyText(lightbox?.path)">Copy Path</button>
        <a class="btn btn-sm" :href="lightbox ? '/api/ai/images/' + lightbox.id + '/file?token=' + token : '#'" target="_blank" rel="noopener">Open ↗</a>
        <template x-if="!lightboxConfirmDelete"><button class="btn btn-sm" style="color:var(--err)" @click="lightboxConfirmDelete=true">Delete</button></template>
        <template x-if="lightboxConfirmDelete"><span style="display:flex;gap:6px;align-items:center;font-size:11.5px;color:var(--err)">Delete?<button class="btn btn-sm btn-primary" style="background:var(--err);border-color:var(--err)" @click="deleteImage()">Yes</button><button class="btn btn-sm" @click="lightboxConfirmDelete=false">No</button></span></template>
        <button class="btn btn-sm" @click="lightboxConfirmDelete=false;lightbox=null">Close</button>
      </div>
    </div>
  </div>
</div>
<template x-if="toastVisible"><div class="toast" :class="toastOk ? 'toast-ok' : 'toast-err'" x-text="toastMsg"></div></template>
<template x-if="notify">
  <div class="tx-toast">
    <div class="t" x-text="notify.title"></div>
    <div class="a" x-text="notify.amountText"></div>
    <a :href="notify.explorer" target="_blank" rel="noopener" x-text="notify.txidShort"></a>
  </div>
</template>
</div>
<script>
var QR=(()=>{var EC_PARAMS=[[],[26,7,1],[44,10,1],[70,15,1],[100,20,1],[134,26,1],[172,18,2],[196,20,2],[242,24,2],[292,30,2],[346,18,4]];var ALIGN_POS=[[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];var BYTE_CAP=[0,17,32,53,78,106,134,154,192,230,271];var EXP=new Uint8Array(512),LOG=new Uint8Array(256);var x=1,i,j;for(i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x=(x<<1)^(x&128?0x11D:0)}for(i=255;i<512;i++)EXP[i]=EXP[i-255];function gfMul(a,b){return a&&b?EXP[LOG[a]+LOG[b]]:0}function rsEncode(data,ecLen){var gen=[1],next,coef;for(i=0;i<ecLen;i++){next=new Array(gen.length+1).fill(0);for(j=0;j<gen.length;j++){next[j]^=gen[j];next[j+1]^=gfMul(gen[j],EXP[i])}gen=next}var msg=new Array(data.length+ecLen).fill(0);for(i=0;i<data.length;i++)msg[i]=data[i];for(i=0;i<data.length;i++){coef=msg[i];if(coef!==0)for(j=1;j<gen.length;j++)msg[i+j]^=gfMul(gen[j],coef)}return msg.slice(data.length)}function selectVersion(len){for(var v=1;v<=10;v++)if(len<=BYTE_CAP[v])return v;return-1}function toUtf8Bytes(text){var bytes=[],c;for(i=0;i<text.length;i++){c=text.charCodeAt(i);if(c<128)bytes.push(c);else if(c<2048){bytes.push(192|(c>>6));bytes.push(128|(c&63))}else{bytes.push(224|(c>>12));bytes.push(128|((c>>6)&63));bytes.push(128|(c&63))}}return bytes}function encodeData(bytes,version){var params=EC_PARAMS[version],total=params[0],ecPerBlock=params[1],numBlocks=params[2];var dataTotal=total-ecPerBlock*numBlocks,countBits=version<=9?8:16;var bits=[0,1,0,0],totalBits=dataTotal*8;for(i=countBits-1;i>=0;i--)bits.push((bytes.length>>i)&1);for(var k=0;k<bytes.length;k++){c=bytes[k];for(i=7;i>=0;i--)bits.push((c>>i)&1)}for(i=0;i<4&&bits.length<totalBits;i++)bits.push(0);while(bits.length%8)bits.push(0);var padByte=0;while(bits.length<totalBits){var pb=(padByte%2===0)?0xEC:0x11;for(i=7;i>=0&&bits.length<totalBits;i--)bits.push((pb>>i)&1);padByte++}var codewords=[];for(i=0;i<bits.length;i+=8){var v=0;for(j=0;j<8;j++)v=(v<<1)|(bits[i+j]||0);codewords.push(v)}return codewords}function buildAndInterleave(codewords,version){var params=EC_PARAMS[version],total=params[0],ecPerBlock=params[1],numBlocks=params[2];var dataTotal=total-ecPerBlock*numBlocks,dataPerBlock=Math.floor(dataTotal/numBlocks);var longBlocks=dataTotal-dataPerBlock*numBlocks,blocks=[],off=0,result=[],bi,bj;for(bi=0;bi<numBlocks;bi++){var len=dataPerBlock+(bi>=numBlocks-longBlocks?1:0);var data=codewords.slice(off,off+len);off+=len;blocks.push({data:data,ec:rsEncode(data,ecPerBlock)})}var maxData=Math.max.apply(null,blocks.map(function(b){return b.data.length}));for(bi=0;bi<maxData;bi++)for(bj=0;bj<blocks.length;bj++)if(bi<blocks[bj].data.length)result.push(blocks[bj].data[bi]);for(bi=0;bi<ecPerBlock;bi++)for(bj=0;bj<blocks.length;bj++)if(bi<blocks[bj].ec.length)result.push(blocks[bj].ec[bi]);return result}function createMatrix(version){var size=version*4+17;var mod=[],res=[];for(i=0;i<size;i++){mod.push(new Int8Array(size));res.push(new Uint8Array(size))}return{size:size,mod:mod,res:res}}function placeFinder(m,r0,c0){var mr,mc,dark;for(var r=-1;r<=7;r++)for(var c=-1;c<=7;c++){mr=r0+r;mc=c0+c;if(mr<0||mr>=m.size||mc<0||mc>=m.size)continue;dark=(r>=0&&r<=6&&(c===0||c===6))||(c>=0&&c<=6&&(r===0||r===6))||(r>=2&&r<=4&&c>=2&&c<=4);m.mod[mr][mc]=dark?1:-1;m.res[mr][mc]=1}}function placeAlignment(m,cr,cc){var dark;for(var r=-2;r<=2;r++)for(var c=-2;c<=2;c++){dark=Math.abs(r)===2||Math.abs(c)===2||(r===0&&c===0);m.mod[cr+r][cc+c]=dark?1:-1;m.res[cr+r][cc+c]=1}}function placeAll(m,version){placeFinder(m,0,0);placeFinder(m,0,m.size-7);placeFinder(m,m.size-7,0);var v;for(i=8;i<m.size-8;i++){v=(i&1)?-1:1;if(!m.res[6][i]){m.mod[6][i]=v;m.res[6][i]=1}if(!m.res[i][6]){m.mod[i][6]=v;m.res[i][6]=1}}var ap=ALIGN_POS[version];if(ap.length)for(var ai=0;ai<ap.length;ai++)for(var aj=0;aj<ap.length;aj++){if((ai===0&&aj===0)||(ai===0&&aj===ap.length-1)||(ai===ap.length-1&&aj===0))continue;placeAlignment(m,ap[ai],ap[aj])}m.mod[m.size-8][8]=1;m.res[m.size-8][8]=1;for(i=0;i<=8;i++){m.res[8][i]=1;m.res[i][8]=1}for(i=0;i<=7;i++){m.res[8][m.size-1-i]=1;m.res[m.size-1-i][8]=1}if(version>=7){for(i=0;i<18;i++){var vr=Math.floor(i/3),vc=i%3;m.res[vr][m.size-11+vc]=1;m.res[m.size-11+vc][vr]=1}placeVersionInfo(m,version)}}function placeData(m,data){var bits=[],idx=0,up=true,row,c,dc;for(i=0;i<data.length;i++){var b=data[i];for(j=7;j>=0;j--)bits.push((b>>j)&1)}for(var col=m.size-1;col>=0;col-=2){if(col===6)col--;for(i=0;i<m.size;i++){row=up?m.size-1-i:i;for(dc=0;dc<=1;dc++){c=col-dc;if(c>=0&&c<m.size&&!m.res[row][c]){m.mod[row][c]=idx<bits.length?bits[idx]:0;idx++}}}up=!up}}function applyMask(m,mask){var out=[],flip;for(i=0;i<m.size;i++){out.push(new Int8Array(m.mod[i]))}for(var r=0;r<m.size;r++)for(var c=0;c<m.size;c++){if(m.res[r][c])continue;flip=false;if(mask===0)flip=(r+c)%2===0;else if(mask===1)flip=r%2===0;else if(mask===2)flip=c%3===0;else if(mask===3)flip=(r+c)%3===0;else if(mask===4)flip=(Math.floor(r/2)+Math.floor(c/3))%2===0;else if(mask===5)flip=(r*c)%2+(r*c)%3===0;else if(mask===6)flip=((r*c)%2+(r*c)%3)%2===0;else flip=((r+c)%2+(r*c)%3)%2===0;if(flip)out[r][c]=out[r][c]?0:1}return out}function computeFormatBits(mask){var data=(1<<3)|mask,rem=data<<10;for(i=4;i>=0;i--)if(rem&(1<<(i+10)))rem^=0x537<<i;return((data<<10)|rem)^0x5412}function computeVersionBits(version){var data=version,rem=data<<12;for(i=5;i>=0;i--)if(rem&(1<<(i+12)))rem^=0x1F25<<i;return(data<<12)|rem}function placeVersionInfo(m,version){var bits=computeVersionBits(version);for(i=0;i<18;i++){var b=(bits>>i)&1,r=Math.floor(i/3),c=i%3;m.mod[r][m.size-11+c]=b;m.mod[m.size-11+c][r]=b}}function placeFormat(mod,size,mask){var fmt=computeFormatBits(mask);var p1=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];var p2=[[size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]];for(i=0;i<15;i++){var b=(fmt>>(14-i))&1;mod[p1[i][0]][p1[i][1]]=b;mod[p2[i][0]][p2[i][1]]=b}}function penalty(mod,size){var score=0,run,v,dark=0;for(var r=0;r<size;r++){run=1;for(var c=1;c<size;c++){if(mod[r][c]===mod[r][c-1])run++;else{if(run>=5)score+=run-2;run=1}}if(run>=5)score+=run-2}for(var c2=0;c2<size;c2++){run=1;for(var r2=1;r2<size;r2++){if(mod[r2][c2]===mod[r2-1][c2])run++;else{if(run>=5)score+=run-2;run=1}}if(run>=5)score+=run-2}for(r=0;r<size-1;r++)for(c2=0;c2<size-1;c2++){v=mod[r][c2];if(v===mod[r][c2+1]&&v===mod[r+1][c2]&&v===mod[r+1][c2+1])score+=3}for(r=0;r<size;r++)for(c2=0;c2<=size-7;c2++){if(mod[r][c2]===1&&mod[r][c2+1]===0&&mod[r][c2+2]===1&&mod[r][c2+3]===1&&mod[r][c2+4]===1&&mod[r][c2+5]===0&&mod[r][c2+6]===1)score+=40}for(c2=0;c2<size;c2++)for(r=0;r<=size-7;r++){if(mod[r][c2]===1&&mod[r+1][c2]===0&&mod[r+2][c2]===1&&mod[r+3][c2]===1&&mod[r+4][c2]===1&&mod[r+5][c2]===0&&mod[r+6][c2]===1)score+=40}for(r=0;r<size;r++)for(c2=0;c2<size;c2++)if(mod[r][c2]===1)dark++;var pct=dark*100/(size*size),p5=Math.floor(pct/5)*5;score+=Math.min(Math.abs(p5-50),Math.abs(p5+5-50))/5*10;return score}function encode(text){var bytes=toUtf8Bytes(text),version=selectVersion(bytes.length);if(version<0)throw new Error('Text too long for QR code');var cw=encodeData(bytes,version),interleaved=buildAndInterleave(cw,version);var m=createMatrix(version);placeAll(m,version);placeData(m,interleaved);var bestMask=0,bestScore=Infinity;for(var mask=0;mask<8;mask++){var masked=applyMask(m,mask);placeFormat(masked,m.size,mask);var s=penalty(masked,m.size);if(s<bestScore){bestScore=s;bestMask=mask}}var final_=applyMask(m,bestMask);placeFormat(final_,m.size,bestMask);return{matrix:final_,size:m.size}}function toSVG(qr,ms){ms=ms||4;var off=ms*4,d='';for(var r=0;r<qr.size;r++)for(var c=0;c<qr.size;c++)if(qr.matrix[r][c]===1)d+='M'+(c*ms+off)+','+(r*ms+off)+'h'+ms+'v'+ms+'h'+(-ms)+'z';var dim=(qr.size+8)*ms;return'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+dim+' '+dim+'" width="'+dim+'" height="'+dim+'"><rect width="100%" height="100%" fill="#fff" rx="8"/><path d="'+d+'" fill="#000"/></svg>'}return{encode:encode,toSVG:toSVG}})();
</script>
<script>
document.addEventListener('alpine:init',function(){Alpine.data('app',function(){return{
token:new URLSearchParams(window.location.search).get('token')||'',theme:localStorage.getItem('pt-theme')||'light',tab:'wallet',state:null,
rcvType:'bch',rcvCategory:'',rcvAmount:'',rcvView:null,rcvQrSvg:'',
sendType:'bch',sendAmount:'',sendCurrency:'bch',sendAddress:'',sendCategory:'',sendTokenPreset:'__custom__',sendTokenAmount:'',sendError:'',sendSuccess:'',pendingSend:null,
histType:'all',histRecords:[],histPage:1,histNumPages:1,histHasNext:false,histLoading:false,histNetwork:'mainnet',
swapTokens:[{symbol:'LIFT',category:'5932b2fd4915d6a75d3ec53282cd49118149a2176ee67ed68b1111ff0786f7fc'},{symbol:'PUSD',category:'2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544'}],swapToken:'5932b2fd4915d6a75d3ec53282cd49118149a2176ee67ed68b1111ff0786f7fc',swapCustomCategory:'',swapDir:'sell',swapAmount:'',swapError:'',swapQuoteText:'',swapBusy:false,swapExecBusy:false,pendingSwap:null,
pendingPurchase:null,purchaseBusy:false,purchaseMethod:'bch',purchaseError:'',liftQuote:null,liftQuoteBusy:false,liftQuoteError:'',showPurchaseModal:false,showSendModal:false,sendConfirmBusy:false,
pendingImageQuote:null,showImageQuoteModal:false,imgGenBusy:false,imgQuoteBusy:false,walletAction:null,aiAction:null,lightbox:null,lightboxConfirmDelete:false,
refillModel:'',refillMinutes:'30',refillMax:'',refillPayMethod:'bch',refillEditing:false,refillNotice:'',
imgPrompt:'',imgModel:'bytedance-seed/seedream-5-0-pro',imgAspect:'1:1',imgQuality:'auto',
toastVisible:false,toastMsg:'',toastOk:true,
ws:null,wsStatus:'connecting',wsAddress:null,wsSeen:{},wsReconnectTimer:null,wsPingTimer:null,wsRefreshTimer:null,wsLateTimer:null,notify:null,_ntid:0,
async init(){document.documentElement.setAttribute('data-theme',this.theme);try{this.state=await this.api('GET','/api/wallet/state');this.loadHistory(1);await this.onRcvChange();this.connectWatch()}catch(e){this.toast(e.message,true)}var self=this;document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&self.state){if(!self.ws||self.ws.readyState!==1){if(self.wsReconnectTimer)clearTimeout(self.wsReconnectTimer);self.connectWatch()}}});window.addEventListener('online',function(){if(self.state){if(self.wsReconnectTimer)clearTimeout(self.wsReconnectTimer);self.connectWatch()}})},
async load(){try{this.state=await this.api('GET','/api/wallet/state');this.onRcvChange();this.loadHistory(this.histPage)}catch(e){this.toast(e.message,true)}},
async api(method,apipath,body){var opts={method:method,headers:{'X-Paytaca-Token':this.token,'Accept':'application/json'}};if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body)}var res=await fetch(apipath,opts);if(!res.ok){var msg='Request failed ('+res.status+')';try{var j=await res.json();if(j.error)msg=j.error}catch(ex){}throw new Error(msg)}return res.json()},
fmtDuration(s){if(!s||s<=0)return '0m';var h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?h+'h '+m+'m':m+'m'},
bchPriceLabel(p){if(!p)return '';return p.priceUsd!=null?'$'+p.priceUsd.toFixed(2)+' USD':((p.priceSats||0)/1e8).toFixed(8)+' BCH'},
liftPriceLabel(p){if(!p)return '';var pct=(this.state&&this.state.liftDiscountPercent)||0;var f=1-pct/100;return p.priceUsd!=null?'$'+(p.priceUsd*f).toFixed(2)+' USD':(((p.priceSats||0)*f)/1e8).toFixed(8)+' BCH'},

async loadLiftQuote(){var p=this.pendingPurchase;if(!p||!p.priceSats){this.liftQuote=null;this.liftQuoteError='';return}var pct=(this.state&&this.state.liftDiscountPercent)||0;var sats=Math.round(p.priceSats*(1-pct/100));if(sats<1)sats=1;this.liftQuoteBusy=true;this.liftQuoteError='';try{this.liftQuote=await this.api('GET','/api/ai/lift-quote?sats='+sats)}catch(e){this.liftQuote=null;this.liftQuoteError=e.message||'Failed to estimate LIFT needed'}this.liftQuoteBusy=false},

liftInsufficient(){if(!this.liftQuote||!this.state||!this.state.lift)return false;return Number(this.state.lift.rawBalance)<Number(this.liftQuote.rawAmount)},
bchInsufficient(){if(!this.pendingPurchase)return false;var have=this.state&&this.state.balance?Number(this.state.balance.spendableSats):0;return have<Number(this.pendingPurchase.priceSats||0)},
activeCreditsTotal(state){if(!state?.usage)return 0;return state.usage.reduce(function(sum,s){return s.active?sum+(s.remainingSeconds||0):sum},0)},
activeCreditsCount(state){if(!state?.usage)return 0;return state.usage.filter(function(s){return s.active}).length},
isTokenAddr(addr){return addr&&/^bitcoincash:z/.test(addr)},
toast(msg,isErr){this.toastMsg=msg;this.toastOk=!isErr;this.toastVisible=true;var self=this;setTimeout(function(){self.toastVisible=false},3000)},
toggleTheme(){this.theme=this.theme==='dark'?'light':'dark';localStorage.setItem('pt-theme',this.theme);document.documentElement.setAttribute('data-theme',this.theme)},
copyText(text){if(text){navigator.clipboard.writeText(text);this.toast('Copied!')}},
connectWatch(addr){if(!this.state)return;var address=addr||this.rcvView?.address||this.wsAddress;if(!address)return;if(this.ws&&this.wsAddress===address&&(this.ws.readyState===0||this.ws.readyState===1))return;var self=this;var host=this.state.network==='chipnet'?'wss://chipnet.watchtower.cash':'wss://watchtower.cash';this.wsStatus='connecting';this.wsAddress=address;if(this.ws){this.ws.onclose=null;try{this.ws.close()}catch(e){};this.ws=null}try{this.ws=new WebSocket(host+'/ws/watch/bch/'+address+'/')}catch(e){console.debug('[ws] ctor error',e);this.wsStatus='off';return}this.ws.onopen=function(){console.debug('[ws] open');self.wsStatus='live';self.startWsPing()};this.ws.onmessage=function(ev){var m=null;try{m=JSON.parse(ev.data)}catch(e){return}self.handleWsUpdate(m)};this.ws.onclose=function(ev){console.debug('[ws] close',ev.code,ev.reason||'');if(self.wsPingTimer)clearTimeout(self.wsPingTimer);if(self.wsAddress!==address)return;self.wsStatus='off';if(self.wsReconnectTimer)clearTimeout(self.wsReconnectTimer);self.wsReconnectTimer=setTimeout(function(){if(self.state)self.connectWatch()},3000)};this.ws.onerror=function(){console.debug('[ws] error')}},
startWsPing(){var self=this;if(this.wsPingTimer)clearTimeout(this.wsPingTimer);this.wsPingTimer=setTimeout(function(){if(self.ws&&self.ws.readyState===1){try{self.ws.send('ping')}catch(e){}self.startWsPing()}},30000)},
handleWsUpdate(m){if(!m||!m.txid)return;var key=m.txid+'|'+(m.address||'')+'|'+(m.index==null?'':m.index);if(this.wsSeen[key])return;this.wsSeen[key]=1;if(Object.keys(this.wsSeen).length>400)this.wsSeen={};this.showTxToast(m,Array.isArray(m.senders)&&m.senders.length>0)},
showTxToast(m,incoming){var self=this;var sym=(m.token_symbol||'').toLowerCase();var tname=(m.token_name||'').toLowerCase();var isBch=!m.token_symbol||sym==='bch'||tname==='bch'||tname==='bitcoin cash'||m.token==='bch';var amountText;if(isBch){var sats=m.value!=null?Number(m.value):null;var bch=sats!=null&&isFinite(sats)?sats/1e8:null;amountText=bch!=null?bch.toFixed(8).replace(/\.?0+$/,'')+' BCH':'New activity';if(bch!=null&&this.state&&this.state.bchPriceUsd){var usd=bch*this.state.bchPriceUsd;if(usd>0.0001){var usdStr=usd.toFixed(2);if(usdStr.slice(-3)==='.00')usdStr=usdStr.slice(0,-3);amountText+=' ('+usdStr+' USD)'}}}else{amountText=m.amount!=null?(m.amount+' '+m.token_symbol):(m.token_symbol||'Token')+' transfer'}var base=this.state&&this.state.network==='chipnet'?'https://chipnet.bchexplorer.info/tx/':'https://bchexplorer.info/tx/';var id=m.txid||'';var tid=++self._ntid;var n={title:incoming?'Incoming transaction':'Wallet activity',amountText:amountText,txidShort:id.slice(0,10)+'…'+id.slice(-6),explorer:base+id};this.notify=n;if(this.wsRefreshTimer)clearTimeout(this.wsRefreshTimer);this.wsRefreshTimer=setTimeout(function(){self.load()},1200);if(this.wsLateTimer)clearTimeout(this.wsLateTimer);this.wsLateTimer=setTimeout(function(){self.load()},5000);setTimeout(function(){if(self._ntid===tid)self.notify=null},6000)},
async onRcvChange(){this.rcvView=null;this.rcvQrSvg='';var params=new URLSearchParams();if(this.rcvType==='token'&&this.rcvCategory){params.set('category',this.rcvCategory);params.set('token','1')}if(this.rcvAmount)params.set('amount',this.rcvAmount);try{var view=await this.api('GET','/api/wallet/receive?'+params.toString());this.rcvView=view;if(view.address){try{this.rcvQrSvg=QR.toSVG(QR.encode(view.address))}catch(ex){}}if(view&&view.address&&this.wsAddress!==view.address)this.connectWatch(view.address)}catch(e){this.rcvView={address:'Error: '+e.message}}},
doSend(){this.sendError='';this.sendSuccess='';var address=(this.sendAddress||'').trim();if(!address){this.sendError='Enter a recipient address';return}if(this.sendType==='bch'){var amount=parseFloat(this.sendAmount);var currency=this.sendCurrency;if(!amount||amount<=0){this.sendError='Enter a valid amount';return}this.pendingSend={type:'bch',address:address,amount:amount,currency:currency};this.showSendModal=true}else{var category=(this.sendCategory||'').trim();var tokenAmount=(this.sendTokenAmount||'').trim();if(!category||!/^[a-fA-F0-9]{64}$/.test(category)){this.sendError='Enter a valid 64-char hex category ID';return}if(!tokenAmount){this.sendError='Enter a token amount';return}this.pendingSend={type:'token',category:category,tokenAmount:tokenAmount,address:address};this.showSendModal=true}},
async confirmSend(){if(!this.pendingSend)return;this.sendConfirmBusy=true;try{var result;if(this.pendingSend.type==='bch'){result=await this.api('POST','/api/wallet/send',this.pendingSend)}else{result=await this.api('POST','/api/wallet/send-token',{category:this.pendingSend.category,amount:this.pendingSend.tokenAmount,address:this.pendingSend.address})}this.showSendModal=false;if(result.success){this.sendSuccess='Sent! TX: '+(result.txid||'').slice(0,16)+'...';this.toast('Transaction sent');this.load()}else{this.sendError=result.error||'Send failed'}}catch(e){this.sendError=e.message}this.sendConfirmBusy=false;this.pendingSend=null},
async loadHistory(page){this.histPage=page||1;this.histLoading=true;this.histRecords=[];try{var data=await this.api('GET','/api/wallet/history?page='+this.histPage+'&type='+this.histType);var net=data.network||'mainnet';this.histNetwork=net;var base=net==='chipnet'?'https://chipnet.bchexplorer.info/tx/':'https://bchexplorer.info/tx/';this.histRecords=(data.records||[]).map(function(r){var isIn=r.record_type==='incoming';var party=isIn?((r.senders&&r.senders[0]&&r.senders[0][0])||''):((r.recipients&&r.recipients[0]&&r.recipients[0][0])||'');var amt=Number(r.amount)||0;var when=r.tx_timestamp||r.date_created||'';var dt=when?new Date(when):null;return{txid:r.txid,type:isIn?'incoming':'outgoing',dateText:dt?dt.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'',counterparty:party,partyShort:party?(party.slice(0,16)+'…'+party.slice(-6)):'—',amount:amt,amountText:amt.toFixed(8),usd:r.usd_price!=null?(amt*Number(r.usd_price)).toFixed(2):null,fee:r.tx_fee!=null?(Number(r.tx_fee)/1e8).toFixed(8):null,explorer:r.txid?base+r.txid:''}});this.histNumPages=data.numPages||1;this.histHasNext=!!data.hasNext}catch(e){this.histRecords=[]}this.histLoading=false},
async doSwapQuote(){var tokenId=this.swapToken==='__custom__'?(this.swapCustomCategory||'').trim():(this.swapToken||'').trim();var amount=(this.swapAmount||'').trim();this.swapError='';if(!tokenId||!/^[a-fA-F0-9]{64}$/.test(tokenId)){this.swapError='Enter a valid 64-char hex token ID';return}if(!amount||isNaN(parseFloat(amount))||parseFloat(amount)<=0){this.swapError='Enter a valid amount';return}this.swapBusy=true;try{var q=await this.api('POST','/api/swap/quote',{tokenId:tokenId,direction:this.swapDir,amount:amount});this.pendingSwap={tokenId:tokenId,direction:this.swapDir,amount:amount};var text=q.formatted||'';if(!text){text='Rate: '+(q.rate||'?')+'\\nToken: '+q.tokenAmount+' '+(q.symbol||'')+'\\nBCH: '+(Number(q.bchAmountSats)/1e8).toFixed(8)+' BCH\\nTrade fee: '+(Number(q.tradeFeeSats)/1e8).toFixed(8)+' BCH';if(q.platformFeeSats)text+='\\nPlatform fee: '+(Number(q.platformFeeSats)/1e8).toFixed(8)+' BCH'}this.swapQuoteText=text}catch(e){this.swapError=e.message}this.swapBusy=false},
async doSwapExecute(){if(!this.pendingSwap)return;this.swapExecBusy=true;try{var result=await this.api('POST','/api/swap/execute',this.pendingSwap);if(result.success){this.toast('Swap executed! TX: '+(result.txid||'').slice(0,16)+'...');this.swapQuoteText='';this.pendingSwap=null;this.load()}else{this.swapError=result.error||'Swap failed'}}catch(e){this.swapError=e.message}this.swapExecBusy=false},
startPurchase(model,minutes,priceUsd,priceSats,durationDisplay,displayName){this.pendingPurchase={model:model,minutes:minutes,priceUsd:priceUsd,priceSats:priceSats,durationDisplay:durationDisplay,displayName:displayName};this.purchaseMethod='bch';this.purchaseError='';this.liftQuote=null;this.liftQuoteError='';this.showPurchaseModal=true},
async confirmPurchase(){if(!this.pendingPurchase)return;this.purchaseBusy=true;this.purchaseError='';try{var r=await this.api('POST','/api/ai/purchase',{model:this.pendingPurchase.model,minutes:this.pendingPurchase.minutes,method:this.purchaseMethod});if(r&&r.success&&r.paid){this.showPurchaseModal=false;this.pendingPurchase=null;this.toast('Plan purchased!');this.load()}else if(r&&r.success&&!r.paid){this.showPurchaseModal=false;this.pendingPurchase=null;this.toast(r.error||'Payment submitted — credits will update shortly',true);this.load()}else{this.purchaseError=(r&&r.error)||'Purchase failed';this.toast(this.purchaseError,true)}}catch(e){this.purchaseError=e.message||'Purchase failed';this.toast(e.message,true)}this.purchaseBusy=false},
async enableRefill(){var model=this.refillModel;var minutes=parseInt(this.refillMinutes)||30;var paymentMethod=this.refillPayMethod||'bch';var maxMinutes;if(!model){this.toast('Select a model',true);return}if(this.refillMax!==''&&this.refillMax!=null){var raw=Number(this.refillMax);if(!Number.isInteger(raw)||raw<=0){this.toast('Budget cap must be a whole number',true);return}if(raw<minutes*2){this.toast('Budget cap must be at least twice the top-up ('+minutes*2+' min)',true);return}if(raw%minutes!==0){this.toast('Budget cap must be a multiple of the top-up ('+minutes+' min)',true);return}maxMinutes=raw}try{var r=await this.api('POST','/api/ai/auto-refill',{enabled:true,model:model,minutes:minutes,maxMinutes:maxMinutes,paymentMethod:paymentMethod});this.refillNotice=this.refillNoticeText(r&&r.initialTick);this.refillEditing=false;this.toast('Auto-refill enabled');this.load()}catch(e){this.toast(e.message,true)}},
async resumeRefill(){try{var r=await this.api('POST','/api/ai/auto-refill',{enabled:true});this.refillNotice=this.refillNoticeText(r&&r.initialTick);this.toast('Auto-refill resumed');this.load()}catch(e){this.toast(e.message,true)}},
async pauseRefill(){try{await this.api('POST','/api/ai/auto-refill',{enabled:false});this.refillNotice='';this.toast('Auto-refill paused');this.load()}catch(e){this.toast(e.message,true)}},
startRefillEdit(){if(!this.state||!this.state.autoRefill)return;this.refillModel=this.state.autoRefill.model||'';this.refillMinutes=String(this.state.autoRefill.minutes||30);this.refillMax=this.state.autoRefill.maxMinutes?String(this.state.autoRefill.maxMinutes):'';this.refillPayMethod=this.state.autoRefill.paymentMethod||'bch';this.refillNotice='';this.refillEditing=true},
cancelRefillEdit(){this.refillEditing=false;this.refillNotice=''},
refillNoticeText(tick){if(!tick)return '';if(tick.action==='refilled'){var m=(tick.state&&tick.state.minutes)||'';var tx=tick.state&&tick.state.lastRefillTxid;return 'Topped up '+m+' min now'+(tx?' (tx '+String(tx).slice(0,10)+'…)':'')+'.'}if(tick.action==='skipped')return 'Refill skipped: '+tick.reason+'.';if(tick.action==='disarmed')return 'Auto-refill stopped: '+tick.reason+'.';return 'Credits still active — no refill needed.'},
async deleteRefill(){if(!confirm('Delete auto-refill configuration?'))return;try{await this.api('POST','/api/ai/auto-refill',{delete:true});this.refillEditing=false;this.refillNotice='';this.toast('Auto-refill deleted');this.load()}catch(e){this.toast(e.message,true)}},
async doImageQuote(){var prompt=(this.imgPrompt||'').trim();if(!prompt){this.toast('Enter a prompt',true);return}this.imgQuoteBusy=true;try{var quote=await this.api('POST','/api/ai/images/quote',{prompt:prompt,model:this.imgModel||undefined,aspectRatio:this.imgAspect,quality:this.imgQuality});this.pendingImageQuote=quote;this.showImageQuoteModal=true}catch(e){this.toast(e.message,true)}this.imgQuoteBusy=false},
async confirmImageGen(){if(!this.pendingImageQuote)return;this.imgGenBusy=true;try{var orderId=this.pendingImageQuote.orderId;var result=await this.api('POST','/api/ai/images/fulfill',{orderId:orderId});this.showImageQuoteModal=false;this.aiAction='images';if(result&&result.path){this.lightbox={id:orderId,path:result.path};this.toast('Image saved to ~/.paytaca/images')}else{this.toast((result&&result.error)||(result&&result.paid?'Payment received — image will appear in your gallery':'Image generation failed'),true)}this.load()}catch(e){this.toast(e.message,true)}this.imgGenBusy=false;this.pendingImageQuote=null},
openImage(h){this.lightbox={id:h.id,path:h.filepath||('~/paytaca/images/'+h.id)};this.lightboxConfirmDelete=false},
async deleteImage(){if(!this.lightbox)return;var id=this.lightbox.id;try{await this.api('DELETE','/api/ai/images/'+id);this.lightbox=null;this.lightboxConfirmDelete=false;this.toast('Image deleted');this.load()}catch(e){this.toast(e.message,true);this.lightboxConfirmDelete=false}},
imgCaption(h){var t=h.prompt||h.model_display_name||h.model||h.id||'';return t.length>48?t.slice(0,48)+'…':t}
}})});
</script>
<script defer>${ALPINE_JS}</script>
</body>
</html>`;
}
