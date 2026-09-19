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
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paytaca Web</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0c0e14;--surface:#14171f;--surface2:#1a1e28;--border:#252a35;--text:#e4e4e7;--muted:#71717a;--accent:#00d67a;--accent2:#00b868;--red:#ef4444;--yellow:#f59e0b;--blue:#3b82f6;--font:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--mono:'SF Mono','Cascadia Code','Fira Code',ui-monospace,monospace}
body{font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}
[x-cloak]{display:none!important}
.container{max-width:640px;margin:0 auto;padding:16px}
header{max-width:640px;margin:0 auto;padding:20px 16px;display:flex;justify-content:space-between;align-items:center}
header h1{font-size:20px;font-weight:600}
header h1 span{color:var(--accent)}
.badge{font-size:11px;padding:2px 8px;border-radius:4px;font-weight:500;text-transform:uppercase}
.badge-mainnet{background:#00d67a18;color:var(--accent);border:1px solid #00d67a30}
.badge-chipnet{background:#f59e0b18;color:var(--yellow);border:1px solid #f59e0b30}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px}
.card h2{font-size:14px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:6px}
.icon{font-size:16px}
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:1fr 1fr}
.stat{padding:12px;background:var(--surface2);border-radius:8px;text-align:center}
.stat .value{font-size:22px;font-weight:700;color:var(--accent);font-family:var(--mono)}
.stat .label{font-size:12px;color:var(--muted);margin-top:4px}
.empty{color:var(--muted);font-size:13px;padding:16px 0;text-align:center}
.radio-group{display:flex;gap:6px;margin-bottom:12px}
.radio-option{flex:1;padding:8px;text-align:center;border:1px solid var(--border);border-radius:6px;font-size:13px;cursor:pointer;color:var(--muted);transition:all .15s}
.radio-option:hover{border-color:var(--accent)}
.radio-option.selected{background:#00d67a15;border-color:var(--accent);color:var(--accent)}
.form-row{margin-bottom:12px}
.form-row label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
input[type="text"],input[type="number"],select,textarea{width:100%;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:var(--mono);outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--accent)}
textarea{resize:vertical;min-height:60px}
.btn{padding:8px 16px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;cursor:pointer;transition:all .15s}
.btn:hover{border-color:var(--muted)}
.btn-accent{background:var(--accent);color:#000;border-color:var(--accent);font-weight:600}
.btn-accent:hover{background:var(--accent2)}
.btn-accent:disabled{opacity:.5;cursor:not-allowed}
.btn-sm{padding:4px 10px;font-size:12px}
.btn-danger{background:var(--red);color:#fff;border-color:var(--red)}
.badge-in{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:#00d67a15;color:var(--accent)}
.badge-out{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:#ef444415;color:var(--red)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:var(--muted);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--border)}
td{padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
.muted{color:var(--muted)}
.flex-between{display:flex;justify-content:space-between;align-items:center}
.mb8{margin-bottom:8px}
.mb12{margin-bottom:12px}
.copy-btn{background:none;border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;color:var(--muted);cursor:pointer}
.copy-btn:hover{border-color:var(--accent);color:var(--accent)}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:8px;font-size:13px;z-index:999;animation:fadeIn .2s}
.toast-ok{background:#00d67a20;color:var(--accent);border:1px solid #00d67a40}
.toast-err{background:#ef444420;color:var(--red);border:1px solid #ef444440}
@keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;justify-content:center;align-items:center}
.modal-overlay.open{display:flex}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;max-width:420px;width:90%;max-height:80vh;overflow-y:auto}
.modal h3{font-size:16px;margin-bottom:12px}
.modal .actions{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}
.tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:16px}
.tab{padding:10px 20px;cursor:pointer;font-size:13px;font-weight:500;color:var(--muted);border-bottom:2px solid transparent;transition:color .15s,border-color .15s;user-select:none}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-content{display:none}
.tab-content.active{display:block}
.qr-wrap{margin-top:12px;text-align:center}
.qr-wrap svg{max-width:220px}
.thumb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:8px}
.thumb-grid img{width:100%;border-radius:6px;border:1px solid var(--border)}
select{appearance:auto}
input[type="number"]{-moz-appearance:textfield}
input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
</style>
</head>
<body>
<header>
  <h1><span>Paytaca</span> Web</h1>
  <div style="display:flex;align-items:center;gap:10px">
    <span class="badge" :class="state?.network === 'chipnet' ? 'badge-chipnet' : 'badge-mainnet'" x-text="state?.network === 'chipnet' ? 'CHIPNET' : 'MAINNET'" x-cloak></span>
    <button class="btn btn-sm" @click="load()" title="Refresh">&#8635; Refresh</button>
  </div>
</header>

<div class="container" x-data="app()" x-init="init()" x-cloak>
  <div class="tabs">
    <div class="tab" :class="{active: tab==='wallet'}" @click="tab='wallet'">Wallet</div>
    <div class="tab" :class="{active: tab==='swap'}" @click="tab='swap'">Swap</div>
    <div class="tab" :class="{active: tab==='ai'}" @click="tab='ai'">AI</div>
  </div>

  <!-- WALLET TAB -->
  <div class="tab-content" :class="{active: tab==='wallet'}">
    <div class="card">
      <h2>&#128176; Balance</h2>
      <div class="grid grid-2">
        <div class="stat">
          <div class="value" x-text="state ? state.balance.spendableBch + ' BCH' : '\\u2014'"></div>
          <div class="label" x-text="state?.balance?.usd ? '$' + Number(state.balance.usd).toFixed(2) + ' USD' : ''"></div>
        </div>
        <div class="stat">
          <div class="value" x-text="state?.lift?.displayBalance || '\\u2014'"></div>
          <div class="label">LIFT tokens</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>&#129689; Tokens</h2>
      <template x-if="!state?.tokens?.length">
        <div class="empty" x-text="state ? 'No tokens found' : 'Loading\\u2026'"></div>
      </template>
      <template x-for="t in state?.tokens || []" :key="t.category">
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <div>
            <strong x-text="t.symbol || t.name || 'Unknown'"></strong>
            <div class="muted" style="font-size:11px" x-text="t.displayBalance"></div>
          </div>
        </div>
      </template>
    </div>

    <div class="card">
      <h2>&#128229; Receive</h2>
      <div class="radio-group">
        <div class="radio-option" :class="{selected: rcvType==='bch'}" @click="rcvType='bch'; onRcvChange()">BCH</div>
        <div class="radio-option" :class="{selected: rcvType==='token'}" @click="rcvType='token'; onRcvChange()">CashToken</div>
      </div>
      <div class="mb12" x-show="rcvType==='token'">
        <div class="form-row"><label>Token Category ID</label><input type="text" x-model="rcvCategory" @input="onRcvChange()" placeholder="64-char hex category ID"></div>
      </div>
      <div class="form-row">
        <label>Amount (optional)</label>
        <input type="number" x-model="rcvAmount" @input="onRcvChange()" placeholder="0.0" step="any" min="0">
      </div>
      <div>
        <div class="flex-between mb8"><span class="muted" style="font-size:12px">Address</span><button class="copy-btn" @click="copyText(rcvView?.address)">Copy</button></div>
        <div style="word-break:break-all;font-family:var(--mono);font-size:12px;padding:10px;background:var(--surface2);border-radius:6px" x-text="rcvView?.address || 'Loading\\u2026'"></div>
        <div x-show="rcvView?.paymentUri" style="margin-top:8px">
          <div class="flex-between mb8"><span class="muted" style="font-size:12px">Payment URI</span><button class="copy-btn" @click="copyText(rcvView?.paymentUri)">Copy</button></div>
          <div style="word-break:break-all;font-family:var(--mono);font-size:11px;color:var(--muted);padding:8px;background:var(--surface2);border-radius:6px" x-text="rcvView?.paymentUri"></div>
        </div>
        <div class="qr-wrap" x-html="rcvQrSvg"></div>
      </div>
    </div>

    <div class="card">
      <h2>&#128228; Send</h2>
      <div class="radio-group">
        <div class="radio-option" :class="{selected: sendType==='bch'}" @click="sendType='bch'; sendError=''; sendSuccess=''">BCH</div>
        <div class="radio-option" :class="{selected: sendType==='token'}" @click="sendType='token'; sendError=''; sendSuccess=''">CashToken</div>
      </div>
      <div x-show="sendType==='token'">
        <div class="form-row"><label>Token Category ID</label><input type="text" x-model="sendCategory" placeholder="64-char hex category ID"></div>
        <div class="form-row"><label>Token Amount (base units)</label><input type="text" x-model="sendTokenAmount" placeholder="e.g. 1000"></div>
      </div>
      <div x-show="sendType==='bch'">
        <div class="form-row"><label>Amount</label>
          <div style="display:flex;gap:8px">
            <input type="number" x-model="sendAmount" placeholder="0.0" step="any" min="0" style="flex:1">
            <select x-model="sendCurrency" style="width:100px"><option value="bch">BCH</option><option value="sats">sats</option><option value="usd">USD</option></select>
          </div>
        </div>
      </div>
      <div class="form-row"><label>Recipient Address</label><input type="text" x-model="sendAddress" placeholder="bitcoincash:q..."></div>
      <div x-show="sendType==='token' && sendAddress && !isTokenAddr(sendAddress)" style="color:var(--yellow);font-size:12px;margin-bottom:8px">&#9888; Address is not token-aware (z-prefix). Tokens may be lost.</div>
      <div style="color:var(--red);font-size:12px;margin-bottom:8px" x-text="sendError" x-show="sendError"></div>
      <div style="color:var(--accent);font-size:12px;margin-bottom:8px" x-text="sendSuccess" x-show="sendSuccess"></div>
      <button class="btn btn-accent" @click="doSend()">Send</button>
    </div>

    <div class="card">
      <h2 class="flex-between">
        <span>&#128220; History</span>
        <select x-model="histType" @change="loadHistory(1)" style="padding:4px 8px;font-size:12px">
          <option value="all">All</option><option value="incoming">Incoming</option><option value="outgoing">Outgoing</option>
        </select>
      </h2>
      <template x-if="!histRecords.length && histLoading">
        <div class="empty">Loading&hellip;</div>
      </template>
      <template x-if="!histRecords.length && !histLoading">
        <div class="empty">No transactions</div>
      </template>
      <template x-if="histRecords.length">
        <div>
          <table>
            <tr><th>Date</th><th>Type</th><th>Amount</th></tr>
            <template x-for="(r, ri) in histRecords" :key="ri">
              <tr>
                <td style="font-size:11px" x-text="r.date ? new Date(r.date).toLocaleDateString() : ''"></td>
                <td>
                  <span class="badge-in" x-show="r.type==='incoming'">IN</span>
                  <span class="badge-out" x-show="r.type!=='incoming'">OUT</span>
                </td>
                <td style="font-family:var(--mono);font-size:12px"><span x-text="r.amount"></span> <span x-text="r.symbol"></span></td>
              </tr>
            </template>
          </table>
          <div style="display:flex;justify-content:center;gap:8px;margin-top:12px">
            <button class="btn btn-sm" @click="loadHistory(histPage - 1)" x-show="histPage > 1">&laquo; Prev</button>
            <span class="muted" style="font-size:12px;padding:4px">Page <span x-text="histPage"></span> of <span x-text="histNumPages"></span></span>
            <button class="btn btn-sm" @click="loadHistory(histPage + 1)" x-show="histHasNext">Next &raquo;</button>
          </div>
        </div>
      </template>
    </div>
  </div>

  <!-- SWAP TAB -->
  <div class="tab-content" :class="{active: tab==='swap'}">
    <div class="card">
      <h2>&#128260; Cauldron Swap</h2>
      <div style="color:var(--yellow);font-size:13px;margin-bottom:12px" x-show="state?.network === 'chipnet'">Cauldron swaps are only available on mainnet.</div>
      <div class="form-row"><label>Token Category ID</label><input type="text" x-model="swapToken" placeholder="64-char hex category ID"></div>
      <div class="radio-group">
        <div class="radio-option" :class="{selected: swapDir==='sell'}" @click="swapDir='sell'; swapQuoteText=''; pendingSwap=null">Sell Token &rarr; BCH</div>
        <div class="radio-option" :class="{selected: swapDir==='buy'}" @click="swapDir='buy'; swapQuoteText=''; pendingSwap=null">Buy Token &larr; BCH</div>
      </div>
      <div class="form-row"><label x-text="swapDir==='sell' ? 'Token Amount' : 'BCH Amount'"></label><input type="number" x-model="swapAmount" placeholder="0.0" step="any" min="0"></div>
      <div style="color:var(--red);font-size:12px;margin-bottom:8px" x-text="swapError" x-show="swapError"></div>
      <button class="btn btn-accent" @click="doSwapQuote()" :disabled="swapBusy" x-text="swapBusy ? 'Loading...' : 'Get Quote'"></button>
      <div style="margin-top:16px;padding:12px;background:var(--surface2);border-radius:6px" x-show="swapQuoteText">
        <div style="font-size:13px;white-space:pre-line" x-text="swapQuoteText"></div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn" @click="swapQuoteText=''; pendingSwap=null">Cancel</button>
          <button class="btn btn-accent" @click="doSwapExecute()" :disabled="swapExecBusy" x-text="swapExecBusy ? 'Swapping...' : 'Confirm Swap'"></button>
        </div>
      </div>
    </div>
  </div>

  <!-- AI TAB -->
  <div class="tab-content" :class="{active: tab==='ai'}">
    <div class="card">
      <h2>&#9201; Active Credits</h2>
      <template x-if="state?.credits?.totalSeconds">
        <div class="stat">
          <div class="value" x-text="state.credits.formattedRemaining"></div>
          <div class="label"><span x-text="state.credits.usedDisplay"></span> used of <span x-text="state.credits.totalDisplay"></span></div>
        </div>
      </template>
      <template x-if="!state?.credits?.totalSeconds">
        <div class="empty" x-text="state ? 'No active credits' : 'Loading\\u2026'"></div>
      </template>
    </div>

    <div class="card">
      <h2>&#128202; Usage</h2>
      <template x-if="state?.usage?.length">
        <div>
          <table>
            <tr><th>Model</th><th>Status</th><th>Remaining</th></tr>
            <template x-for="(s, i) in state?.usage || []" :key="i">
              <tr>
                <td style="font-size:11px" x-text="s.displayName || s.model || 'Unknown'"></td>
                <td>
                  <span class="badge-in" x-show="s.active">Active</span>
                  <span class="muted" x-show="!s.active">Inactive</span>
                </td>
                <td x-text="fmtDuration(s.remainingSeconds)"></td>
              </tr>
            </template>
          </table>
        </div>
      </template>
      <template x-if="state && !state?.usage?.length">
        <div class="empty">No sessions</div>
      </template>
      <template x-if="!state">
        <div class="empty">Loading&hellip;</div>
      </template>
    </div>

    <div class="card">
      <h2>&#128203; Plans</h2>
      <template x-if="state?.plans?.length">
        <div>
          <table>
            <tr><th>Model</th><th>Duration</th><th>Price (USD)</th><th></th></tr>
            <template x-for="plan in state?.plans || []" :key="plan.modelId">
              <template x-for="tier in plan.tiers || []" :key="tier.minutes">
                <tr>
                  <td style="font-size:11px" x-text="plan.displayName"></td>
                  <td x-text="tier.durationDisplay"></td>
                  <td>
                    <span x-text="'$' + tier.priceUsd.toFixed(2)"></span>
                    <span x-show="state?.liftDiscountPercent" style="color:var(--accent);font-size:10px" x-text="' (' + state.liftDiscountPercent + '% LIFT)'"></span>
                  </td>
                  <td><button class="btn btn-sm btn-accent" @click="startPurchase(plan.modelId, tier.minutes, tier.priceUsd, tier.durationDisplay, plan.displayName || plan.modelId)">Buy</button></td>
                </tr>
              </template>
            </template>
          </table>
        </div>
      </template>
      <template x-if="state && !state?.plans?.length">
        <div class="empty">No plans</div>
      </template>
    </div>

    <div class="card">
      <h2>&#128260; Auto-Refill</h2>
      <template x-if="state?.autoRefill">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong style="color:var(--accent)">Active</strong>
            <div class="muted" style="font-size:12px;margin-top:4px">
              Model: <span x-text="state.autoRefill.model"></span><br>
              Every: <span x-text="state.autoRefill.minutes"></span> min<br>
              Max: <span x-text="state.autoRefill.maxMinutes || '\\u221e'"></span> min total<br>
              Remaining budget: <span x-text="fmtDuration((state.autoRefill.remainingMinutes || 0) * 60)"></span>
            </div>
          </div>
          <button class="btn btn-sm btn-danger" @click="toggleRefill(false)">Disable</button>
        </div>
      </template>
      <template x-if="state && !state?.autoRefill">
        <div>
          <div style="color:var(--muted);font-size:13px">Auto-refill is disabled.<br>Configure below to enable.</div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <select x-model="refillModel" style="flex:1;min-width:140px">
              <option value="">Select model</option>
              <template x-for="p in state?.plans || []" :key="p.modelId">
                <option :value="p.modelId" x-text="p.displayName || p.modelId"></option>
              </template>
            </select>
            <input type="number" x-model="refillMinutes" placeholder="Minutes" style="width:100px" value="30">
            <input type="number" x-model="refillMax" placeholder="Max total" style="width:100px">
            <select x-model="refillPayMethod" style="width:80px">
              <option value="bch">BCH</option>
              <option value="lift">LIFT</option>
            </select>
            <button class="btn btn-sm btn-accent" @click="toggleRefill(true)">Enable</button>
          </div>
        </div>
      </template>
      <template x-if="!state">
        <div class="empty">Loading&hellip;</div>
      </template>
    </div>

    <div class="card">
      <h2>&#127912; Image Generation</h2>
      <div class="form-row"><label>Prompt</label><textarea x-model="imgPrompt" placeholder="Describe the image..."></textarea></div>
      <template x-if="state?.imageModels?.length">
        <div class="form-row"><label>Model</label>
          <select x-model="imgModel">
            <template x-for="m in state?.imageModels || []" :key="m.id">
              <option :value="m.id" x-text="m.name || m.id"></option>
            </template>
          </select>
        </div>
      </template>
      <div style="display:flex;gap:8px;margin-top:8px">
        <select x-model="imgAspect" style="width:120px">
          <option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="4:3">4:3</option><option value="3:4">3:4</option>
        </select>
        <select x-model="imgQuality" style="width:100px">
          <option value="standard">Standard</option><option value="hd">HD</option>
        </select>
      </div>
      <button class="btn btn-accent" style="margin-top:12px" @click="doImageQuote()">Generate</button>
      <template x-if="state?.imageModels?.length">
        <div style="margin-top:16px">
          <h3 style="font-size:13px;margin-bottom:8px">Recent Images</h3>
          <div class="thumb-grid">
            <template x-for="h in (state?.imageHistory || []).filter(h => h.status === 'completed' && h.filepath)" :key="h.id">
              <img :src="'/api/ai/images/' + h.id + '/file?token=' + token" alt="Generated" loading="lazy">
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>
</div>

<!-- Purchase modal -->
<div class="modal-overlay" :class="{open: showPurchaseModal}" @click.self="showPurchaseModal=false">
  <div class="modal">
    <h3>Confirm Purchase</h3>
    <div style="font-size:13px;line-height:1.8">
      <strong x-text="pendingPurchase?.displayName"></strong><br>
      Duration: <span x-text="pendingPurchase?.durationDisplay"></span><br>
      Price: $<span x-text="pendingPurchase?.priceUsd"></span>
    </div>
    <div class="actions">
      <button class="btn" @click="showPurchaseModal=false">Cancel</button>
      <button class="btn btn-accent" @click="confirmPurchase()" :disabled="purchaseBusy" x-text="purchaseBusy ? 'Paying...' : 'Confirm & Pay'"></button>
    </div>
  </div>
</div>

<!-- Send confirm modal -->
<div class="modal-overlay" :class="{open: showSendModal}" @click.self="showSendModal=false">
  <div class="modal">
    <h3>Confirm Send</h3>
    <template x-if="pendingSend?.type === 'bch'">
      <div style="font-size:13px;line-height:1.8">
        <strong>Send BCH</strong><br>
        Address: <span style="font-family:var(--mono);word-break:break-all" x-text="pendingSend?.address"></span><br>
        Amount: <strong><span x-text="pendingSend?.amount"></span> <span x-text="pendingSend?.currency?.toUpperCase()"></span></strong>
      </div>
    </template>
    <template x-if="pendingSend?.type === 'token'">
      <div style="font-size:13px;line-height:1.8">
        <strong>Send Token</strong><br>
        Category: <span style="font-family:var(--mono);font-size:11px" x-text="pendingSend?.category?.slice(0,16) + '...'"></span><br>
        Amount: <strong x-text="pendingSend?.tokenAmount"></strong><br>
        Address: <span style="font-family:var(--mono);word-break:break-all" x-text="pendingSend?.address"></span>
      </div>
    </template>
    <div class="actions">
      <button class="btn" @click="showSendModal=false">Cancel</button>
      <button class="btn btn-accent" @click="confirmSend()" :disabled="sendConfirmBusy" x-text="sendConfirmBusy ? 'Sending...' : 'Confirm & Send'"></button>
    </div>
  </div>
</div>

<!-- Image quote modal -->
<div class="modal-overlay" :class="{open: showImageQuoteModal}" @click.self="showImageQuoteModal=false">
  <div class="modal">
    <h3>Image Quote</h3>
    <div style="font-size:13px;line-height:1.8">
      <strong>Image Quote</strong><br>
      Model: <span x-text="pendingImageQuote?.model || 'default'"></span><br>
      Amount: <span x-text="pendingImageQuote?.amountSats ? (pendingImageQuote.amountSats / 1e8).toFixed(8) + ' BCH' : 'calculating...'"></span><br>
      Order ID: <span style="font-family:var(--mono);font-size:11px" x-text="pendingImageQuote?.orderId || 'pending'"></span>
    </div>
    <div class="actions">
      <button class="btn" @click="showImageQuoteModal=false">Cancel</button>
      <button class="btn btn-accent" @click="confirmImageGen()" :disabled="imgGenBusy" x-text="imgGenBusy ? 'Generating...' : 'Pay & Generate'"></button>
    </div>
  </div>
</div>

<!-- Toast -->
<template x-if="toastVisible">
  <div class="toast" :class="toastOk ? 'toast-ok' : 'toast-err'" x-text="toastMsg"></div>
</template>

<!-- QR code generator (byte mode, ECC-L, v1-10) -->
<script>
var QR = (() => {
  var EC_PARAMS = [[],[26,7,1],[44,10,1],[70,15,1],[100,20,1],[134,26,1],[172,18,2],[196,20,2],[242,24,2],[292,30,2],[346,18,4]];
  var ALIGN_POS = [[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
  var BYTE_CAP = [0,17,32,53,78,106,134,154,192,230,271];
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  var x = 1, i, j;
  for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = (x << 1) ^ (x & 128 ? 0x11D : 0); }
  for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  function gfMul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function rsEncode(data, ecLen) {
    var gen = [1], next, coef;
    for (i = 0; i < ecLen; i++) {
      next = new Array(gen.length + 1).fill(0);
      for (j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= gfMul(gen[j], EXP[i]); }
      gen = next;
    }
    gen.reverse();
    var msg = new Array(data.length + ecLen).fill(0);
    for (i = 0; i < data.length; i++) msg[i] = data[i];
    for (i = 0; i < data.length; i++) {
      coef = msg[i];
      if (coef !== 0) for (j = 1; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
    }
    return msg.slice(data.length);
  }
  function selectVersion(len) { for (var v = 1; v <= 10; v++) if (len <= BYTE_CAP[v]) return v; return -1; }
  function toUtf8Bytes(text) {
    var bytes = [], c;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) { bytes.push(192 | (c >> 6)); bytes.push(128 | (c & 63)); }
      else { bytes.push(224 | (c >> 12)); bytes.push(128 | ((c >> 6) & 63)); bytes.push(128 | (c & 63)); }
    }
    return bytes;
  }
  function encodeData(bytes, version) {
    var params = EC_PARAMS[version], total = params[0], ecPerBlock = params[1], numBlocks = params[2];
    var dataTotal = total - ecPerBlock * numBlocks, countBits = version <= 9 ? 8 : 16;
    var bits = [0, 1, 0, 0], totalBits = dataTotal * 8;
    for (i = countBits - 1; i >= 0; i--) bits.push((bytes.length >> i) & 1);
    for (var k = 0; k < bytes.length; k++) { c = bytes[k]; for (i = 7; i >= 0; i--) bits.push((c >> i) & 1); }
    for (i = 0; i < 4 && bits.length < totalBits; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    while (bits.length < totalBits) { for (i = 0; i < 8 && bits.length < totalBits; i++) bits.push(0); }
    var codewords = [];
    for (i = 0; i < bits.length; i += 8) { var v = 0; for (j = 0; j < 8; j++) v = (v << 1) | (bits[i + j] || 0); codewords.push(v); }
    return codewords;
  }
  function buildAndInterleave(codewords, version) {
    var params = EC_PARAMS[version], total = params[0], ecPerBlock = params[1], numBlocks = params[2];
    var dataTotal = total - ecPerBlock * numBlocks, dataPerBlock = Math.floor(dataTotal / numBlocks);
    var longBlocks = dataTotal - dataPerBlock * numBlocks, blocks = [], off = 0, result = [];
    for (i = 0; i < numBlocks; i++) {
      var len = dataPerBlock + (i < longBlocks ? 1 : 0);
      var data = codewords.slice(off, off + len); off += len;
      blocks.push({ data: data, ec: rsEncode(data, ecPerBlock) });
    }
    var maxData = Math.max.apply(null, blocks.map(function(b) { return b.data.length; }));
    for (i = 0; i < maxData; i++) for (j = 0; j < blocks.length; j++) if (i < blocks[j].data.length) result.push(blocks[j].data[i]);
    for (i = 0; i < ecPerBlock; i++) for (j = 0; j < blocks.length; j++) if (i < blocks[j].ec.length) result.push(blocks[j].ec[i]);
    return result;
  }
  function createMatrix(version) {
    var size = version * 4 + 17;
    var mod = [], res = [];
    for (i = 0; i < size; i++) { mod.push(new Int8Array(size)); res.push(new Uint8Array(size)); }
    return { size: size, mod: mod, res: res };
  }
  function placeFinder(m, r0, c0) {
    var mr, mc, dark;
    for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
      mr = r0 + r; mc = c0 + c;
      if (mr < 0 || mr >= m.size || mc < 0 || mc >= m.size) continue;
      dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      m.mod[mr][mc] = dark ? 1 : -1; m.res[mr][mc] = 1;
    }
  }
  function placeAlignment(m, cr, cc) {
    var dark;
    for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++) {
      dark = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
      m.mod[cr + r][cc + c] = dark ? 1 : -1; m.res[cr + r][cc + c] = 1;
    }
  }
  function placeAll(m, version) {
    placeFinder(m, 0, 0); placeFinder(m, 0, m.size - 7); placeFinder(m, m.size - 7, 0);
    var v;
    for (i = 8; i < m.size - 8; i++) { v = (i & 1) ? -1 : 1; if (!m.res[6][i]) { m.mod[6][i] = v; m.res[6][i] = 1; } if (!m.res[i][6]) { m.mod[i][6] = v; m.res[i][6] = 1; } }
    var ap = ALIGN_POS[version];
    if (ap.length) for (var ai = 0; ai < ap.length; ai++) for (var aj = 0; aj < ap.length; aj++) { if (!m.res[ap[ai]][ap[aj]]) placeAlignment(m, ap[ai], ap[aj]); }
    m.mod[m.size - 8][8] = 1; m.res[m.size - 8][8] = 1;
    for (i = 0; i <= 8; i++) { m.res[8][i] = 1; m.res[i][8] = 1; if (m.size - 1 - i >= 0) { m.res[8][m.size - 1 - i] = 1; m.res[m.size - 1 - i][8] = 1; } }
  }
  function placeData(m, data) {
    var bits = [], idx = 0, up = true, row, c, dc;
    for (i = 0; i < data.length; i++) { var b = data[i]; for (j = 7; j >= 0; j--) bits.push((b >> j) & 1); }
    for (var col = m.size - 1; col >= 0; col -= 2) {
      if (col === 6) col--;
      for (i = 0; i < m.size; i++) { row = up ? m.size - 1 - i : i; for (dc = 0; dc <= 1; dc++) { c = col - dc; if (c >= 0 && c < m.size && !m.res[row][c]) { m.mod[row][c] = idx < bits.length ? bits[idx] : 0; idx++; } } }
      up = !up;
    }
  }
  function applyMask(m, mask) {
    var out = [], flip;
    for (i = 0; i < m.size; i++) { out.push(new Int8Array(m.mod[i])); }
    for (var r = 0; r < m.size; r++) for (var c = 0; c < m.size; c++) {
      if (m.res[r][c]) continue;
      flip = false;
      if (mask === 0) flip = (r + c) % 2 === 0;
      else if (mask === 1) flip = r % 2 === 0;
      else if (mask === 2) flip = c % 3 === 0;
      else if (mask === 3) flip = (r + c) % 3 === 0;
      else if (mask === 4) flip = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      else if (mask === 5) flip = (r * c) % 2 + (r * c) % 3 === 0;
      else if (mask === 6) flip = ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      else flip = ((r + c) % 2 + (r * c) % 3) % 2 === 0;
      if (flip) out[r][c] = out[r][c] ? 0 : 1;
    }
    return out;
  }
  function computeFormatBits(mask) {
    var data = (1 << 3) | mask, rem = data << 10;
    for (i = 4; i >= 0; i--) if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
    return ((data << 10) | rem) ^ 0x5412;
  }
  function placeFormat(mod, size, mask) {
    var fmt = computeFormatBits(mask);
    var p1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    var p2 = [[size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]];
    for (i = 0; i < 15; i++) { var b = (fmt >> (14 - i)) & 1; mod[p1[i][0]][p1[i][1]] = b; mod[p2[i][0]][p2[i][1]] = b; }
  }
  function penalty(mod, size) {
    var score = 0, run, v, dark = 0;
    for (var r = 0; r < size; r++) { run = 1; for (var c = 1; c < size; c++) { if (mod[r][c] === mod[r][c-1]) run++; else { if (run >= 5) score += run - 2; run = 1; } } if (run >= 5) score += run - 2; }
    for (var c2 = 0; c2 < size; c2++) { run = 1; for (var r2 = 1; r2 < size; r2++) { if (mod[r2][c2] === mod[r2-1][c2]) run++; else { if (run >= 5) score += run - 2; run = 1; } } if (run >= 5) score += run - 2; }
    for (r = 0; r < size-1; r++) for (c2 = 0; c2 < size-1; c2++) { v = mod[r][c2]; if (v === mod[r][c2+1] && v === mod[r+1][c2] && v === mod[r+1][c2+1]) score += 3; }
    for (r = 0; r < size; r++) for (c2 = 0; c2 <= size-7; c2++) { if (mod[r][c2]===1&&mod[r][c2+1]===0&&mod[r][c2+2]===1&&mod[r][c2+3]===1&&mod[r][c2+4]===1&&mod[r][c2+5]===0&&mod[r][c2+6]===1) score+=40; }
    for (c2 = 0; c2 < size; c2++) for (r = 0; r <= size-7; r++) { if (mod[r][c2]===1&&mod[r+1][c2]===0&&mod[r+2][c2]===1&&mod[r+3][c2]===1&&mod[r+4][c2]===1&&mod[r+5][c2]===0&&mod[r+6][c2]===1) score+=40; }
    for (r = 0; r < size; r++) for (c2 = 0; c2 < size; c2++) if (mod[r][c2]===1) dark++;
    var pct = dark * 100 / (size * size), p5 = Math.floor(pct / 5) * 5;
    score += Math.min(Math.abs(p5 - 50), Math.abs(p5 + 5 - 50)) / 5 * 10;
    return score;
  }
  function encode(text) {
    var bytes = toUtf8Bytes(text), version = selectVersion(bytes.length);
    if (version < 0) throw new Error('Text too long for QR code');
    var cw = encodeData(bytes, version), interleaved = buildAndInterleave(cw, version);
    var m = createMatrix(version); placeAll(m, version); placeData(m, interleaved);
    var bestMask = 0, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var masked = applyMask(m, mask); placeFormat(masked, m.size, mask);
      var s = penalty(masked, m.size);
      if (s < bestScore) { bestScore = s; bestMask = mask; }
    }
    var final_ = applyMask(m, bestMask); placeFormat(final_, m.size, bestMask);
    return { matrix: final_, size: m.size };
  }
  function toSVG(qr, ms) {
    ms = ms || 4; var px = qr.size * ms, d = '';
    for (var r = 0; r < qr.size; r++) for (var c = 0; c < qr.size; c++) if (qr.matrix[r][c] === 1) d += 'M' + (c*ms) + ',' + (r*ms) + 'h' + ms + 'v' + ms + 'h' + (-ms) + 'z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (px+ms*2) + ' ' + (px+ms*2) + '" width="' + (px+ms*2) + '" height="' + (px+ms*2) + '"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  return { encode: encode, toSVG: toSVG };
})();
</script>

<!-- Alpine app -->
<script>
document.addEventListener('alpine:init', function() {
  Alpine.data('app', function() {
    return {
      token: new URLSearchParams(window.location.search).get('token') || '',
      tab: 'wallet',
      state: null,

      rcvType: 'bch',
      rcvCategory: '',
      rcvAmount: '',
      rcvView: null,
      rcvQrSvg: '',

      sendType: 'bch',
      sendAmount: '',
      sendCurrency: 'bch',
      sendAddress: '',
      sendCategory: '',
      sendTokenAmount: '',
      sendError: '',
      sendSuccess: '',
      pendingSend: null,

      histType: 'all',
      histRecords: [],
      histPage: 1,
      histNumPages: 1,
      histHasNext: false,
      histLoading: false,

      swapToken: '',
      swapDir: 'sell',
      swapAmount: '',
      swapError: '',
      swapQuoteText: '',
      swapBusy: false,
      swapExecBusy: false,
      pendingSwap: null,

      pendingPurchase: null,
      purchaseBusy: false,
      showPurchaseModal: false,

      showSendModal: false,
      sendConfirmBusy: false,

      pendingImageQuote: null,
      showImageQuoteModal: false,
      imgGenBusy: false,

      refillModel: '',
      refillMinutes: '30',
      refillMax: '',
      refillPayMethod: 'bch',

      imgPrompt: '',
      imgModel: '',
      imgAspect: '1:1',
      imgQuality: 'standard',

      toastVisible: false,
      toastMsg: '',
      toastOk: true,

      async init() {
        try {
          this.state = await this.api('GET', '/api/wallet/state');
          this.onRcvChange();
          this.loadHistory(1);
        } catch (e) { this.toast(e.message, true); }
      },

      async load() {
        try {
          this.state = await this.api('GET', '/api/wallet/state');
          this.onRcvChange();
          this.loadHistory(this.histPage);
        } catch (e) { this.toast(e.message, true); }
      },

      async api(method, apipath, body) {
        var opts = { method: method, headers: { 'X-Paytaca-Token': this.token, 'Accept': 'application/json' } };
        if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        var res = await fetch(apipath, opts);
        if (!res.ok) { var msg = 'Request failed (' + res.status + ')'; try { var j = await res.json(); if (j.error) msg = j.error; } catch(ex) {} throw new Error(msg); }
        return res.json();
      },

      fmtDuration(s) {
        if (!s || s <= 0) return '0m';
        var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        return h ? h + 'h ' + m + 'm' : m + 'm';
      },

      isTokenAddr(addr) {
        return addr && /^bitcoincash:z/.test(addr);
      },

      toast(msg, isErr) {
        this.toastMsg = msg;
        this.toastOk = !isErr;
        this.toastVisible = true;
        var self = this;
        setTimeout(function() { self.toastVisible = false; }, 3000);
      },

      copyText(text) {
        if (text) { navigator.clipboard.writeText(text); this.toast('Copied!'); }
      },

      async onRcvChange() {
        this.rcvView = null;
        this.rcvQrSvg = '';
        var params = new URLSearchParams();
        if (this.rcvType === 'token' && this.rcvCategory) {
          params.set('category', this.rcvCategory);
          params.set('token', '1');
        }
        if (this.rcvAmount) params.set('amount', this.rcvAmount);
        try {
          var view = await this.api('GET', '/api/wallet/receive?' + params.toString());
          this.rcvView = view;
          if (view.address) {
            try { this.rcvQrSvg = QR.toSVG(QR.encode(view.address)); } catch(ex) {}
          }
        } catch (e) { this.rcvView = { address: 'Error: ' + e.message }; }
      },

      doSend() {
        this.sendError = '';
        this.sendSuccess = '';
        var address = (this.sendAddress || '').trim();
        if (!address) { this.sendError = 'Enter a recipient address'; return; }
        if (this.sendType === 'bch') {
          var amount = parseFloat(this.sendAmount);
          var currency = this.sendCurrency;
          if (!amount || amount <= 0) { this.sendError = 'Enter a valid amount'; return; }
          this.pendingSend = { type: 'bch', address: address, amount: amount, currency: currency };
          this.showSendModal = true;
        } else {
          var category = (this.sendCategory || '').trim();
          var tokenAmount = (this.sendTokenAmount || '').trim();
          if (!category || !/^[a-fA-F0-9]{64}$/.test(category)) { this.sendError = 'Enter a valid 64-char hex category ID'; return; }
          if (!tokenAmount) { this.sendError = 'Enter a token amount'; return; }
          this.pendingSend = { type: 'token', category: category, tokenAmount: tokenAmount, address: address };
          this.showSendModal = true;
        }
      },

      async confirmSend() {
        if (!this.pendingSend) return;
        this.sendConfirmBusy = true;
        try {
          var result;
          if (this.pendingSend.type === 'bch') {
            result = await this.api('POST', '/api/wallet/send', this.pendingSend);
          } else {
            result = await this.api('POST', '/api/wallet/send-token', { category: this.pendingSend.category, amount: this.pendingSend.tokenAmount, address: this.pendingSend.address });
          }
          this.showSendModal = false;
          if (result.success) {
            this.sendSuccess = 'Sent! TX: ' + (result.txid || '').slice(0, 16) + '...';
            this.toast('Transaction sent');
            this.load();
          } else {
            this.sendError = result.error || 'Send failed';
          }
        } catch (e) { this.sendError = e.message; }
        this.sendConfirmBusy = false;
        this.pendingSend = null;
      },

      async loadHistory(page) {
        this.histPage = page || 1;
        this.histLoading = true;
        this.histRecords = [];
        try {
          var data = await this.api('GET', '/api/wallet/history?page=' + this.histPage + '&type=' + this.histType);
          this.histRecords = data.records || [];
          this.histNumPages = data.numPages || 1;
          this.histHasNext = !!data.hasNext;
        } catch (e) { this.histRecords = []; }
        this.histLoading = false;
      },

      async doSwapQuote() {
        var tokenId = (this.swapToken || '').trim();
        var amount = (this.swapAmount || '').trim();
        this.swapError = '';
        if (!tokenId || !/^[a-fA-F0-9]{64}$/.test(tokenId)) { this.swapError = 'Enter a valid 64-char hex token ID'; return; }
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) { this.swapError = 'Enter a valid amount'; return; }
        this.swapBusy = true;
        try {
          var q = await this.api('POST', '/api/swap/quote', { tokenId: tokenId, direction: this.swapDir, amount: amount });
          this.pendingSwap = { tokenId: tokenId, direction: this.swapDir, amount: amount };
          var text = q.formatted || '';
          if (!text) {
            text = 'Rate: ' + (q.rate || '?') + '\\nToken: ' + q.tokenAmount + ' ' + (q.symbol || '') + '\\nBCH: ' + (Number(q.bchAmountSats) / 1e8).toFixed(8) + ' BCH\\nTrade fee: ' + (Number(q.tradeFeeSats) / 1e8).toFixed(8) + ' BCH';
            if (q.platformFeeSats) text += '\\nPlatform fee: ' + (Number(q.platformFeeSats) / 1e8).toFixed(8) + ' BCH';
          }
          this.swapQuoteText = text;
        } catch (e) { this.swapError = e.message; }
        this.swapBusy = false;
      },

      async doSwapExecute() {
        if (!this.pendingSwap) return;
        this.swapExecBusy = true;
        try {
          var result = await this.api('POST', '/api/swap/execute', this.pendingSwap);
          if (result.success) {
            this.toast('Swap executed! TX: ' + (result.txid || '').slice(0, 16) + '...');
            this.swapQuoteText = '';
            this.pendingSwap = null;
            this.load();
          } else {
            this.swapError = result.error || 'Swap failed';
          }
        } catch (e) { this.swapError = e.message; }
        this.swapExecBusy = false;
      },

      startPurchase(model, minutes, priceUsd, durationDisplay, displayName) {
        this.pendingPurchase = { model: model, minutes: minutes, priceUsd: priceUsd, durationDisplay: durationDisplay, displayName: displayName };
        this.showPurchaseModal = true;
      },

      async confirmPurchase() {
        if (!this.pendingPurchase) return;
        this.purchaseBusy = true;
        try {
          await this.api('POST', '/api/ai/purchase', { model: this.pendingPurchase.model, minutes: this.pendingPurchase.minutes, method: 'bch' });
          this.showPurchaseModal = false;
          this.toast('Plan purchased!');
          this.load();
        } catch (e) { this.toast(e.message, true); }
        this.purchaseBusy = false;
        this.pendingPurchase = null;
      },

      async toggleRefill(enable) {
        try {
          if (enable) {
            var model = this.refillModel;
            var minutes = parseInt(this.refillMinutes) || 30;
            var maxMinutes = this.refillMax ? parseInt(this.refillMax) : undefined;
            var paymentMethod = this.refillPayMethod || 'bch';
            if (!model) { this.toast('Select a model', true); return; }
            await this.api('POST', '/api/ai/auto-refill', { enabled: true, model: model, minutes: minutes, maxMinutes: maxMinutes, paymentMethod: paymentMethod });
            this.toast('Auto-refill enabled');
          } else {
            await this.api('POST', '/api/ai/auto-refill', { enabled: false });
            this.toast('Auto-refill disabled');
          }
          this.load();
        } catch (e) { this.toast(e.message, true); }
      },

      async doImageQuote() {
        var prompt = (this.imgPrompt || '').trim();
        if (!prompt) { this.toast('Enter a prompt', true); return; }
        try {
          var quote = await this.api('POST', '/api/ai/images/quote', {
            prompt: prompt,
            model: this.imgModel || undefined,
            aspectRatio: this.imgAspect,
            quality: this.imgQuality,
          });
          this.pendingImageQuote = quote;
          this.showImageQuoteModal = true;
        } catch (e) { this.toast(e.message, true); }
      },

      async confirmImageGen() {
        if (!this.pendingImageQuote) return;
        this.imgGenBusy = true;
        try {
          var result = await this.api('POST', '/api/ai/images/fulfill', { orderId: this.pendingImageQuote.orderId });
          this.showImageQuoteModal = false;
          if (result.filepath) this.toast('Image saved!');
          this.load();
        } catch (e) { this.toast(e.message, true); }
        this.imgGenBusy = false;
        this.pendingImageQuote = null;
      },
    };
  });
});
</script>

<!-- Alpine.js (vendored) -->
<script defer>${ALPINE_JS}</script>
</body>
</html>`;
}
