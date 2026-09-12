'use strict';
const { test, before, after } = require('node:test'); const assert=require('node:assert'); const {spawn}=require('child_process'); const fs=require('fs'); const os=require('os'); const path=require('path');
const PORT=4500+Math.floor(Math.random()*100), BASE=`http://127.0.0.1:${PORT}`, DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'jwre-signup-')); let child;
function client(jar={}){return async(url,o={})=>{const r=await fetch(BASE+url,{redirect:'manual',...o,headers:{...(o.headers||{}),cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; ')}});for(const sc of r.headers.getSetCookie?.()||[]){const q=sc.split(';')[0],i=q.indexOf('=');jar[q.slice(0,i)]=q.slice(i+1)}return r}}
const form=x=>({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(x)});
before(()=>new Promise((ok,no)=>{child=spawn(process.execPath,['src/server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(PORT),DATA_DIR,ADMIN_PASSWORD:'owner-pass-123',SESSION_SECRET:'signup-test-secret',STUDIO_OWNER_EMAIL:'owner@example.com',DEMO_AGENT_PASSWORD:'agent-pass-123'}});child.stdout.on('data',d=>String(d).includes('listening')&&ok());child.stderr.on('data',d=>process.stderr.write(d));setTimeout(()=>no(new Error('timeout')),10000)}));
after(()=>{child.kill('SIGKILL');fs.rmSync(DATA_DIR,{recursive:true,force:true})});

test('signup page renders and logged-in agents are redirected away from it',async()=>{
  const r=await fetch(BASE+'/portal/signup');
  assert.equal(r.status,200);
  const html=await r.text();
  assert.match(html,/Create your account/);
  assert.match(html,/minlength="12"/);
  const c=client();
  await c('/portal/login',form({email:'dana.rivera@example.com',password:'agent-pass-123'}));
  const r2=await c('/portal/signup');
  assert.equal(r2.status,303);
  assert.equal(r2.headers.get('location'),'/portal');
});

test('valid signup creates a canonical agent row, hashes the password, and signs in',async()=>{
  const c=client();
  const r=await c('/portal/signup',form({name:'Casey Lane',email:'casey@example.com',phone:'512-555-0100',password:'long-enough-password-1',confirm:'long-enough-password-1',next:'/book'}));
  assert.equal(r.status,303);
  assert.equal(r.headers.get('location'),'/book','signup honors a safe return path');
  const book=await c('/book');
  assert.equal(book.status,200);
  assert.match(await book.text(),/Booking as/);
  const dash=await c('/portal');
  assert.equal(dash.status,200);
  assert.match(await dash.text(),/Casey/);
  const db=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'db.json'),'utf8'));
  const a=db.agents.find(x=>x.email==='casey@example.com');
  assert.ok(a,'agent row exists');
  assert.match(a.password_hash,/^[0-9a-f]{32}:[0-9a-f]{128}$/,'scrypt salt:hash, never plaintext');
  assert.ok(!a.password_hash.includes('long-enough'));
  assert.equal(a.branding.display_name,'Casey Lane');
  assert.ok(db.studio_audit_events.some(e=>e.event==='agent_signup'&&e.detail&&e.detail.agent_id===a.id),'signup audited');
});

test('duplicate email gets a neutral response that does not confirm the account exists',async()=>{
  const r=await fetch(BASE+'/portal/signup',form({name:'Dana Clone',email:'dana.rivera@example.com',password:'another-long-password-2',confirm:'another-long-password-2'}));
  assert.equal(r.status,422);
  const html=await r.text();
  assert.match(html,/could not create an account/i);
  assert.doesNotMatch(html,/already (exists|registered|taken)|in use|taken/i);
  const db=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'db.json'),'utf8'));
  assert.equal(db.agents.filter(x=>x.email==='dana.rivera@example.com').length,1,'no duplicate row');
});

test('weak or mismatched passwords are rejected without creating an account',async()=>{
  for(const pw of [{password:'short',confirm:'short'},{password:'long-enough-password-3',confirm:'long-enough-password-4'}]){
    const r=await fetch(BASE+'/portal/signup',form({name:'Weak Pass',email:'weak@example.com',...pw}));
    assert.equal(r.status,422);
  }
  const db=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'db.json'),'utf8'));
  assert.ok(!db.agents.some(x=>x.email==='weak@example.com'));
});

test('honeypot submissions are silently dropped',async()=>{
  const r=await fetch(BASE+'/portal/signup',{redirect:'manual',...form({name:'Bot',email:'bot@example.com',password:'long-enough-password-5',confirm:'long-enough-password-5',website:'spammy'})})
  assert.equal(r.status,303);
  assert.equal(r.headers.get('location'),'/portal/login');
  const db=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'db.json'),'utf8'));
  assert.ok(!db.agents.some(x=>x.email==='bot@example.com'));
});

test('studio signup does not exist: photographer accounts stay owner-created',async()=>{
  const r=await fetch(BASE+'/admin/signup');
  assert.equal(r.status,404);
});

test('booking requires an agent account and returns there after signup',async()=>{
  // Signed out: /book sends the visitor to login with a return path.
  let r=await fetch(BASE+'/book?package=premium',{redirect:'manual'});
  assert.equal(r.status,303);
  assert.equal(r.headers.get('location'),'/portal/login?next=%2Fbook%3Fpackage%3Dpremium');
  // The return path survives onto the signup page and login page.
  r=await fetch(BASE+'/portal/signup?next=%2Fbook%3Fpackage%3Dpremium');
  let html=await r.text();
  assert.match(html,/name="next" value="\/book\?package=premium"/);
  r=await fetch(BASE+'/portal/login?next=%2Fbook%3Fpackage%3Dpremium');
  html=await r.text();
  assert.match(html,/Sign in to request your shoot/);
  assert.match(html,/\/portal\/signup\?next=%2Fbook%3Fpackage%3Dpremium/,'login links to signup with the return path');
  // Login lands back on the booking form with the account identity locked in.
  const c=client();
  r=await c('/portal/login',form({email:'dana.rivera@example.com',password:'agent-pass-123',next:'/book?package=premium'}));
  assert.equal(r.headers.get('location'),'/book?package=premium');
  r=await c('/book?package=premium');
  assert.equal(r.status,200);
  html=await r.text();
  assert.match(html,/Booking as/);
  assert.match(html,/dana\.rivera@example\.com/);
  assert.match(html,/value="premium"[^>]*checked/,'package preselected');
  // Login also honors the return path, and unsafe next values are dropped.
  const c2=client();
  r=await c2('/portal/login',form({email:'dana.rivera@example.com',password:'agent-pass-123',next:'/book'}));
  assert.equal(r.headers.get('location'),'/book');
  const c3=client();
  r=await c3('/portal/login',form({email:'dana.rivera@example.com',password:'agent-pass-123',next:'https://evil.example/'}));
  assert.equal(r.headers.get('location'),'/portal','external next rejected');
});
