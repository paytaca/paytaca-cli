import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --sans:'Space Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:'JetBrains Mono',ui-monospace,'SF Mono','Cascadia Code',monospace;
  --bg:oklch(98.4% 0.003 250);
  --surface:oklch(100% 0 0);
  --surface-2:oklch(97.2% 0.004 250);
  --ink:oklch(22% 0.02 258);
  --ink-2:oklch(46% 0.016 258);
  --ink-3:oklch(60% 0.012 258);
  --line:oklch(89.5% 0.006 258);
  --line-2:oklch(93.5% 0.005 258);
  --accent:oklch(58% 0.16 152);
  --accent-strong:oklch(47% 0.14 152);
  --accent-soft:oklch(95% 0.05 152);
  --ok:oklch(55% 0.14 150);
  --ok-soft:oklch(95% 0.04 150);
  --warn:oklch(54% 0.13 70);
  --warn-soft:oklch(95.5% 0.06 82);
  --err:oklch(55% 0.2 25);
  --err-soft:oklch(95.5% 0.045 25);
  --grid:oklch(88% 0.006 258 / 0.65);
  --r:5px;--r-sm:4px;
  --shadow:0 1px 2px oklch(25% 0.02 258 / 0.04);
}
[data-theme="dark"]{
  --bg:oklch(15% 0.012 258);
  --surface:oklch(18% 0.012 258);
  --surface-2:oklch(21% 0.014 258);
  --ink:oklch(93% 0.005 250);
  --ink-2:oklch(78% 0.01 250);
  --ink-3:oklch(58% 0.01 250);
  --line:oklch(27% 0.012 258);
  --line-2:oklch(23% 0.01 258);
  --accent:oklch(65% 0.16 152);
  --accent-strong:oklch(72% 0.14 152);
  --accent-soft:oklch(28% 0.06 152);
  --ok:oklch(65% 0.14 150);
  --ok-soft:oklch(26% 0.05 150);
  --warn:oklch(72% 0.13 70);
  --warn-soft:oklch(28% 0.06 70);
  --err:oklch(65% 0.2 25);
  --err-soft:oklch(28% 0.06 25);
  --grid:oklch(22% 0.01 258 / 0.45);
  --shadow:0 1px 3px oklch(5% 0.02 258 / 0.3);
}
[x-cloak]{display:none!important}
body{font-family:var(--sans);background-color:var(--bg);background-image:radial-gradient(var(--grid) 1px,transparent 1px);background-size:22px 22px;color:var(--ink);font-size:14px;line-height:1.55;min-height:100dvh;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
::selection{background:var(--accent);color:#fff}
.mono-break{font-family:var(--mono);font-size:11.5px;word-break:break-all}
.shell{display:flex;align-items:stretch;min-height:100dvh}
.sidebar{position:sticky;top:0;flex:none;width:236px;height:100dvh;display:flex;flex-direction:column;background:var(--surface);border-right:1px solid var(--line);z-index:40}
.brand{display:flex;align-items:center;gap:10px;padding:20px 18px;border-bottom:1px solid var(--line-2)}
.brand-mark{position:relative;width:22px;height:22px;flex:none;border:1.5px solid var(--ink);border-radius:3px}
.brand-mark::after{content:'';position:absolute;inset:5px;background:var(--accent);border-radius:1px}
.brand-name{font-size:16px;font-weight:700;letter-spacing:-0.02em}
.nav{flex:1;display:flex;flex-direction:column;gap:2px;padding:14px 12px}
.nav-label{font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-3);padding:6px 10px 8px}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:var(--r-sm);font-size:13.5px;font-weight:500;color:var(--ink-2);cursor:pointer;user-select:none;transition:background .12s ease-out,color .12s ease-out}
.nav-item:hover{background:var(--surface-2);color:var(--ink)}
.nav-item.active{background:var(--ink);color:var(--surface)}
.nav-item .idx{font-family:var(--mono);font-size:10px;color:var(--ink-3)}
.nav-item.active .idx{color:oklch(75% 0.01 250)}
.sidebar-foot{display:flex;flex-direction:column;gap:10px;padding:16px 18px;border-top:1px solid var(--line-2)}
.net{display:flex;align-items:center;gap:9px;font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:0.1em;color:var(--ink-2)}
.dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.dot.chipnet{background:var(--warn);box-shadow:0 0 0 3px var(--warn-soft)}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 30px;background:color-mix(in oklch,var(--bg) 86%,transparent);backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);border-bottom:1px solid var(--line)}
.page-title{display:flex;align-items:baseline;gap:12px;font-size:15px;font-weight:600;letter-spacing:-0.01em}
.page-title .path{font-family:var(--mono);font-size:11px;font-weight:400;color:var(--ink-3)}
.topbar-actions{display:flex;align-items:center;gap:10px}
.content{width:100%;max-width:1400px;margin:0 auto;padding:26px 30px 56px}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
.span-4{grid-column:span 4}.span-5{grid-column:span 5}.span-6{grid-column:span 6}.span-7{grid-column:span 7}.span-8{grid-column:span 8}.span-12{grid-column:span 12}
.grid>div{display:flex;flex-direction:column}.grid>div>.card{flex:1}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:20px;box-shadow:var(--shadow)}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.card-title{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:0.13em;text-transform:uppercase;color:var(--ink-2)}
.balance-card{position:relative;overflow:hidden;background:var(--ink);border-color:var(--ink);color:oklch(98% 0.005 250)}
[data-theme="dark"] .balance-card{background:oklch(22% 0.015 258);border-color:oklch(22% 0.015 258)}
.balance-card::after{content:'';position:absolute;top:-70px;right:-70px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,color-mix(in oklch,var(--accent) 55%,transparent),transparent 68%);opacity:.55;pointer-events:none}
.balance-card .label{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:oklch(74% 0.012 250);margin-bottom:14px}
.balance-card .value{display:flex;align-items:baseline;gap:9px;font-size:clamp(30px,3.4vw,42px);font-weight:700;letter-spacing:-0.035em;line-height:1;font-variant-numeric:tabular-nums}
.balance-card .value .unit{font-size:14px;font-weight:500;letter-spacing:0;color:oklch(74% 0.012 250)}
.balance-card .sub{font-family:var(--mono);font-size:11.5px;color:oklch(72% 0.012 250);margin-top:12px;min-height:18px}
.lift-card .value{font-size:26px;font-weight:700;letter-spacing:-0.03em;line-height:1.1;font-variant-numeric:tabular-nums}
.lift-card .sub{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:var(--ink-3);margin-top:8px}
.metric{padding:8px 0 2px}
.metric-value{font-size:clamp(30px,3vw,38px);font-weight:700;letter-spacing:-0.035em;line-height:1;color:var(--accent-strong);font-variant-numeric:tabular-nums}
.metric-label{font-family:var(--mono);font-size:10.5px;letter-spacing:0.04em;color:var(--ink-3);margin-top:12px}
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
.segmented-opt{flex:1;padding:7px 8px;text-align:center;font-size:12.5px;font-weight:500;color:var(--ink-3);border-radius:3px;cursor:pointer;user-select:none;transition:background .12s ease-out,color .12s ease-out}
.segmented-opt:hover{color:var(--ink-2)}
.segmented-opt.active{background:var(--surface);color:var(--ink);box-shadow:0 1px 2px oklch(25% 0.02 258 / 0.07)}
.inline-row{display:flex;gap:8px}
.inline-row>*{flex:1;min-width:0}
.inline-row .shrink{flex:none}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:10px 16px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);color:var(--ink);font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .12s ease-out,border-color .12s ease-out,transform .06s ease-out}
.btn:hover{border-color:var(--ink-3);background:var(--surface-2)}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-strong);border-color:var(--accent-strong)}
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
.hist-date a:hover{color:var(--accent-strong);border-bottom-color:var(--accent)}
.hist-addr{max-width:210px}
.hist-sub{font-family:var(--mono);font-size:10px;color:var(--ink-3);margin-top:2px}
.hist-amt{font-family:var(--mono);font-size:12px;font-variant-numeric:tabular-nums}
.hist-in{color:var(--accent-strong)}
.hist-out{color:var(--ink)}
.pill{display:inline-flex;align-items:center;padding:2px 7px;border-radius:2px;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:0.06em}
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
.subnav{display:flex;gap:2px;border-bottom:1px solid var(--line);margin-bottom:18px}
.subnav button{appearance:none;background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:10px 16px 12px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:0.12em;color:var(--ink-3);cursor:pointer}
.subnav button:hover{color:var(--ink-2)}
.subnav button.active{color:var(--ink);border-bottom-color:var(--accent)}
.subnav .idx{margin-right:8px;color:var(--ink-3)}
.subnav button.active .idx{color:var(--accent)}
.plan-group{padding:16px 0;border-bottom:1px solid var(--line)}
.plan-group:first-child{padding-top:2px}
.plan-group:last-child{border-bottom:0;padding-bottom:2px}
.plan-model{font-size:13.5px;font-weight:600;margin-bottom:12px}
.plan-tiers{display:flex;gap:10px;flex-wrap:wrap}
.plan-tier{display:flex;align-items:center;gap:14px;border:1px solid var(--line);border-radius:var(--r-sm);padding:9px 14px}
.plan-tier:hover{border-color:var(--line-2)}
.plan-duration{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-2)}
.plan-price{font-size:13px;font-weight:600}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden}
.seg button{appearance:none;background:var(--surface);border:0;padding:8px 20px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:0.08em;color:var(--ink-3);cursor:pointer}
.seg button+.seg button{border-left:1px solid var(--line)}
.seg button.active{background:var(--ink);color:oklch(98% 0.003 250)}
.seg button .off{margin-left:6px;color:var(--accent)}
.seg button.active .off{color:var(--accent-soft)}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:16px}
.gallery-item{margin:0;cursor:pointer}
.gallery-item img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border:1px solid var(--line);border-radius:var(--r-sm);transition:border-color .15s ease,opacity .15s ease;background:var(--surface-2)}
.gallery-item:hover img{border-color:var(--accent)}
.gallery-item figcaption{display:flex;justify-content:space-between;gap:8px;margin-top:7px;font-family:var(--mono);font-size:10px;color:var(--ink-3)}
.gallery-item .cap{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lightbox{display:none;position:fixed;inset:0;z-index:120;align-items:center;justify-content:center;padding:24px;background:oklch(18% 0.02 258 / 0.85);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.lightbox.open{display:flex}
.lightbox-inner{width:100%;max-width:880px;animation:modalIn .2s cubic-bezier(.16,1,.3,1)}
.lightbox img{display:block;max-width:100%;max-height:74vh;margin:0 auto;border:1px solid oklch(100% 0 0 / 0.14);border-radius:var(--r);background:var(--surface)}
.lightbox-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}
.lightbox-path{font-family:var(--mono);font-size:10.5px;color:oklch(93% 0.004 250);opacity:.75;word-break:break-all}
.lightbox-actions{display:flex;gap:8px;flex-shrink:0}
.lightbox .btn{background:oklch(100% 0 0 / 0.1);border-color:oklch(100% 0 0 / 0.18);color:oklch(97% 0.003 250)}
.lightbox .btn:hover{background:oklch(100% 0 0 / 0.18)}
.quote-box{margin-top:14px;padding:14px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm);font-family:var(--mono);font-size:12px;line-height:1.9;white-space:pre-line}
.warning-bar{display:flex;align-items:center;gap:8px;padding:9px 12px;margin-bottom:14px;background:var(--warn-soft);color:var(--warn);border:1px solid color-mix(in oklch,var(--warn) 28%,transparent);border-radius:var(--r-sm);font-size:12px;font-weight:500}
.steps{list-style:none;display:flex;flex-direction:column;gap:12px}
.steps li{display:flex;align-items:baseline;gap:12px;font-size:13px;color:var(--ink-2)}
.steps li span{font-family:var(--mono);font-size:10.5px;font-weight:600;color:var(--accent-strong);letter-spacing:0.06em}
.kv{display:grid;grid-template-columns:auto 1fr;gap:7px 18px;font-size:12.5px}
.kv dt{font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-3);align-self:center}
.kv dd{font-weight:500;color:var(--ink)}
.net-line{display:flex;align-items:center;gap:9px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line-2);font-family:var(--mono);font-size:10.5px;letter-spacing:0.06em;color:var(--ink-3)}
.refill-config{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.refill-config>*{flex:1;min-width:100px}
.modal-backdrop{display:none;position:fixed;inset:0;z-index:100;align-items:center;justify-content:center;padding:20px;background:oklch(20% 0.02 258 / 0.45);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.modal-backdrop.open{display:flex}
.modal{width:100%;max-width:440px;padding:24px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:0 24px 60px -14px oklch(20% 0.02 258 / 0.3);animation:modalIn .2s cubic-bezier(.16,1,.3,1)}
.modal-title{font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px}
.modal-body{font-size:13.5px;line-height:1.75;color:var(--ink-2)}
.modal-body strong{color:var(--ink);font-weight:600}
.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}
@keyframes modalIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:200;display:flex;align-items:center;padding:10px 16px;border-radius:var(--r-sm);font-family:var(--mono);font-size:12px;font-weight:500;box-shadow:0 10px 30px -10px oklch(20% 0.02 258 / 0.35);animation:toastIn .2s cubic-bezier(.16,1,.3,1)}
.toast-ok{background:var(--ink);color:var(--surface)}
.toast-err{background:var(--err);color:#fff}
@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
@media(max-width:900px){
  .shell{flex-direction:column}
  .sidebar{position:static;width:auto;height:auto;flex-direction:row;align-items:center;gap:12px;padding:11px 14px;border-right:none;border-bottom:1px solid var(--line)}
  .brand{padding:0;border-bottom:none;gap:8px}
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
}
@media(max-width:560px){
  .inline-row{flex-direction:column}
  .refill-config{flex-direction:column}
  .balance-card .value{font-size:30px}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style>
</head>
<body>
<div class="shell" x-data="app()" x-init="init()" x-cloak>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark"></div>
      <div class="brand-name">Paytaca</div>
    </div>
    <nav class="nav">
      <div class="nav-label">Navigate</div>
      <div class="nav-item" :class="{active: tab==='wallet'}" @click="tab='wallet'"><span class="idx">01</span>Wallet</div>
      <div class="nav-item" :class="{active: tab==='swap'}" @click="tab='swap'"><span class="idx">02</span>Swap</div>
      <div class="nav-item" :class="{active: tab==='ai'}" @click="tab='ai'"><span class="idx">03</span>AI</div>
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
      <div class="page-title"><span x-text="tab==='wallet' ? 'Wallet' : tab==='swap' ? 'Swap' : 'AI'"></span><span class="path" x-text="'~/paytaca/' + tab + (tab==='ai' ? '/' + aiSub : '')"></span></div>
      <div class="topbar-actions">
        <button class="btn btn-sm" @click="load()" title="Refresh">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>
          Refresh
        </button>
      </div>
    </header>
    <main class="content">
      <div x-show="tab==='wallet'">
        <div class="grid">
          <div class="span-8">
            <div class="card balance-card">
              <div class="label">Available Balance</div>
              <div class="value"><span x-text="state ? state.balance.spendableBch : '—'"></span><span class="unit">BCH</span></div>
              <div class="sub" x-text="state?.balance?.usd ? '$' + Number(state.balance.usd).toFixed(2) + ' USD' : ''"></div>
            </div>
          </div>
          <div class="span-4">
            <div class="card lift-card">
              <div class="card-head"><div class="card-title">LIFT Balance</div></div>
              <div class="value" x-text="state?.lift?.displayBalance || '—'"></div>
              <div class="sub">Tokens</div>
            </div>
          </div>
          <div class="span-5">
            <div class="card">
              <div class="card-head"><div class="card-title">Receive</div></div>
              <div class="segmented" style="margin-bottom:14px">
                <div class="segmented-opt" :class="{active: rcvType==='bch'}" @click="rcvType='bch'; onRcvChange()">BCH</div>
                <div class="segmented-opt" :class="{active: rcvType==='token'}" @click="rcvType='token'; onRcvChange()">CashToken</div>
              </div>
              <div x-show="rcvType==='token'" class="field"><label class="field-label">Token Category ID</label><input class="field-input" type="text" x-model="rcvCategory" @input="onRcvChange()" placeholder="64-character hex category ID"></div>
              <div class="field"><label class="field-label">Amount (optional)</label><input class="field-input" type="number" x-model="rcvAmount" @input="onRcvChange()" placeholder="0.0" step="any" min="0"></div>
              <div class="addr-display"><div class="addr-row"><span class="addr-label">Address</span><button class="btn-copy" @click="copyText(rcvView?.address)">COPY</button></div><div x-text="rcvView?.address || 'Loading…'"></div></div>
              <template x-if="rcvView?.paymentUri"><div class="addr-display" style="margin-top:8px"><div class="addr-row"><span class="addr-label">Payment URI</span><button class="btn-copy" @click="copyText(rcvView?.paymentUri)">COPY</button></div><div style="font-size:10.5px;color:var(--ink-3)" x-text="rcvView?.paymentUri"></div></div></template>
              <div class="qr-wrap" x-html="rcvQrSvg"></div>
            </div>
          </div>
          <div class="span-7">
            <div class="card">
              <div class="card-head"><div class="card-title">Send</div></div>
              <div class="segmented" style="margin-bottom:14px">
                <div class="segmented-opt" :class="{active: sendType==='bch'}" @click="sendType='bch'; sendError=''; sendSuccess=''">BCH</div>
                <div class="segmented-opt" :class="{active: sendType==='token'}" @click="sendType='token'; sendError=''; sendSuccess=''">CashToken</div>
              </div>
              <div x-show="sendType==='token'">
                <div class="field"><label class="field-label">Token Category ID</label><input class="field-input" type="text" x-model="sendCategory" placeholder="64-char hex category ID"></div>
                <div class="field"><label class="field-label">Token Amount (base units)</label><input class="field-input" type="text" x-model="sendTokenAmount" placeholder="e.g. 1000"></div>
              </div>
              <div x-show="sendType==='bch'">
                <div class="field"><label class="field-label">Amount</label><div class="inline-row"><input class="field-input" type="number" x-model="sendAmount" placeholder="0.0" step="any" min="0"><select class="field-input shrink" x-model="sendCurrency" style="width:104px"><option value="bch">BCH</option><option value="sats">sats</option><option value="usd">USD</option></select></div></div>
              </div>
              <div class="field"><label class="field-label">Recipient Address</label><input class="field-input" type="text" x-model="sendAddress" placeholder="bitcoincash:q..."></div>
              <template x-if="sendType==='token' && sendAddress && !isTokenAddr(sendAddress)"><div class="warning-bar">Address is not token-aware (z-prefix). Tokens may be lost.</div></template>
              <div x-show="sendError" class="field-error" x-text="sendError"></div>
              <div x-show="sendSuccess" class="field-success" x-text="sendSuccess"></div>
              <button class="btn btn-primary" style="margin-top:14px;width:100%" @click="doSend()">Send</button>
            </div>
          </div>
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
      <div x-show="tab==='swap'">
        <div class="grid">
          <div class="span-6">
            <div class="card">
              <div class="card-head"><div class="card-title">Cauldron Swap</div></div>
              <template x-if="state?.network === 'chipnet'"><div class="warning-bar">Cauldron swaps are only available on mainnet.</div></template>
              <div class="field"><label class="field-label">Token Category ID</label><input class="field-input" type="text" x-model="swapToken" placeholder="64-char hex category ID"></div>
              <div class="segmented" style="margin-bottom:14px">
                <div class="segmented-opt" :class="{active: swapDir==='sell'}" @click="swapDir='sell'; swapQuoteText=''; pendingSwap=null">Sell Token → BCH</div>
                <div class="segmented-opt" :class="{active: swapDir==='buy'}" @click="swapDir='buy'; swapQuoteText=''; pendingSwap=null">Buy Token ← BCH</div>
              </div>
              <div class="field"><label class="field-label" x-text="swapDir==='sell' ? 'Token Amount' : 'BCH Amount'"></label><input class="field-input" type="number" x-model="swapAmount" placeholder="0.0" step="any" min="0"></div>
              <div x-show="swapError" class="field-error" x-text="swapError"></div>
              <button class="btn btn-primary" style="margin-top:14px;width:100%" @click="doSwapQuote()" :disabled="swapBusy" x-text="swapBusy ? 'Fetching quote…' : 'Get Quote'"></button>
            </div>
          </div>
          <div class="span-6">
            <template x-if="swapQuoteText"><div class="card">
              <div class="card-head"><div class="card-title">Quote</div></div>
              <div class="quote-box" x-text="swapQuoteText"></div>
              <div class="btn-group"><button class="btn" @click="swapQuoteText=''; pendingSwap=null">Cancel</button><button class="btn btn-primary" @click="doSwapExecute()" :disabled="swapExecBusy" x-text="swapExecBusy ? 'Executing…' : 'Confirm Swap'"></button></div>
            </div></template>
            <template x-if="!swapQuoteText"><div class="card">
              <div class="card-head"><div class="card-title">Protocol</div></div>
              <ol class="steps">
                <li><span>01</span>Paste the token category ID</li>
                <li><span>02</span>Choose sell or buy direction</li>
                <li><span>03</span>Enter an amount and fetch a quote</li>
                <li><span>04</span>Review fees and confirm on-chain</li>
              </ol>
              <div class="net-line"><span class="dot" :class="{chipnet: state?.network==='chipnet'}"></span><span x-text="state?.network==='chipnet' ? 'CHIPNET · SWAPS DISABLED' : 'MAINNET · CAULDRON DEX'"></span></div>
            </div></template>
          </div>
        </div>
      </div>
            <div x-show="tab==='ai'">
        <div class="subnav" role="tablist">
          <button :class="{active: aiSub==='plans'}" @click="aiSub='plans'"><span class="idx">01</span>PLANS</button>
          <button :class="{active: aiSub==='credits'}" @click="aiSub='credits'"><span class="idx">02</span>CREDITS</button>
          <button :class="{active: aiSub==='images'}" @click="aiSub='images'"><span class="idx">03</span>IMAGES</button>
        </div>
        <div x-show="aiSub==='plans'" class="grid">
          <div class="span-12">
            <div class="card">
              <div class="card-head"><div class="card-title">Plans</div><span class="pill pill-idle" x-show="state?.liftDiscountPercent" x-text="state.liftDiscountPercent + '% OFF WITH LIFT'"></span></div>
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
            </div>
          </div>
        </div>
        <div x-show="aiSub==='credits'" class="grid">
          <div class="span-4">
            <div class="card">
              <div class="card-head"><div class="card-title">Credits</div></div>
              <template x-if="state?.usage?.length"><div class="metric"><div class="metric-value" x-text="activeCreditsTotal(state) > 0 ? fmtDuration(activeCreditsTotal(state)) : '0m'"></div><div class="metric-label">remaining · <span x-text="activeCreditsCount(state)"></span> active session(s)</div></div></template>
              <template x-if="state && !state?.usage?.length"><div class="empty">No active sessions</div></template>
              <template x-if="!state"><div class="empty">Loading…</div></template>
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
          <div class="span-12">
            <div class="card">
              <div class="card-head"><div class="card-title">Auto-Refill</div></div>
              <template x-if="state?.autoRefill"><div>
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                  <dl class="kv">
                    <dt>Model</dt><dd x-text="state.autoRefill.model"></dd>
                    <dt>Every</dt><dd><span x-text="state.autoRefill.minutes"></span> min</dd>
                    <dt>Max</dt><dd><span x-text="state.autoRefill.maxMinutes || '∞'"></span> min total</dd>
                    <dt>Left</dt><dd x-text="fmtDuration((state.autoRefill.remainingMinutes || 0) * 60)"></dd>
                  </dl>
                  <span class="pill pill-active">ACTIVE</span>
                </div>
                <button class="btn btn-sm btn-danger" style="margin-top:18px" @click="toggleRefill(false)">Disable</button>
              </div></template>
              <template x-if="state && !state?.autoRefill"><div>
                <div style="font-size:12.5px;color:var(--ink-3);margin-bottom:12px">Auto-refill buys a new plan when credits run out.</div>
                <div class="refill-config"><select class="field-input" x-model="refillModel"><option value="">Select model</option><template x-for="p in state?.plans || []" :key="p.modelId"><option :value="p.modelId" x-text="p.displayName || p.modelId"></option></template></select><input class="field-input" type="number" x-model="refillMinutes" placeholder="Minutes" value="30"><input class="field-input" type="number" x-model="refillMax" placeholder="Max total"><select class="field-input" x-model="refillPayMethod"><option value="bch">BCH</option><option value="lift">LIFT</option></select><button class="btn btn-sm btn-primary" @click="toggleRefill(true)">Enable</button></div>
              </div></template>
              <template x-if="!state"><div class="empty">Loading…</div></template>
            </div>
          </div>
        </div>
        <div x-show="aiSub==='images'" class="grid">
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
                    <div x-show="h.actual_cost_usd != null" x-text="h.actual_cost_usd != null ? '$' + h.actual_cost_usd.toFixed(2) : ''"></div>
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
<div class="modal-backdrop" :class="{open: showPurchaseModal}" @click.self="showPurchaseModal=false"><div class="modal" role="dialog" aria-modal="true"><div class="modal-title">Confirm Purchase</div><div class="modal-body"><strong x-text="pendingPurchase?.displayName"></strong><br>Duration: <span x-text="pendingPurchase?.durationDisplay"></span></div><div class="seg" style="margin-top:16px" role="tablist"><button :class="{active: purchaseMethod==='bch'}" @click="purchaseMethod='bch'">BCH</button><button :class="{active: purchaseMethod==='lift'}" @click="purchaseMethod='lift'; loadLiftQuote()">LIFT<span class="off" x-show="state?.liftDiscountPercent" x-text="'-' + state.liftDiscountPercent + '%'"></span></button></div><div class="modal-body" style="margin-top:14px"><template x-if="purchaseMethod==='bch'"><div>Price: <strong x-text="bchPriceLabel(pendingPurchase)"></strong></div></template><template x-if="purchaseMethod==='lift'"><div><s style="color:var(--ink-3);font-size:12px" x-text="bchPriceLabel(pendingPurchase)"></s> <strong x-text="liftPriceLabel(pendingPurchase)"></strong> <span class="pill pill-active" x-show="state?.liftDiscountPercent" x-text="state.liftDiscountPercent + '% OFF'"></span><br><span style="font-size:11.5px;color:var(--ink-3)" x-text="state?.lift ? 'LIFT balance: ' + state.lift.displayBalance : 'No LIFT tokens in this wallet'"></span><template x-if="liftQuoteBusy"><div style="font-size:11.5px;color:var(--ink-3);margin-top:6px">Estimating LIFT needed…</div></template><template x-if="liftQuoteError"><div style="font-size:11.5px;color:var(--err);margin-top:6px" x-text="liftQuoteError"></div></template><template x-if="liftQuote && !liftQuoteBusy && !liftQuoteError"><div style="font-size:11.5px;margin-top:6px">LIFT needed: <strong x-text="'≈ ' + liftQuote.display + ' ' + liftQuote.symbol"></strong></div></template><template x-if="liftInsufficient()"><div style="font-size:11.5px;color:var(--err);margin-top:4px">Insufficient LIFT balance — pay with BCH or top up LIFT</div></template></div></template></div><div class="modal-actions"><button class="btn" @click="showPurchaseModal=false">Cancel</button><button class="btn btn-primary" @click="confirmPurchase()" :disabled="purchaseBusy || (purchaseMethod==='lift' && (!state?.lift || liftQuoteBusy || liftInsufficient()))" x-text="purchaseBusy ? 'Processing…' : (purchaseMethod==='lift' ? 'Pay with LIFT' : 'Pay with BCH')"></button></div></div></div>
<div class="modal-backdrop" :class="{open: showSendModal}" @click.self="showSendModal=false"><div class="modal" role="dialog" aria-modal="true"><div class="modal-title">Confirm Send</div><template x-if="pendingSend?.type === 'bch'"><div class="modal-body"><strong>Send BCH</strong><br>Address: <span class="mono-break" x-text="pendingSend?.address"></span><br>Amount: <strong><span x-text="pendingSend?.amount"></span> <span x-text="pendingSend?.currency?.toUpperCase()"></span></strong></div></template><template x-if="pendingSend?.type === 'token'"><div class="modal-body"><strong>Send Token</strong><br>Category: <span class="mono-break" x-text="pendingSend?.category?.slice(0,16) + '…'"></span><br>Amount: <strong x-text="pendingSend?.tokenAmount"></strong><br>Address: <span class="mono-break" x-text="pendingSend?.address"></span></div></template><div class="modal-actions"><button class="btn" @click="showSendModal=false">Cancel</button><button class="btn btn-primary" @click="confirmSend()" :disabled="sendConfirmBusy" x-text="sendConfirmBusy ? 'Sending…' : 'Confirm & Send'"></button></div></div></div>
<div class="modal-backdrop" :class="{open: showImageQuoteModal}" @click.self="showImageQuoteModal=false"><div class="modal" role="dialog" aria-modal="true"><div class="modal-title">Image Generation</div><div class="modal-body">Model: <strong x-text="pendingImageQuote?.model || 'default'"></strong><br>Cost: <span class="tbl-num" x-text="pendingImageQuote?.amountSats ? (pendingImageQuote.amountSats / 1e8).toFixed(8) + ' BCH' : 'calculating...'"></span><span x-show="pendingImageQuote?.amountUsd != null" x-text="pendingImageQuote?.amountUsd != null ? ' · ≈ $' + pendingImageQuote.amountUsd.toFixed(2) + ' USD' : ''"></span><br>Order: <span class="mono-break" style="color:var(--ink-3)" x-text="pendingImageQuote?.orderId || 'pending'"></span></div><div class="modal-actions"><button class="btn" @click="showImageQuoteModal=false">Cancel</button><button class="btn btn-primary" @click="confirmImageGen()" :disabled="imgGenBusy" x-text="imgGenBusy ? 'Generating…' : 'Pay & Generate'"></button></div></div></div>
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
</div>
<script>
var QR=(()=>{var EC_PARAMS=[[],[26,7,1],[44,10,1],[70,15,1],[100,20,1],[134,26,1],[172,18,2],[196,20,2],[242,24,2],[292,30,2],[346,18,4]];var ALIGN_POS=[[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];var BYTE_CAP=[0,17,32,53,78,106,134,154,192,230,271];var EXP=new Uint8Array(512),LOG=new Uint8Array(256);var x=1,i,j;for(i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x=(x<<1)^(x&128?0x11D:0)}for(i=255;i<512;i++)EXP[i]=EXP[i-255];function gfMul(a,b){return a&&b?EXP[LOG[a]+LOG[b]]:0}function rsEncode(data,ecLen){var gen=[1],next,coef;for(i=0;i<ecLen;i++){next=new Array(gen.length+1).fill(0);for(j=0;j<gen.length;j++){next[j]^=gen[j];next[j+1]^=gfMul(gen[j],EXP[i])}gen=next}gen.reverse();var msg=new Array(data.length+ecLen).fill(0);for(i=0;i<data.length;i++)msg[i]=data[i];for(i=0;i<data.length;i++){coef=msg[i];if(coef!==0)for(j=1;j<gen.length;j++)msg[i+j]^=gfMul(gen[j],coef)}return msg.slice(data.length)}function selectVersion(len){for(var v=1;v<=10;v++)if(len<=BYTE_CAP[v])return v;return-1}function toUtf8Bytes(text){var bytes=[],c;for(i=0;i<text.length;i++){c=text.charCodeAt(i);if(c<128)bytes.push(c);else if(c<2048){bytes.push(192|(c>>6));bytes.push(128|(c&63))}else{bytes.push(224|(c>>12));bytes.push(128|((c>>6)&63));bytes.push(128|(c&63))}}return bytes}function encodeData(bytes,version){var params=EC_PARAMS[version],total=params[0],ecPerBlock=params[1],numBlocks=params[2];var dataTotal=total-ecPerBlock*numBlocks,countBits=version<=9?8:16;var bits=[0,1,0,0],totalBits=dataTotal*8;for(i=countBits-1;i>=0;i--)bits.push((bytes.length>>i)&1);for(var k=0;k<bytes.length;k++){c=bytes[k];for(i=7;i>=0;i--)bits.push((c>>i)&1)}for(i=0;i<4&&bits.length<totalBits;i++)bits.push(0);while(bits.length%8)bits.push(0);while(bits.length<totalBits){for(i=0;i<8&&bits.length<totalBits;i++)bits.push(0)}var codewords=[];for(i=0;i<bits.length;i+=8){var v=0;for(j=0;j<8;j++)v=(v<<1)|(bits[i+j]||0);codewords.push(v)}return codewords}function buildAndInterleave(codewords,version){var params=EC_PARAMS[version],total=params[0],ecPerBlock=params[1],numBlocks=params[2];var dataTotal=total-ecPerBlock*numBlocks,dataPerBlock=Math.floor(dataTotal/numBlocks);var longBlocks=dataTotal-dataPerBlock*numBlocks,blocks=[],off=0,result=[];for(i=0;i<numBlocks;i++){var len=dataPerBlock+(i<longBlocks?1:0);var data=codewords.slice(off,off+len);off+=len;blocks.push({data:data,ec:rsEncode(data,ecPerBlock)})}var maxData=Math.max.apply(null,blocks.map(function(b){return b.data.length}));for(i=0;i<maxData;i++)for(j=0;j<blocks.length;j++)if(i<blocks[j].data.length)result.push(blocks[j].data[i]);for(i=0;i<ecPerBlock;i++)for(j=0;j<blocks.length;j++)if(i<blocks[j].ec.length)result.push(blocks[j].ec[i]);return result}function createMatrix(version){var size=version*4+17;var mod=[],res=[];for(i=0;i<size;i++){mod.push(new Int8Array(size));res.push(new Uint8Array(size))}return{size:size,mod:mod,res:res}}function placeFinder(m,r0,c0){var mr,mc,dark;for(var r=-1;r<=7;r++)for(var c=-1;c<=7;c++){mr=r0+r;mc=c0+c;if(mr<0||mr>=m.size||mc<0||mc>=m.size)continue;dark=(r>=0&&r<=6&&(c===0||c===6))||(c>=0&&c<=6&&(r===0||r===6))||(r>=2&&r<=4&&c>=2&&c<=4);m.mod[mr][mc]=dark?1:-1;m.res[mr][mc]=1}}function placeAlignment(m,cr,cc){var dark;for(var r=-2;r<=2;r++)for(var c=-2;c<=2;c++){dark=Math.abs(r)===2||Math.abs(c)===2||(r===0&&c===0);m.mod[cr+r][cc+c]=dark?1:-1;m.res[cr+r][cc+c]=1}}function placeAll(m,version){placeFinder(m,0,0);placeFinder(m,0,m.size-7);placeFinder(m,m.size-7,0);var v;for(i=8;i<m.size-8;i++){v=(i&1)?-1:1;if(!m.res[6][i]){m.mod[6][i]=v;m.res[6][i]=1}if(!m.res[i][6]){m.mod[i][6]=v;m.res[i][6]=1}}var ap=ALIGN_POS[version];if(ap.length)for(var ai=0;ai<ap.length;ai++)for(var aj=0;aj<ap.length;aj++){if(!m.res[ap[ai]][ap[aj]])placeAlignment(m,ap[ai],ap[aj])}m.mod[m.size-8][8]=1;m.res[m.size-8][8]=1;for(i=0;i<=8;i++){m.res[8][i]=1;m.res[i][8]=1;if(m.size-1-i>=0){m.res[8][m.size-1-i]=1;m.res[m.size-1-i][8]=1}}}function placeData(m,data){var bits=[],idx=0,up=true,row,c,dc;for(i=0;i<data.length;i++){var b=data[i];for(j=7;j>=0;j--)bits.push((b>>j)&1)}for(var col=m.size-1;col>=0;col-=2){if(col===6)col--;for(i=0;i<m.size;i++){row=up?m.size-1-i:i;for(dc=0;dc<=1;dc++){c=col-dc;if(c>=0&&c<m.size&&!m.res[row][c]){m.mod[row][c]=idx<bits.length?bits[idx]:0;idx++}}}up=!up}}function applyMask(m,mask){var out=[],flip;for(i=0;i<m.size;i++){out.push(new Int8Array(m.mod[i]))}for(var r=0;r<m.size;r++)for(var c=0;c<m.size;c++){if(m.res[r][c])continue;flip=false;if(mask===0)flip=(r+c)%2===0;else if(mask===1)flip=r%2===0;else if(mask===2)flip=c%3===0;else if(mask===3)flip=(r+c)%3===0;else if(mask===4)flip=(Math.floor(r/2)+Math.floor(c/3))%2===0;else if(mask===5)flip=(r*c)%2+(r*c)%3===0;else if(mask===6)flip=((r*c)%2+(r*c)%3)%2===0;else flip=((r+c)%2+(r*c)%3)%2===0;if(flip)out[r][c]=out[r][c]?0:1}return out}function computeFormatBits(mask){var data=(1<<3)|mask,rem=data<<10;for(i=4;i>=0;i--)if(rem&(1<<(i+10)))rem^=0x537<<i;return((data<<10)|rem)^0x5412}function placeFormat(mod,size,mask){var fmt=computeFormatBits(mask);var p1=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];var p2=[[size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]];for(i=0;i<15;i++){var b=(fmt>>(14-i))&1;mod[p1[i][0]][p1[i][1]]=b;mod[p2[i][0]][p2[i][1]]=b}}function penalty(mod,size){var score=0,run,v,dark=0;for(var r=0;r<size;r++){run=1;for(var c=1;c<size;c++){if(mod[r][c]===mod[r][c-1])run++;else{if(run>=5)score+=run-2;run=1}}if(run>=5)score+=run-2}for(var c2=0;c2<size;c2++){run=1;for(var r2=1;r2<size;r2++){if(mod[r2][c2]===mod[r2-1][c2])run++;else{if(run>=5)score+=run-2;run=1}}if(run>=5)score+=run-2}for(r=0;r<size-1;r++)for(c2=0;c2<size-1;c2++){v=mod[r][c2];if(v===mod[r][c2+1]&&v===mod[r+1][c2]&&v===mod[r+1][c2+1])score+=3}for(r=0;r<size;r++)for(c2=0;c2<=size-7;c2++){if(mod[r][c2]===1&&mod[r][c2+1]===0&&mod[r][c2+2]===1&&mod[r][c2+3]===1&&mod[r][c2+4]===1&&mod[r][c2+5]===0&&mod[r][c2+6]===1)score+=40}for(c2=0;c2<size;c2++)for(r=0;r<=size-7;r++){if(mod[r][c2]===1&&mod[r+1][c2]===0&&mod[r+2][c2]===1&&mod[r+3][c2]===1&&mod[r+4][c2]===1&&mod[r+5][c2]===0&&mod[r+6][c2]===1)score+=40}for(r=0;r<size;r++)for(c2=0;c2<size;c2++)if(mod[r][c2]===1)dark++;var pct=dark*100/(size*size),p5=Math.floor(pct/5)*5;score+=Math.min(Math.abs(p5-50),Math.abs(p5+5-50))/5*10;return score}function encode(text){var bytes=toUtf8Bytes(text),version=selectVersion(bytes.length);if(version<0)throw new Error('Text too long for QR code');var cw=encodeData(bytes,version),interleaved=buildAndInterleave(cw,version);var m=createMatrix(version);placeAll(m,version);placeData(m,interleaved);var bestMask=0,bestScore=Infinity;for(var mask=0;mask<8;mask++){var masked=applyMask(m,mask);placeFormat(masked,m.size,mask);var s=penalty(masked,m.size);if(s<bestScore){bestScore=s;bestMask=mask}}var final_=applyMask(m,bestMask);placeFormat(final_,m.size,bestMask);return{matrix:final_,size:m.size}}function toSVG(qr,ms){ms=ms||4;var px=qr.size*ms,d='';for(var r=0;r<qr.size;r++)for(var c=0;c<qr.size;c++)if(qr.matrix[r][c]===1)d+='M'+(c*ms)+','+(r*ms)+'h'+ms+'v'+ms+'h'+(-ms)+'z';return'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+(px+ms*2)+' '+(px+ms*2)+'" width="'+(px+ms*2)+'" height="'+(px+ms*2)+'"><rect width="100%" height="100%" fill="#fff" rx="8"/><path d="'+d+'" fill="#000"/></svg>'}return{encode:encode,toSVG:toSVG}})();
</script>
<script>
document.addEventListener('alpine:init',function(){Alpine.data('app',function(){return{
token:new URLSearchParams(window.location.search).get('token')||'',theme:localStorage.getItem('pt-theme')||'light',tab:'wallet',state:null,
rcvType:'bch',rcvCategory:'',rcvAmount:'',rcvView:null,rcvQrSvg:'',
sendType:'bch',sendAmount:'',sendCurrency:'bch',sendAddress:'',sendCategory:'',sendTokenAmount:'',sendError:'',sendSuccess:'',pendingSend:null,
histType:'all',histRecords:[],histPage:1,histNumPages:1,histHasNext:false,histLoading:false,histNetwork:'mainnet',
swapToken:'',swapDir:'sell',swapAmount:'',swapError:'',swapQuoteText:'',swapBusy:false,swapExecBusy:false,pendingSwap:null,
pendingPurchase:null,purchaseBusy:false,purchaseMethod:'bch',liftQuote:null,liftQuoteBusy:false,liftQuoteError:'',showPurchaseModal:false,showSendModal:false,sendConfirmBusy:false,
pendingImageQuote:null,showImageQuoteModal:false,imgGenBusy:false,imgQuoteBusy:false,aiSub:'plans',lightbox:null,lightboxConfirmDelete:false,
refillModel:'',refillMinutes:'30',refillMax:'',refillPayMethod:'bch',
imgPrompt:'',imgModel:'bytedance-seed/seedream-5-0-pro',imgAspect:'1:1',imgQuality:'auto',
toastVisible:false,toastMsg:'',toastOk:true,
async init(){document.documentElement.setAttribute('data-theme',this.theme);try{this.state=await this.api('GET','/api/wallet/state');this.onRcvChange();this.loadHistory(1)}catch(e){this.toast(e.message,true)}},
async load(){try{this.state=await this.api('GET','/api/wallet/state');this.onRcvChange();this.loadHistory(this.histPage)}catch(e){this.toast(e.message,true)}},
async api(method,apipath,body){var opts={method:method,headers:{'X-Paytaca-Token':this.token,'Accept':'application/json'}};if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body)}var res=await fetch(apipath,opts);if(!res.ok){var msg='Request failed ('+res.status+')';try{var j=await res.json();if(j.error)msg=j.error}catch(ex){}throw new Error(msg)}return res.json()},
fmtDuration(s){if(!s||s<=0)return '0m';var h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?h+'h '+m+'m':m+'m'},
bchPriceLabel(p){if(!p)return '';return p.priceUsd!=null?'$'+p.priceUsd.toFixed(2)+' USD':((p.priceSats||0)/1e8).toFixed(8)+' BCH'},
liftPriceLabel(p){if(!p)return '';var pct=(this.state&&this.state.liftDiscountPercent)||0;var f=1-pct/100;return p.priceUsd!=null?'$'+(p.priceUsd*f).toFixed(2)+' USD':(((p.priceSats||0)*f)/1e8).toFixed(8)+' BCH'},

async loadLiftQuote(){var p=this.pendingPurchase;if(!p||!p.priceSats){this.liftQuote=null;this.liftQuoteError='';return}var pct=(this.state&&this.state.liftDiscountPercent)||0;var sats=Math.round(p.priceSats*(1-pct/100));if(sats<1)sats=1;this.liftQuoteBusy=true;this.liftQuoteError='';try{this.liftQuote=await this.api('GET','/api/ai/lift-quote?sats='+sats)}catch(e){this.liftQuote=null;this.liftQuoteError=e.message||'Failed to estimate LIFT needed'}this.liftQuoteBusy=false},

liftInsufficient(){if(!this.liftQuote||!this.state||!this.state.lift)return false;return Number(this.state.lift.rawBalance)<Number(this.liftQuote.rawAmount)},
activeCreditsTotal(state){if(!state?.usage)return 0;return state.usage.reduce(function(sum,s){return s.active?sum+(s.remainingSeconds||0):sum},0)},
activeCreditsCount(state){if(!state?.usage)return 0;return state.usage.filter(function(s){return s.active}).length},
isTokenAddr(addr){return addr&&/^bitcoincash:z/.test(addr)},
toast(msg,isErr){this.toastMsg=msg;this.toastOk=!isErr;this.toastVisible=true;var self=this;setTimeout(function(){self.toastVisible=false},3000)},
toggleTheme(){this.theme=this.theme==='dark'?'light':'dark';localStorage.setItem('pt-theme',this.theme);document.documentElement.setAttribute('data-theme',this.theme)},
copyText(text){if(text){navigator.clipboard.writeText(text);this.toast('Copied!')}},
async onRcvChange(){this.rcvView=null;this.rcvQrSvg='';var params=new URLSearchParams();if(this.rcvType==='token'&&this.rcvCategory){params.set('category',this.rcvCategory);params.set('token','1')}if(this.rcvAmount)params.set('amount',this.rcvAmount);try{var view=await this.api('GET','/api/wallet/receive?'+params.toString());this.rcvView=view;if(view.address){try{this.rcvQrSvg=QR.toSVG(QR.encode(view.address))}catch(ex){}}}catch(e){this.rcvView={address:'Error: '+e.message}}},
doSend(){this.sendError='';this.sendSuccess='';var address=(this.sendAddress||'').trim();if(!address){this.sendError='Enter a recipient address';return}if(this.sendType==='bch'){var amount=parseFloat(this.sendAmount);var currency=this.sendCurrency;if(!amount||amount<=0){this.sendError='Enter a valid amount';return}this.pendingSend={type:'bch',address:address,amount:amount,currency:currency};this.showSendModal=true}else{var category=(this.sendCategory||'').trim();var tokenAmount=(this.sendTokenAmount||'').trim();if(!category||!/^[a-fA-F0-9]{64}$/.test(category)){this.sendError='Enter a valid 64-char hex category ID';return}if(!tokenAmount){this.sendError='Enter a token amount';return}this.pendingSend={type:'token',category:category,tokenAmount:tokenAmount,address:address};this.showSendModal=true}},
async confirmSend(){if(!this.pendingSend)return;this.sendConfirmBusy=true;try{var result;if(this.pendingSend.type==='bch'){result=await this.api('POST','/api/wallet/send',this.pendingSend)}else{result=await this.api('POST','/api/wallet/send-token',{category:this.pendingSend.category,amount:this.pendingSend.tokenAmount,address:this.pendingSend.address})}this.showSendModal=false;if(result.success){this.sendSuccess='Sent! TX: '+(result.txid||'').slice(0,16)+'...';this.toast('Transaction sent');this.load()}else{this.sendError=result.error||'Send failed'}}catch(e){this.sendError=e.message}this.sendConfirmBusy=false;this.pendingSend=null},
async loadHistory(page){this.histPage=page||1;this.histLoading=true;this.histRecords=[];try{var data=await this.api('GET','/api/wallet/history?page='+this.histPage+'&type='+this.histType);var net=data.network||'mainnet';this.histNetwork=net;var base=net==='chipnet'?'https://chipnet.bchexplorer.info/tx/':'https://bchexplorer.info/tx/';this.histRecords=(data.records||[]).map(function(r){var isIn=r.record_type==='incoming';var party=isIn?((r.senders&&r.senders[0]&&r.senders[0][0])||''):((r.recipients&&r.recipients[0]&&r.recipients[0][0])||'');var amt=Number(r.amount)||0;var when=r.tx_timestamp||r.date_created||'';var dt=when?new Date(when):null;return{txid:r.txid,type:isIn?'incoming':'outgoing',dateText:dt?dt.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'',counterparty:party,partyShort:party?(party.slice(0,16)+'…'+party.slice(-6)):'—',amount:amt,amountText:amt.toFixed(8),usd:r.usd_price!=null?(amt*Number(r.usd_price)).toFixed(2):null,fee:r.tx_fee!=null?(Number(r.tx_fee)/1e8).toFixed(8):null,explorer:r.txid?base+r.txid:''}});this.histNumPages=data.numPages||1;this.histHasNext=!!data.hasNext}catch(e){this.histRecords=[]}this.histLoading=false},
async doSwapQuote(){var tokenId=(this.swapToken||'').trim();var amount=(this.swapAmount||'').trim();this.swapError='';if(!tokenId||!/^[a-fA-F0-9]{64}$/.test(tokenId)){this.swapError='Enter a valid 64-char hex token ID';return}if(!amount||isNaN(parseFloat(amount))||parseFloat(amount)<=0){this.swapError='Enter a valid amount';return}this.swapBusy=true;try{var q=await this.api('POST','/api/swap/quote',{tokenId:tokenId,direction:this.swapDir,amount:amount});this.pendingSwap={tokenId:tokenId,direction:this.swapDir,amount:amount};var text=q.formatted||'';if(!text){text='Rate: '+(q.rate||'?')+'\\nToken: '+q.tokenAmount+' '+(q.symbol||'')+'\\nBCH: '+(Number(q.bchAmountSats)/1e8).toFixed(8)+' BCH\\nTrade fee: '+(Number(q.tradeFeeSats)/1e8).toFixed(8)+' BCH';if(q.platformFeeSats)text+='\\nPlatform fee: '+(Number(q.platformFeeSats)/1e8).toFixed(8)+' BCH'}this.swapQuoteText=text}catch(e){this.swapError=e.message}this.swapBusy=false},
async doSwapExecute(){if(!this.pendingSwap)return;this.swapExecBusy=true;try{var result=await this.api('POST','/api/swap/execute',this.pendingSwap);if(result.success){this.toast('Swap executed! TX: '+(result.txid||'').slice(0,16)+'...');this.swapQuoteText='';this.pendingSwap=null;this.load()}else{this.swapError=result.error||'Swap failed'}}catch(e){this.swapError=e.message}this.swapExecBusy=false},
startPurchase(model,minutes,priceUsd,priceSats,durationDisplay,displayName){this.pendingPurchase={model:model,minutes:minutes,priceUsd:priceUsd,priceSats:priceSats,durationDisplay:durationDisplay,displayName:displayName};this.purchaseMethod='bch';this.liftQuote=null;this.liftQuoteError='';this.showPurchaseModal=true},
async confirmPurchase(){if(!this.pendingPurchase)return;this.purchaseBusy=true;try{await this.api('POST','/api/ai/purchase',{model:this.pendingPurchase.model,minutes:this.pendingPurchase.minutes,method:this.purchaseMethod});this.showPurchaseModal=false;this.toast('Plan purchased!');this.load()}catch(e){this.toast(e.message,true)}this.purchaseBusy=false;this.pendingPurchase=null},
async toggleRefill(enable){try{if(enable){var model=this.refillModel;var minutes=parseInt(this.refillMinutes)||30;var maxMinutes=this.refillMax?parseInt(this.refillMax):undefined;var paymentMethod=this.refillPayMethod||'bch';if(!model){this.toast('Select a model',true);return}await this.api('POST','/api/ai/auto-refill',{enabled:true,model:model,minutes:minutes,maxMinutes:maxMinutes,paymentMethod:paymentMethod});this.toast('Auto-refill enabled')}else{await this.api('POST','/api/ai/auto-refill',{enabled:false});this.toast('Auto-refill disabled')}this.load()}catch(e){this.toast(e.message,true)}},
async doImageQuote(){var prompt=(this.imgPrompt||'').trim();if(!prompt){this.toast('Enter a prompt',true);return}this.imgQuoteBusy=true;try{var quote=await this.api('POST','/api/ai/images/quote',{prompt:prompt,model:this.imgModel||undefined,aspectRatio:this.imgAspect,quality:this.imgQuality});this.pendingImageQuote=quote;this.showImageQuoteModal=true}catch(e){this.toast(e.message,true)}this.imgQuoteBusy=false},
async confirmImageGen(){if(!this.pendingImageQuote)return;this.imgGenBusy=true;try{var orderId=this.pendingImageQuote.orderId;var result=await this.api('POST','/api/ai/images/fulfill',{orderId:orderId});this.showImageQuoteModal=false;this.aiSub='images';if(result&&result.path){this.lightbox={id:orderId,path:result.path};this.toast('Image saved to ~/.paytaca/images')}else{this.toast((result&&result.error)||(result&&result.paid?'Payment received — image will appear in your gallery':'Image generation failed'),true)}this.load()}catch(e){this.toast(e.message,true)}this.imgGenBusy=false;this.pendingImageQuote=null},
openImage(h){this.lightbox={id:h.id,path:h.filepath||('~/paytaca/images/'+h.id)};this.lightboxConfirmDelete=false},
async deleteImage(){if(!this.lightbox)return;var id=this.lightbox.id;try{await this.api('DELETE','/api/ai/images/'+id);this.lightbox=null;this.lightboxConfirmDelete=false;this.toast('Image deleted');this.load()}catch(e){this.toast(e.message,true);this.lightboxConfirmDelete=false}},
imgCaption(h){var t=h.prompt||h.model_display_name||h.model||h.id||'';return t.length>48?t.slice(0,48)+'…':t}
}})});
</script>
<script defer>${ALPINE_JS}</script>
</body>
</html>`;
}
