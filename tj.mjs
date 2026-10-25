#!/usr/bin/env node
/** Trading Journal CLI for Termux / Node.js 18+. No third-party dependencies. */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const API = (process.env.TJ_API_URL || 'https://tradingjurnal.yangsudahbolehpulang.workers.dev').replace(/\/$/, '');
const CONFIG_DIR = path.join(os.homedir(), '.config', 'trading-journal');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const rl = readline.createInterface({ input, output, terminal: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const money = n => Number(n || 0).toLocaleString('en-US', {maximumFractionDigits: 2});

async function readConfig() { try { return JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')); } catch { return {}; } }
async function saveConfig(c) { await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 }); await fs.writeFile(CONFIG_FILE, JSON.stringify(c, null, 2), { mode: 0o600 }); try { await fs.chmod(CONFIG_DIR, 0o700); await fs.chmod(CONFIG_FILE, 0o600); } catch {} }
async function api(route, options = {}, auth = true) {
  const cfg = await readConfig();
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (auth && cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  let res;
  try { res = await fetch(`${API}${route}`, { ...options, headers }); }
  catch (e) { throw new Error(`Tidak bisa menghubungi Worker. Periksa internet dan URL API. (${e.message})`); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? `${data.error}${data.detail ? ` — ${data.detail}` : ''}` : `HTTP ${res.status}`);
  return data;
}
function line() { console.log('────────────────────────────────────────'); }
async function ask(label, example, def = '') {
  const suffix = def !== '' ? ` [${def}]` : '';
  const value = (await rl.question(`${label}${example ? ` (contoh: ${example})` : ''}${suffix}\n> `)).trim();
  return value || String(def);
}
async function askNumber(label, example, def = '') {
  while (true) { const raw = await ask(label, example, def); if (raw === '' && def === '') return undefined; const n = Number(raw.replace(',', '.')); if (Number.isFinite(n)) return n; console.log('Angka belum valid. Contoh pengisian: 24500 atau 20.57'); }
}
async function askChoice(label, choices, def) {
  while (true) { const raw = (await ask(`${label} — pilihan: ${choices.join('/')}`, choices.join(' / '), def)).toUpperCase(); if (choices.includes(raw)) return raw; console.log(`Pilih salah satu: ${choices.join(', ')}`); }
}
async function ensureLogin() { const cfg = await readConfig(); if (!cfg.token) throw new Error('Kamu belum login. Jalankan: node tj.mjs login'); return cfg; }
async function getTrades() { const d = await api('/api/trades', {}, false); return Array.isArray(d.trades) ? d.trades : []; }
async function putTrades(trades) { await api('/api/trades', { method: 'PUT', body: JSON.stringify({ trades }) }); }
function idShort(t) { return String(t.id || '').slice(0, 8); }
function showTrades(trades) {
  if (!trades.length) { console.log('Belum ada jurnal. Jalankan: node tj.mjs add'); return; }
  line(); console.log('ID       | TANGGAL          | SYMBOL   | ARAH  | P&L'); line();
  for (const t of trades) console.log(`${idShort(t).padEnd(8)} | ${String(t.date||'-').slice(0,16).padEnd(16)} | ${String(t.symbol||'-').slice(0,8).padEnd(8)} | ${String(t.side||'-').padEnd(5)} | ${t.currency||'USD'} ${money(t.pnl)}`);
  line(); console.log(`Total ${trades.length} trade. Untuk detail: node tj.mjs show ID`);
}
async function login() {
  console.log('\nLOGIN TRADING JOURNAL — GITHUB DEVICE FLOW');
  const d = await api('/auth/cli/device', { method: 'POST', body: '{}' }, false);
  console.log(`\n1. Buka: ${d.verification_uri}`); console.log(`2. Masukkan kode ini: ${d.user_code}`); console.log('3. Login dengan akun GitHub pemilik jurnal dan setujui akses.');
  try { const child = spawn('termux-open-url', [d.verification_uri], { stdio: 'ignore', detached: true }); child.on('error', () => {}); child.unref(); } catch {}
  console.log('\nMenunggu konfirmasi GitHub... (Ctrl+C untuk membatalkan)');
  const started = Date.now(); let interval = Math.max(5, Number(d.interval || 5)) * 1000;
  while (Date.now() - started < Number(d.expires_in || 900) * 1000) {
    await sleep(interval);
    try {
      const r = await api('/auth/cli/poll', { method: 'POST', body: JSON.stringify({ device_code: d.device_code }) }, false);
      if (r.pending) { interval = Math.max(interval, Number(r.interval || 5) * 1000); output.write('.'); continue; }
      if (r.ok && r.token) { await saveConfig({ token: r.token, login: r.login, api: API, savedAt: new Date().toISOString() }); console.log(`\n\nLogin berhasil sebagai @${r.login}.`); console.log('Sesi berlaku sekitar 8 jam. Token disimpan lokal dengan izin file terbatas.'); return; }
    } catch (e) { if (/authorization_pending|slow_down/.test(e.message)) continue; throw e; }
  }
  throw new Error('Kode login kedaluwarsa. Jalankan kembali: node tj.mjs login');
}
async function status() {
  const h = await api('/api/health', {}, false); console.log(`Worker: ${h.ok ? 'ONLINE' : 'TIDAK SIAP'} (${h.service || 'unknown'})`);
  const cfg = await readConfig(); if (!cfg.token) { console.log('Login: belum login'); return; }
  try { const m = await api('/auth/me'); console.log(`Login: ${m.isOwner ? 'aktif' : 'tidak valid'}${m.login ? ` sebagai @${m.login}` : ''}`); }
  catch (e) { console.log(`Login: tidak dapat diverifikasi (${e.message})`); }
}
async function add() {
  await ensureLogin(); console.log('\nTAMBAH JURNAL BARU'); console.log('Isi jawaban setelah tanda >. Tekan Enter untuk nilai default jika tersedia.'); line();
  const date = await ask('Date / tanggal dan jam', '2026-10-25T14:30', today());
  const symbol = await ask('Symbol', 'NAS100'); if (!symbol) throw new Error('Symbol wajib diisi.');
  const side = await askChoice('Direction / arah', ['LONG','SHORT'], 'LONG');
  const setup = await ask('Setup / strategi', 'Breakout retest');
  const entry = await askNumber('Entry price', '24500');
  const exit = await askNumber('Exit price', '24600 (kosongkan jika posisi masih terbuka)');
  const size = await ask('Lot size / ukuran posisi', '0.10');
  const risk = await askNumber('Risk / risiko uang', '10');
  const pnl = await askNumber('P&L / hasil uang (boleh minus)', '20.57', '0');
  const currency = await ask('Currency / mata uang', 'USD', 'USD');
  const fees = await askNumber('Fees / biaya', '0', '0');
  const statusVal = await askChoice('Status posisi', ['CLOSED','OPEN'], exit === undefined ? 'OPEN' : 'CLOSED');
  const riskR = await askNumber('Risk-reward (R)', '2 berarti hasil 2R');
  const mood = await ask('Emotion / emosi', 'Calm / Tenang');
  const notes = await ask('Notes / catatan', 'Entry sesuai SOP pada timeframe M15');
  const review = await ask('Review / pelajaran', 'Tunggu konfirmasi sebelum entry');
  const trade = { id: globalThis.crypto?.randomUUID?.() || `tj-${Date.now()}-${Math.random().toString(16).slice(2)}`, date, symbol: symbol.toUpperCase(), side, setup, ...(entry !== undefined ? {entry} : {}), ...(exit !== undefined ? {exit} : {}), ...(size ? {size} : {}), ...(risk !== undefined ? {risk} : {}), pnl: pnl ?? 0, currency: currency || 'USD', fees: fees ?? 0, status: statusVal, ...(riskR !== undefined ? {riskR} : {}), ...(mood ? {mood} : {}), ...(notes ? {notes} : {}), ...(review ? {review} : {}), updatedAt: new Date().toISOString() };
  line(); console.log('Ringkasan:'); console.log(`${trade.date} | ${trade.symbol} | ${trade.side} | ${trade.currency} ${trade.pnl} | ${trade.status}`);
  const confirm = (await ask('Simpan jurnal ini? ketik YA untuk menyimpan', 'YA / TIDAK', 'YA')).toUpperCase();
  if (!['YA','Y','YES'].includes(confirm)) { console.log('Dibatalkan; tidak ada data yang disimpan.'); return; }
  const trades = await getTrades(); trades.push(trade); await putTrades(trades); console.log(`\n✓ Jurnal tersimpan. ID: ${trade.id}`); console.log('✓ Website akan menampilkan data setelah jurnal dimuat ulang.');
}
async function showOne(id) {
  const trades = await getTrades(); const t = trades.find(x => x.id === id || idShort(x) === id);
  if (!t) throw new Error(`Trade ID '${id}' tidak ditemukan. Jalankan node tj.mjs list`);
  line(); for (const [k,v] of Object.entries(t)) console.log(`${k.padEnd(12)}: ${v ?? ''}`); line();
}
async function edit(id) {
  await ensureLogin(); const trades = await getTrades(); const i = trades.findIndex(x => x.id === id || idShort(x) === id); if (i < 0) throw new Error('ID tidak ditemukan. Lihat ID melalui node tj.mjs list');
  const old = trades[i]; console.log(`\nEDIT TRADE ${old.id}\nTekan Enter untuk mempertahankan nilai lama.`); line();
  const symbol = await ask('Symbol', 'NAS100', old.symbol); const side = await askChoice('Direction', ['LONG','SHORT'], old.side);
  const date = await ask('Date', '2026-10-25T14:30', old.date); const setup = await ask('Setup', 'Breakout retest', old.setup || '');
  const entry = await askNumber('Entry', '24500', old.entry ?? ''); const exit = await askNumber('Exit', '24600', old.exit ?? '');
  const size = await ask('Lot size', '0.10', old.size ?? ''); const risk = await askNumber('Risk', '10', old.risk ?? '');
  const pnl = await askNumber('P&L', '20.57 atau -10', old.pnl ?? 0); const currency = await ask('Currency', 'USD', old.currency || 'USD');
  const fees = await askNumber('Fees', '0', old.fees ?? 0); const statusVal = await askChoice('Status', ['CLOSED','OPEN'], old.status || 'CLOSED');
  const riskR = await askNumber('Risk-reward (R)', '2', old.riskR ?? ''); const mood = await ask('Emotion', 'Calm', old.mood || '');
  const notes = await ask('Notes', 'Entry sesuai SOP', old.notes || ''); const review = await ask('Review', 'Tunggu konfirmasi', old.review || '');
  trades[i] = {...old, date, symbol: symbol.toUpperCase(), side, setup, ...(entry !== undefined ? {entry} : {}), ...(exit !== undefined ? {exit} : {}), size, ...(risk !== undefined ? {risk} : {}), pnl: pnl ?? 0, currency, fees: fees ?? 0, status: statusVal, ...(riskR !== undefined ? {riskR} : {}), mood, notes, review, updatedAt: new Date().toISOString()};
  await putTrades(trades); console.log('✓ Perubahan jurnal berhasil disimpan.');
}
async function remove(id) {
  await ensureLogin(); const trades = await getTrades(); const t = trades.find(x => x.id === id || idShort(x) === id); if (!t) throw new Error('ID tidak ditemukan. Lihat daftar dengan node tj.mjs list');
  console.log(`Akan menghapus: ${t.symbol} ${t.side} | P&L ${t.currency||'USD'} ${t.pnl} | ID ${t.id}`);
  const yes = (await ask('Yakin menghapus? ketik HAPUS', 'HAPUS', 'TIDAK')).toUpperCase(); if (yes !== 'HAPUS') { console.log('Dibatalkan.'); return; }
  await putTrades(trades.filter(x => x.id !== t.id)); console.log('✓ Trade dihapus dari jurnal.');
}
async function stats() {
  const trades = (await getTrades()).filter(t => String(t.status || 'CLOSED').toUpperCase() === 'CLOSED');
  if (!trades.length) { console.log('Belum ada trade CLOSED untuk dihitung.'); return; }
  const wins = trades.filter(t => Number(t.pnl) > 0), losses = trades.filter(t => Number(t.pnl) < 0); const total = trades.reduce((s,t)=>s+Number(t.pnl||0),0); const grossWin = wins.reduce((s,t)=>s+Number(t.pnl||0),0); const grossLoss = Math.abs(losses.reduce((s,t)=>s+Number(t.pnl||0),0));
  console.log('\nSTATISTIK JURNAL (CLOSED)'); line(); console.log(`Jumlah trade : ${trades.length}`); console.log(`Win          : ${wins.length}`); console.log(`Loss         : ${losses.length}`); console.log(`Win rate     : ${(wins.length/trades.length*100).toFixed(1)}%`); console.log(`Net P&L      : ${trades[0]?.currency||'USD'} ${money(total)}`); console.log(`Profit factor : ${grossLoss ? (grossWin/grossLoss).toFixed(2) : (grossWin ? '∞' : '—')}`); line();
}
async function main() {
  const [cmd = 'help', arg] = process.argv.slice(2);
  try {
    switch (cmd.toLowerCase()) {
      case 'login': await login(); break;
      case 'logout': await saveConfig({}); console.log('Token lokal dihapus.'); break;
      case 'status': await status(); break;
      case 'add': await add(); break;
      case 'list': showTrades(await getTrades()); break;
      case 'show': if (!arg) throw new Error('Gunakan: node tj.mjs show ID'); await showOne(arg); break;
      case 'edit': if (!arg) throw new Error('Gunakan: node tj.mjs edit ID'); await edit(arg); break;
      case 'delete': if (!arg) throw new Error('Gunakan: node tj.mjs delete ID'); await remove(arg); break;
      case 'stats': await stats(); break;
      case 'help': case '--help': case '-h':
        console.log('\nTRADING JOURNAL CLI'); line(); console.log('node tj.mjs login       Login GitHub pemilik'); console.log('node tj.mjs status      Cek Worker dan sesi login'); console.log('node tj.mjs add         Tambah trade dengan panduan'); console.log('node tj.mjs list        Daftar trade'); console.log('node tj.mjs show ID     Detail trade'); console.log('node tj.mjs edit ID     Edit trade'); console.log('node tj.mjs delete ID   Hapus trade'); console.log('node tj.mjs stats       Statistik trade CLOSED'); console.log('node tj.mjs logout      Hapus token login lokal'); line(); break;
      default: throw new Error(`Perintah '${cmd}' tidak dikenal. Jalankan: node tj.mjs help`);
    }
  } catch (e) { console.error(`\n✗ ${e.message}`); process.exitCode = 1; }
  finally { rl.close(); }
}
await main();
