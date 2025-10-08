require('dotenv').config();
const Discord = require('discord-simple-api');
const fs = require('fs');
const os = require('os');
const path = require('path');
const blessed = require('blessed');
const contrib = require('blessed-contrib');

// ====== CONFIG ======
const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const SEND_AT = (process.env.SEND_AT || '').trim(); // "" = kirim sekarang + tiap 24 jam
if (!TOKEN || !CHANNEL_ID) {
  console.error('Please set BOT_TOKEN and CHANNEL_ID in .env');
  process.exit(1);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DB_PATH = path.join(__dirname, 'gm-stats.json');
global.discordUser = 'loading...';
global.discordGuild = 'fetching...';

// ====== HELPERS ======
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randJitterMs = (base = 250) => Math.floor(base + Math.random() * base); // 250–500ms

// ====== DATA STORE ======
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { firstSentAt: null, lastSentAt: null, totalCount: 0, history: [] }; }
}
function saveDB(db){ fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
function recordSend() {
  const db = loadDB();
  const nowIso = new Date().toISOString();
  if (!db.firstSentAt) db.firstSentAt = nowIso;
  db.lastSentAt = nowIso;
  db.totalCount += 1;
  db.history.push({ ts: nowIso });
  saveDB(db);
}
function formatWIB(iso){
  if(!iso) return '-';
  const d = new Date(iso);
  const w = new Date(d.getTime() + 7*60*60*1000); // UTC+7
  const p = (n)=>String(n).padStart(2,'0');
  return `${w.getUTCFullYear()}-${p(w.getUTCMonth()+1)}-${p(w.getUTCDate())} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())} WIB`;
}

// ====== WIB scheduler ======
function msUntilNextWIB(hhmm) {
  const [hh, mm] = (hhmm || '').split(':').map(Number);
  if (!hhmm || isNaN(hh) || isNaN(mm) || hh<0 || hh>23 || mm<0 || mm>59) return 0;
  const now = new Date(); // UTC
  const wibOffsetMin = 7*60;
  const targetWIBMin = hh*60 + mm;
  const targetUTCMin = (targetWIBMin - wibOffsetMin + 1440) % 1440;
  const target = new Date(now);
  target.setUTCHours(Math.floor(targetUTCMin/60), targetUTCMin%60, 0, 0);
  if (target <= now) target.setUTCDate(target.getUTCDate()+1);
  return target - now;
}

// ====== TUI ======
const screen = blessed.screen({ smartCSR: true, title: 'GMbot by Maskus' });
const color = {
  titleFg: '#00e5ff',
  boxBorder: '#22d3ee',
  label: '#94a3b8',
  value: '#e2e8f0',
  ok: '#22c55e',
  warn: '#fbbf24',
  err: '#ef4444'
};

const title = blessed.box({
  top: 0,
  height: 7,
  width: '100%',
  align: 'center',
  tags: true,
  content: `{bold}{${color.titleFg}-fg}
   ██████╗ ███╗   ███╗██████╗  ██████╗ ████████╗     ██████╗  █████╗ ███╗   ███╗███████╗
  ██╔═══██╗████╗ ████║██╔══██╗██╔═══██╗╚══██╔══╝    ██╔════╝ ██╔══██╗████╗ ████║██╔════╝
  ██║   ██║██╔████╔██║██║  ██║██║   ██║   ██║       ██║  ███╗███████║██╔████╔██║███████╗
  ██║   ██║██║╚██╔╝██║██║  ██║██║   ██║   ██║       ██║   ██║██╔══██║██║╚██╔╝██║╚════██║
  ╚██████╔╝██║ ╚═╝ ██║██████╔╝╚██████╔╝   ██║       ╚██████╔╝██║  ██║██║ ╚═╝ ██║███████║
   ╚═════╝ ╚═╝     ╚═╝╚═════╝  ╚═════╝    ╚═╝        ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝
                               GMbot by Maskus{/}`,
  style: { fg: color.titleFg }
});
screen.append(title);

const grid = new contrib.grid({ rows: 12, cols: 12, screen });
const infoBox = grid.set(7, 0, 5, 6, blessed.box, {
  label: ' Bot / Info ',
  tags: true,
  border: { type: 'line' },
  style: { border: { fg: color.boxBorder } }
});
const logBox = grid.set(7, 6, 5, 6, blessed.log, {
  label: ' System Logs ',
  tags: true,
  border: { type: 'line' },
  style: { border: { fg: color.boxBorder } },
  scrollbar: { ch: ' ', inverse: true },
  mouse: true, keys: true, vi: true
});
const footer = blessed.box({
  bottom: 0, height: 1, width: '100%', align: 'center', tags: true,
  content: '{#94a3b8-fg}Press {bold}Q{/bold} to quit • {bold}L{/bold} to clear logs{/}'
});
screen.append(footer);

function timeNow(){ return new Date().toLocaleTimeString(); }
function logInfo(msg){ logBox.log(`{green-fg}${timeNow()} [INFO]{/} ${msg}`); screen.render(); }
function logWarn(msg){ logBox.log(`{yellow-fg}${timeNow()} [WARN]{/} ${msg}`); screen.render(); }
function logErr(msg){ logBox.log(`{red-fg}${timeNow()} [ERROR]{/} ${msg}`); screen.render(); }

screen.key(['q','C-c'], ()=>process.exit(0));
screen.key(['l','L'], ()=>{ logBox.setContent(''); screen.render(); });

function setInfo(status, nextMs){
  const db = loadDB();
  const ip = (Object.values(os.networkInterfaces()).flat()
    .find(i => i && !i.internal && i.family === 'IPv4') || {}).address || '127.0.0.1';
  const pad = (n)=>String(n).padStart(2,'0');
  let countdown = '-';
  if (typeof nextMs === 'number') {
    if (nextMs < 0) nextMs = 0;
    const h = Math.floor(nextMs/3600000);
    const m = Math.floor((nextMs%3600000)/60000);
    const s = Math.floor((nextMs%60000)/1000);
    countdown = `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  }
  infoBox.setContent(
    `{${color.label}-fg}Username{/}: {${color.value}-fg}${global.discordUser}{/}\n` +
    `{${color.label}-fg}Server{/}:   {${color.value}-fg}${global.discordGuild}{/}\n` +
    `{${color.label}-fg}Total GM{/}: {${color.value}-fg}${db.totalCount}{/}\n` +
    `{${color.label}-fg}Status{/}:   {${(status==='Active'?color.ok:color.warn)}-fg}${status}{/}\n` +
    `{${color.label}-fg}Next Send{/}: {${color.value}-fg}${countdown}{/}\n` +
    `{${color.label}-fg}Last Sent{/}: {${color.value}-fg}${formatWIB(db.lastSentAt)}{/}\n` +
    `{${color.label}-fg}IP Address{/}: {${color.value}-fg}${ip}{/}\n` +
    `{${color.label}-fg}Proxy{/}:   {${color.value}-fg}None{/}`
  );
  screen.render();
}

// ====== BOT ======
const bot = new Discord(TOKEN);

// Dapatkan nama server (guild) dari channel
async function detectGuildName() {
  try {
    const ch = await bot.getChannelInformation(CHANNEL_ID); // butuh guild_id
    const guild = await bot.getGuildInformation(ch.guild_id);
    global.discordGuild = guild.name || 'Unknown';
    logInfo(`Server detected: ${global.discordGuild}`);
    setInfo('Active', 0);
  } catch (e) {
    global.discordGuild = 'Unknown';
    logWarn(`Cannot fetch server name: ${e.message}`);
  }
}

// Kirim dengan retry (patuh rate-limit 429)
async function sendGM() {
  await safeSend('gm');
}
async function safeSend(content) {
  const MAX_TRY = 8;
  let attempt = 0;

  while (attempt < MAX_TRY) {
    attempt++;
    try {
      const sent = await bot.sendMessageToChannel(CHANNEL_ID, content);
      recordSend();
      logInfo(`[Message ${sent.id}] Sent "${content}"`);
      return;
    } catch (e) {
      const status = e?.response?.status || e?.status || 0;

      if (status === 429) {
        const body = e?.response?.data || {};
        const retryAfterSec =
          Number(body.retry_after) ||
          Number(e?.response?.headers?.['retry-after']) ||
          1;
        const waitMs = Math.ceil(retryAfterSec * 1000) + randJitterMs();
        logWarn(`429 rate limited. Waiting ${waitMs}ms (retry_after=${retryAfterSec}s) [attempt ${attempt}/${MAX_TRY}]`);
        await sleep(waitMs);
        continue;
      }

      if (status >= 500 || status === 0) {
        const waitMs = Math.min(60_000, (2 ** attempt) * 200) + randJitterMs();
        logWarn(`Upstream error ${status}. Backing off ${waitMs}ms [attempt ${attempt}/${MAX_TRY}]`);
        await sleep(waitMs);
        continue;
      }

      logErr(`Send failed (status ${status}): ${e.message || e}`);
      return;
    }
  }
  logErr(`Send aborted after ${MAX_TRY} attempts (still failing).`);
}

// ====== MAIN ======
(async () => {
  try {
    const me = await bot.getUserInformation();
    global.discordUser = `${me.username}#${me.discriminator}`;
    logInfo(`Logged in as ${global.discordUser}`);
    await detectGuildName();
  } catch (e) {
    logErr(`Login error: ${e.message}`);
    process.exit(1);
  }

  if (!SEND_AT) {
    const warmup = 500 + Math.floor(Math.random()*1500); // 0.5–2s Jitter
    logWarn(`SEND_AT empty → warmup ${warmup}ms, send now, then every 24h.`);
    await sleep(warmup);
    setInfo('Active', 0);
    await sendGM();
    setInfo('Active', DAY_MS);
    setInterval(()=> setInfo('Active', DAY_MS), DAY_MS);
    setInterval(sendGM, DAY_MS);
  } else {
    logInfo(`Scheduling daily send at (WIB): ${SEND_AT}`);
    let nextDelay = msUntilNextWIB(SEND_AT);
    const firstAt = new Date(Date.now() + nextDelay);
    logInfo(`First send scheduled at server time: ${firstAt}`);
    setInfo('Active', nextDelay);

    let remain = nextDelay;
    const tick = setInterval(()=> { remain -= 1000; setInfo('Active', remain); }, 1000);

    setTimeout(() => {
      sendGM();
      clearInterval(tick);
      setInfo('Active', DAY_MS);
      setInterval(()=> setInfo('Active', DAY_MS), DAY_MS);
      setInterval(sendGM, DAY_MS);
    }, nextDelay);
  }
})();
