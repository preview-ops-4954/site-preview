'use strict';
// JSON-file store with an adapter-shaped interface.
// This module is also the backend dispatcher: with STORAGE_BACKEND=pg the
// same exports come from src/store-pg.js, so handlers never change.
// Every call is already async and returns plain objects.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { STATUSES, normalizeOrder, deliveryUnlocked, newDeliveryToken } = require('./order-core');

const DB_FILE = path.join(config.dataDir, 'db.json');

let cache = null;

function ensureDir() { fs.mkdirSync(config.dataDir, { recursive: true }); }

function load() {
  if (cache) return cache;
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    cache = { seq: 1000, agentSeq: 100, orders: [], agents: [] };
    persist();
  }
  if (!cache.agents) cache.agents = [];
  if (!cache.agentSeq) cache.agentSeq = 100;
  if (!cache.catalog) cache.catalog = [
    ...config.packages.map((x,i)=>({...x,kind:'package',active:true,sort_order:(i+1)*10})),
    ...config.addons.map((x,i)=>({...x,kind:'addon',tagline:'',includes:[],featured:false,active:true,sort_order:(i+1)*10})),
  ];
  return cache;
}

function persist() {
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE); // atomic on same filesystem
}

async function insertOrder(order) {
  const db = load();
  db.seq += 1;
  const rec = normalizeOrder({
    id: 'JWRE-' + db.seq,
    delivery_token: newDeliveryToken(),
    created_at: new Date().toISOString(),
    status: 'booked',
    payment_status: 'unpaid',
    stripe_session_id: null,
    timeline: [{ at: new Date().toISOString(), event: 'Order placed' }],
    ...order,
  });
  db.orders.push(rec);
  persist();
  return rec;
}

async function getOrder(id) {
  const o = load().orders.find(o => o.id === id);
  return o ? normalizeOrder(o) : null;
}

async function getOrderByToken(token) {
  const o = load().orders.find(o => o.delivery_token === token);
  return o ? normalizeOrder(o) : null;
}

async function getOrderBySiteToken(token) {
  const o = load().orders.find(o => o.site_token === token);
  return o ? normalizeOrder(o) : null;
}

async function getOrderByStripeSession(sessionId) {
  const o = load().orders.find(o => o.stripe_session_id === sessionId);
  return o ? normalizeOrder(o) : null;
}

async function allOrders() {
  return [...load().orders].map(normalizeOrder).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function ordersForAgent(agentId) {
  return (await allOrders()).filter(o => o.agent_id === agentId);
}

async function deleteOrder(id) {
  const db = load();
  const i = db.orders.findIndex(o => o.id === id);
  if (i === -1) return false;
  db.orders.splice(i, 1);
  persist();
  return true;
}

async function updateOrder(id, patch, timelineEvent) {
  const db = load();
  const o = db.orders.find(x => x.id === id);
  if (!o) return null;
  Object.assign(o, patch);
  normalizeOrder(o);
  if (timelineEvent) o.timeline.push({ at: new Date().toISOString(), event: timelineEvent });
  persist();
  return o;
}

// ---------- agents (real estate agent portal accounts) ----------

async function insertAgent({ name, email, phone, passwordHash, branding }) {
  const db = load();
  db.agentSeq += 1;
  const rec = {
    id: 'AGT-' + db.agentSeq,
    name: name || '',
    email: String(email || '').trim().toLowerCase(),
    phone: phone || '',
    password_hash: passwordHash,
    branding: branding || {},
    created_at: new Date().toISOString(),
  };
  db.agents.push(rec);
  persist();
  return rec;
}

async function getAgent(id) {
  return load().agents.find(a => a.id === id) || null;
}

async function getAgentByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return load().agents.find(a => a.email === e) || null;
}

