const http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path'),{Readable}=require('stream');
const K=process.env.GEMINI_API_KEY,ADMIN=process.env.ADMIN_KEY||'',F=process.env.DATA_FILE||'data.json';
const IMGM=process.env.IMAGE_MODEL||'gemini-2.5-flash-image',VEOM=process.env.VIDEO_MODEL||'veo-3.0-fast-generate-001';
const G='https://generativelanguage.googleapis.com/v1beta',DAY=864e5,IMG=1,VID=+(process.env.VIDEO_COST||50),PLAN=100;
let db={users:{},pay:[]};try{db=JSON.parse(fs.readFileSync(F))}catch{}
const save=()=>{try{fs.writeFileSync(F,JSON.stringify(db))}catch{}};
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const st=u=>{const n=Date.now(),p=u.paidUntil>n;return{email:u.email,credits:u.credits,paid:p,paidUntil:u.paidUntil,trial:!p&&u.trialEnd>n,trialEnd:u.trialEnd}};
const out=u=>({token:u.token,...st(u)});
const gcall=(url,opt={})=>fetch(url,{...opt,headers:{'x-goog-api-key':K||'','Content-Type':'application/json'}});
const can=(u,c,vid)=>{const s=st(u);if(!s.paid&&!s.trial)return'Trial khatam. ₹99 ka plan lein.';if(vid&&!s.paid)return'Video sirf paid plan mein hai.';if(u.credits<c)return'Credits kam hain.';return null};
const R={};const route=(m,p,f)=>R[m+' '+p]=f;
route('POST','/api/signup',async c=>{const{email,password}=c.body;
 if(!/^\S+@\S+\.\S+$/.test(email||'')||(password||'').length<6)return[400,{error:'Sahi email aur kam se kam 6 akshar ka password daalein'}];
 const e=email.toLowerCase();if(db.users[e])return[400,{error:'Ye email pehle se registered hai'}];
 const salt=crypto.randomBytes(8).toString('hex');
 const u=db.users[e]={email:e,salt,pw:hash(password,salt),token:crypto.randomBytes(24).toString('hex'),trialEnd:Date.now()+3*DAY,paidUntil:0,credits:5};save();return[200,out(u)]});
route('POST','/api/login',async c=>{const{email,password}=c.body;const u=db.users[(email||'').toLowerCase()];
 if(!u||hash(password||'',u.salt)!==u.pw)return[400,{error:'Email ya password galat hai'}];return[200,out(u)]});
route('GET','/api/me',async c=>[200,st(c.u)]);
route('POST','/api/image',async c=>{const p=(c.body.prompt||'').slice(0,800);if(!p)return[400,{error:'Prompt likhein'}];
 const e=can(c.u,IMG);if(e)return[403,{error:e}];
 const j=await(await gcall(`${G}/models/${IMGM}:generateContent`,{method:'POST',body:JSON.stringify({contents:[{parts:[{text:p}]}]})})).json();
 const part=(j.candidates?.[0]?.content?.parts||[]).find(x=>x.inlineData);if(!part)return[500,{error:j.error?.message||'Image nahi bani, prompt badal kar dekhein'}];
 c.u.credits-=IMG;save();return[200,{image:`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,credits:c.u.credits}]});
route('POST','/api/video',async c=>{const p=(c.body.prompt||'').slice(0,800);if(!p)return[400,{error:'Prompt likhein'}];
 const e=can(c.u,VID,true);if(e)return[403,{error:e}];
 const j=await(await gcall(`${G}/models/${VEOM}:predictLongRunning`,{method:'POST',body:JSON.stringify({instances:[{prompt:p}]})})).json();
 if(!j.name)return[500,{error:j.error?.message||'Video start nahi hui'}];
 c.u.credits-=VID;save();return[200,{op:j.name,credits:c.u.credits}]});
route('GET','/api/video/status',async c=>{const j=await(await gcall(`${G}/${c.q.get('op')}`)).json();
 if(!j.done)return[200,{done:false}];
 const v=j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
 if(!v){c.u.credits+=VID;save();return[200,{done:true,error:'Video nahi bani, credits wapas kar diye'}]}
 return[200,{done:true,url:`/api/video/file?t=${c.u.token}&u=${encodeURIComponent(v)}`}]});
route('POST','/api/pay',async c=>{const utr=(c.body.utr||'').trim();if(!/^\d{12}$/.test(utr))return[400,{error:'12 ank ka UTR/Ref number daalein'}];
 if(db.pay.some(p=>p.utr===utr))return[400,{error:'Ye UTR pehle se jama hai'}];
 db.pay.push({email:c.u.email,utr,time:Date.now(),done:false});save();return[200,{ok:true}]});
route('GET','/api/admin/pending',async c=>{if(!ADMIN||c.q.get('key')!==ADMIN)return[403,{error:'no'}];return[200,db.pay.filter(p=>!p.done)]});
route('GET','/api/admin/approve',async c=>{if(!ADMIN||c.q.get('key')!==ADMIN)return[403,{error:'no'}];
 const p=db.pay.find(x=>x.utr===c.q.get('utr')&&!x.done);if(!p)return[200,{result:'Nahi mila'}];
 const u=db.users[p.email];u.paidUntil=Math.max(Date.now(),u.paidUntil)+30*DAY;u.credits+=PLAN;p.done=true;save();return[200,{result:'Approved: '+p.email}]});
const open=['/api/signup','/api/login','/api/admin/pending','/api/admin/approve'];
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://x'),key=req.method+' '+url.pathname,send=(s,o)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
 if(req.method==='GET'&&!url.pathname.startsWith('/api/')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'index.html')))}
 if(url.pathname==='/api/video/file'){const t=url.searchParams.get('t'),u=url.searchParams.get('u')||'';
  if(!Object.values(db.users).find(x=>x.token===t)||!u.startsWith('https://generativelanguage.googleapis.com/')){res.writeHead(403);return res.end()}
  const f=await gcall(u);res.writeHead(200,{'Content-Type':'video/mp4'});return Readable.fromWeb(f.body).pipe(res)}
 const h=R[key];if(!h)return send(404,{error:'Not found'});
 let raw='';for await(const ch of req)raw+=ch;let body={};try{body=raw?JSON.parse(raw):{}}catch{}
 const c={body,q:url.searchParams};
 if(!open.includes(url.pathname)){const t=req.headers['x-token']||url.searchParams.get('t');c.u=Object.values(db.users).find(x=>x.token===t);if(!c.u)return send(401,{error:'Dobara login karein'})}
 const[s,o]=await h(c);send(s,o)}catch(e){console.error(e);try{res.writeHead(500);res.end(JSON.stringify({error:'Server error'}))}catch{}}
}).listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('PixelForge chal raha hai'));
