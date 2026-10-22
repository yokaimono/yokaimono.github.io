/**
 * Trading Journal Terminal — Cloudflare Worker
 * OAuth login + owner-only writes to a public GitHub repository.
 *
 * Required Worker secrets:
 *   GITHUB_OAUTH_CLIENT_SECRET
 *   GITHUB_REPO_TOKEN   (fine-grained PAT: Contents read/write, only this repo)
 *   SESSION_SECRET      (long random string, 32+ chars)
 *
 * Required Worker variables:
 *   GITHUB_OAUTH_CLIENT_ID
 *   GITHUB_OWNER
 *   GITHUB_REPO
 *   GITHUB_OWNER_USERNAME
 *   GITHUB_BRANCH       (usually "main")
 *   PAGES_ORIGIN        (exact GitHub Pages origin, no trailing slash)
 *   WORKER_ORIGIN       (deployed Worker origin, e.g. https://name.account.workers.dev)
 *
 * Set OAuth callback URL to: WORKER_ORIGIN/auth/callback
 */
const COOKIE_SESSION = '__Host-tj_session';
const COOKIE_STATE = '__Host-tj_oauth_state';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_TRADES = 10000;

function json(data, status=200, headers={}) {
  return new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
}
function cookie(name,value,opts={}) {
  const parts=[`${name}=${value}`, 'Path=/', 'Secure', 'HttpOnly'];
  if(opts.maxAge!==undefined) parts.push(`Max-Age=${opts.maxAge}`);
  parts.push(`SameSite=${opts.sameSite||'None'}`);
  return parts.join('; ');
}
function clearCookie(name,sameSite='None') {
  return `${name}=; Path=/; Secure; HttpOnly; Max-Age=0; SameSite=${sameSite}`;
}
function b64url(bytes) {
  let s=''; for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unb64url(s) {
  const base=s.replace(/-/g,'+').replace(/_/g,'/');
  const bin=atob(base+'='.repeat((4-base.length%4)%4));
  return Uint8Array.from(bin,c=>c.charCodeAt(0));
}
const enc = new TextEncoder();
async function hmac(value, secret) {
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(value)));
}
async function sign(value,secret) { return `${b64url(enc.encode(value))}.${b64url(await hmac(value,secret))}`; }
async function verifySigned(token,secret) {
  if(!token||!token.includes('.'))return null;
  const [payload,sig]=token.split('.',2);
  try {
    const value=new TextDecoder().decode(unb64url(payload));
    const expected=await hmac(value,secret), actual=unb64url(sig);
    if(expected.length!==actual.length)return null;
    let diff=0;for(let i=0;i<expected.length;i++)diff|=expected[i]^actual[i];
    return diff===0?value:null;
  } catch { return null; }
}
function parseCookies(request) {
  const out={};for(const part of (request.headers.get('Cookie')||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=part.slice(i+1).trim()}
  return out;
}
function cors(request,env) {
  const origin=request.headers.get('Origin');
  const allowed=origin && origin===env.PAGES_ORIGIN;
  const h={'Vary':'Origin','Access-Control-Allow-Methods':'GET, PUT, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if(allowed){h['Access-Control-Allow-Origin']=origin;h['Access-Control-Allow-Credentials']='true'}
  return h;
}
function validConfig(env) {
  const required=['GITHUB_OAUTH_CLIENT_ID','GITHUB_OAUTH_CLIENT_SECRET','GITHUB_OWNER','GITHUB_REPO','GITHUB_OWNER_USERNAME','GITHUB_REPO_TOKEN','SESSION_SECRET','PAGES_ORIGIN','WORKER_ORIGIN'];
  return required.filter(k=>!env[k]);
}
async function githubApi(env,path,options={}) {
  const r=await fetch(`https://api.github.com${path}`,{...options,headers:{
    'Accept':'application/vnd.github+json','Authorization':`Bearer ${env.GITHUB_REPO_TOKEN}`,
    'X-GitHub-Api-Version':'2022-11-28','User-Agent':'TradingJournalTerminal/1.0',
    ...(options.headers||{})
  }});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`GitHub API HTTP ${r.status}: ${body.message||'request failed'}`);
  return body;
}
function repoPath(env) { return `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/trades.json`; }
async function readTrades(env) {
  try {
    const file=await githubApi(env,repoPath(env)+`?ref=${encodeURIComponent(env.GITHUB_BRANCH||'main')}`);
    const raw=atob(String(file.content||'').replace(/\n/g,''));
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    const parsed=JSON.parse(new TextDecoder().decode(bytes));
    if(!Array.isArray(parsed.trades))throw new Error('trades.json must contain a trades array');
    return {trades:parsed.trades,sha:file.sha};
  } catch(e) {
    if(String(e.message).includes('HTTP 404')) return {trades:[],sha:null};
    throw e;
  }
}
function validTrade(t) {
  if(!t||typeof t!=='object'||Array.isArray(t))return false;
  if(typeof t.id!=='string'||!t.id||t.id.length>100)return false;
  if(typeof t.date!=='string'||t.date.length>40||!t.date)return false;
  if(typeof t.symbol!=='string'||!t.symbol.trim()||t.symbol.length>30)return false;
  if(!['LONG','SHORT'].includes(t.side))return false;
  if(!Number.isFinite(Number(t.pnl)))return false;
  const allowed=['id','date','symbol','side','setup','entry','exit','size','risk','pnl','currency','fees','status','riskR','mood','notes','review','updatedAt'];
  const out={};for(const k of allowed)if(t[k]!==undefined)out[k]=t[k];
  for(const k of ['setup','size','mood'])if(out[k]!==undefined&&String(out[k]).length>200) return false;
  for(const k of ['notes','review'])if(out[k]!==undefined&&String(out[k]).length>3000)return false;
  for(const k of ['entry','exit','risk','pnl','fees','riskR'])if(out[k]!==undefined&&out[k]!==null&&!Number.isFinite(Number(out[k])))return false;
  if(out.status!==undefined&&!['OPEN','CLOSED'].includes(out.status))return false;
  return out;
}
async function writeTrades(env,trades) {
  if(!Array.isArray(trades)||trades.length>MAX_TRADES)throw new Error('Invalid trade list or trade limit exceeded.');
  const clean=trades.map(validTrade);
  if(clean.some(t=>!t))throw new Error('One or more trade records are invalid.');
  const ids=clean.map(t=>t.id);if(new Set(ids).size!==ids.length)throw new Error('Duplicate trade IDs are not allowed.');
  const current=await readTrades(env);
  const content=JSON.stringify({schemaVersion:1,updatedAt:new Date().toISOString(),trades:clean},null,2);
  const bytes=enc.encode(content);let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
  const payload={message:'Update trading journal data',content:btoa(binary),branch:env.GITHUB_BRANCH||'main'};
  if(current.sha)payload.sha=current.sha;
  await githubApi(env,repoPath(env),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  return {trades:clean};
}
async function ownerSession(request,env) {
  const token=parseCookies(request)[COOKIE_SESSION];
  const value=await verifySigned(token,env.SESSION_SECRET);
  if(!value)return null;
  try {
    const s=JSON.parse(value);
    if(!s.login||s.login.toLowerCase()!==env.GITHUB_OWNER_USERNAME.toLowerCase()||s.exp<Date.now())return null;
    return s;
  } catch { return null; }
}
function redirect(url,headers={}) { return new Response(null,{status:302,headers:{Location:url,...headers}}); }
function safeReturn(env,query='') { const path=(env.PAGES_PATH||'/').startsWith('/')?(env.PAGES_PATH||'/'):`/${env.PAGES_PATH}`; const cleanPath=path.endsWith('/')?path:`${path}/`; return `${env.PAGES_ORIGIN}${cleanPath}${query}`; }
export default {
  async fetch(request,env) {
    const url=new URL(request.url), headers=cors(request,env);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    const missing=validConfig(env);
    if(missing.length && !url.pathname.startsWith('/auth/'))return json({error:'Worker belum dikonfigurasi.',missing},503,headers);
    if(url.pathname==='/api/health'&&request.method==='GET')return json({ok:true,service:'trading-journal-worker'},200,headers);
    if(url.pathname==='/api/trades'&&request.method==='GET') {
      try { const data=await readTrades(env); return json({trades:data.trades},200,headers); }
      catch(e) { return json({error:'Gagal membaca data jurnal.',detail:e.message},502,headers); }
    }
    if(url.pathname==='/api/trades'&&request.method==='PUT') {
      const session=await ownerSession(request,env);
      if(!session)return json({error:'Unauthorized. Login pemilik diperlukan.'},401,headers);
      const origin=request.headers.get('Origin');
      if(origin!==env.PAGES_ORIGIN)return json({error:'Origin tidak diizinkan.'},403,headers);
      const length=Number(request.headers.get('Content-Length')||0);
      if(length>MAX_BODY)return json({error:'Request terlalu besar.'},413,headers);
      let body;try{body=await request.json()}catch{return json({error:'JSON request tidak valid.'},400,headers)}
      try { const data=await writeTrades(env,body.trades); return json({ok:true,count:data.trades.length},200,headers); }
      catch(e) { return json({error:'Gagal menyimpan jurnal.',detail:e.message},502,headers); }
    }
    if(url.pathname==='/auth/login'&&request.method==='GET') {
      if(missing.length)return redirect(safeReturn(env,'?auth=error'));
      const state=b64url(crypto.getRandomValues(new Uint8Array(24)));
      const signed=await sign(state,env.SESSION_SECRET);
      const callback=`${env.WORKER_ORIGIN}/auth/callback`;
      const gh=new URL('https://github.com/login/oauth/authorize');
      gh.searchParams.set('client_id',env.GITHUB_OAUTH_CLIENT_ID);
      gh.searchParams.set('redirect_uri',callback);
      gh.searchParams.set('scope','read:user');
      gh.searchParams.set('state',state);
      return redirect(gh.toString(),{'Set-Cookie':cookie(COOKIE_STATE,signed,{maxAge:600,sameSite:'Lax'})});
    }
    if(url.pathname==='/auth/callback'&&request.method==='GET') {
      const state=url.searchParams.get('state'),stateCookie=parseCookies(request)[COOKIE_STATE];
      const signedState=await verifySigned(stateCookie,env.SESSION_SECRET);
      if(!state||!signedState||signedState!==state||url.searchParams.has('error'))return redirect(safeReturn(env,'?auth=error'),{'Set-Cookie':clearCookie(COOKIE_STATE,'Lax')});
      try {
        const tokenRes=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_OAUTH_CLIENT_ID,client_secret:env.GITHUB_OAUTH_CLIENT_SECRET,code:url.searchParams.get('code'),redirect_uri:`${env.WORKER_ORIGIN}/auth/callback`,state})});
        const tokenData=await tokenRes.json();
        if(!tokenRes.ok||!tokenData.access_token)throw new Error('OAuth token exchange failed');
        const userRes=await fetch('https://api.github.com/user',{headers:{'Accept':'application/vnd.github+json','Authorization':`Bearer ${tokenData.access_token}`,'User-Agent':'TradingJournalTerminal/1.0'}});
        if(!userRes.ok)throw new Error('GitHub identity check failed');
        const user=await userRes.json();
        if(String(user.login||'').toLowerCase()!==env.GITHUB_OWNER_USERNAME.toLowerCase())return redirect(safeReturn(env,'?auth=error'),{'Set-Cookie':clearCookie(COOKIE_STATE,'Lax')});
        const payload=JSON.stringify({login:user.login,exp:Date.now()+8*60*60*1000});
        const session=await sign(payload,env.SESSION_SECRET);
        return redirect(safeReturn(env,'?auth=success'),{'Set-Cookie':[cookie(COOKIE_SESSION,session,{maxAge:8*60*60,sameSite:'None'}),clearCookie(COOKIE_STATE,'Lax')]});
      } catch {
        return redirect(safeReturn(env,'?auth=error'),{'Set-Cookie':clearCookie(COOKIE_STATE,'Lax')});
      }
    }
    if(url.pathname==='/auth/me'&&request.method==='GET') {
      const s=await ownerSession(request,env);
      return json({isOwner:!!s,login:s?.login||null},200,headers);
    }
    if(url.pathname==='/auth/logout'&&request.method==='POST') {
      return json({ok:true},200,{...headers,'Set-Cookie':clearCookie(COOKIE_SESSION,'None')});
    }
    return json({error:'Not found'},404,headers);
  }
};