async function allAgents() {
  return [...load().agents].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function updateAgent(id, patch) {
  const db = load();
  const a = db.agents.find(x => x.id === id);
  if (!a) return null;
  Object.assign(a, patch);
  persist();
  return a;
}


function studioDb() { const db=load(); if (!db.studio_users) db.studio_users=[]; if (!db.studio_audit_events) db.studio_audit_events=[]; return db; }
async function insertStudioUser({ name, email, passwordHash, role='photographer', mustChangePassword=true }) {
  const db=studioDb(); const id=(db.studio_users.reduce((m,u)=>Math.max(m,Number(u.id)||0),0)+1);
  const rec={id,name,email:String(email).trim().toLowerCase(),password_hash:passwordHash,role,active:true,must_change_password:mustChangePassword,session_version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),last_login_at:null};
  db.studio_users.push(rec); persist(); return rec;
}
async function getStudioUser(id) { return studioDb().studio_users.find(u=>String(u.id)===String(id)) || null; }
async function getStudioUserByEmail(email) { const e=String(email||'').trim().toLowerCase(); return studioDb().studio_users.find(u=>u.email===e)||null; }
async function allStudioUsers(){ return [...studioDb().studio_users]; }
async function updateStudioUser(id,patch){ const db=studioDb(),u=db.studio_users.find(x=>String(x.id)===String(id)); if(!u)return null; Object.assign(u,patch,{updated_at:new Date().toISOString()}); persist(); return u; }
async function countActiveOwners(){ return studioDb().studio_users.filter(u=>u.active&&u.role==='owner').length; }
async function addStudioAudit({actorId=null,event,targetId=null,detail={},ip=null}){ const db=studioDb(); db.studio_audit_events.push({id:db.studio_audit_events.length+1,actor_id:actorId,event,target_id:targetId,detail,ip,created_at:new Date().toISOString()}); persist(); }
async function recentStudioAudit(limit=30){ const db=studioDb(); return db.studio_audit_events.slice(-limit).reverse().map(a=>({...a,actor_name:(db.studio_users.find(u=>u.id===a.actor_id)||{}).name,target_name:(db.studio_users.find(u=>u.id===a.target_id)||{}).name})); }


async function createRecoveryToken({portal,accountId,tokenHash,expiresAt,ip=null}){const db=studioDb();if(!db.account_recovery_tokens)db.account_recovery_tokens=[];for(const t of db.account_recovery_tokens)if(t.portal===portal&&String(t.account_id)===String(accountId)&&!t.used_at)t.used_at=new Date().toISOString();const rec={id:db.account_recovery_tokens.length+1,portal,account_id:String(accountId),token_hash:tokenHash,expires_at:expiresAt,used_at:null,created_at:new Date().toISOString(),requested_ip:ip};db.account_recovery_tokens.push(rec);persist();return rec;}
async function consumeRecoveryToken({portal,tokenHash}){const db=studioDb();if(!db.account_recovery_tokens)db.account_recovery_tokens=[];const t=db.account_recovery_tokens.find(x=>x.portal===portal&&x.token_hash===tokenHash&&!x.used_at&&new Date(x.expires_at)>new Date());if(!t)return null;t.used_at=new Date().toISOString();persist();return t;}

async function allCatalog(includeInactive=false){ return load().catalog.filter(x=>includeInactive||x.active).sort((a,b)=>a.kind.localeCompare(b.kind)||a.sort_order-b.sort_order||a.name.localeCompare(b.name)); }
async function getCatalogItem(id){ return load().catalog.find(x=>x.id===id)||null; }
async function saveCatalogItem(item){ const db=load(),i=db.catalog.findIndex(x=>x.id===item.id); const rec={...item,includes:Array.isArray(item.includes)?item.includes:[],updated_at:new Date().toISOString()}; if(i<0)db.catalog.push({...rec,created_at:rec.updated_at});else db.catalog[i]={...db.catalog[i],...rec};persist();return rec; }

const jsonStore = {
  STATUSES, deliveryUnlocked,
  insertOrder, getOrder, getOrderByToken, getOrderBySiteToken, getOrderByStripeSession,
  allOrders, ordersForAgent, updateOrder, deleteOrder,
  insertAgent, getAgent, getAgentByEmail, allAgents, updateAgent,
  insertStudioUser, getStudioUser, getStudioUserByEmail, allStudioUsers, updateStudioUser, countActiveOwners, addStudioAudit, recentStudioAudit, createRecoveryToken, consumeRecoveryToken, allCatalog, getCatalogItem, saveCatalogItem,
};

// Backend selection: 'json' (default, local file) or 'pg' (Supabase Postgres).
module.exports = config.storageBackend === 'pg' ? require('./store-pg') : jsonStore;
