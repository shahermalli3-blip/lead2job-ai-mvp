import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const text=(status:number,body:string)=>new Response(body,{status,headers:{"Content-Type":"text/plain"}});
const enc=new TextEncoder();
const hex=(buf:ArrayBuffer)=>Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
const safeEqual=(a:string,b:string)=>{if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;};

async function validSignature(raw:string,header:string,secret:string){
  if(!header.startsWith('sha256='))return false;
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=hex(await crypto.subtle.sign('HMAC',key,enc.encode(raw)));
  return safeEqual(`sha256=${sig}`,header);
}

Deno.serve(async(req:Request)=>{
  const verifyToken=Deno.env.get('META_WHATSAPP_VERIFY_TOKEN');
  if(req.method==='GET'){
    const u=new URL(req.url);
    const mode=u.searchParams.get('hub.mode'),token=u.searchParams.get('hub.verify_token'),challenge=u.searchParams.get('hub.challenge');
    if(mode==='subscribe'&&verifyToken&&token===verifyToken&&challenge)return text(200,challenge);
    return text(403,'Forbidden');
  }
  if(req.method!=='POST')return json(405,{success:false,error:'Method not allowed'});

  const appSecret=Deno.env.get('META_APP_SECRET');
  const channelSecret=Deno.env.get('META_CHANNEL_SECRET');
  const url=Deno.env.get('SUPABASE_URL');
  if(!appSecret||!channelSecret||!url)return json(503,{success:false,error:'Meta WhatsApp is not configured'});

  const raw=await req.text();
  const signature=req.headers.get('x-hub-signature-256')||'';
  if(!(await validSignature(raw,signature,appSecret)))return json(401,{success:false,error:'Invalid Meta signature'});

  let payload:any;try{payload=JSON.parse(raw)}catch{return json(400,{success:false,error:'Invalid JSON'});}
  const value=payload?.entry?.[0]?.changes?.[0]?.value;
  const msg=value?.messages?.[0];
  if(!msg)return json(200,{success:true,ignored:true});
  if(msg.type!=='text'||!msg.text?.body)return json(200,{success:true,ignored:true,reason:'unsupported_message_type'});

  const normalized={provider:'meta',to:String(value?.metadata?.phone_number_id||''),from:String(msg.from||''),message:String(msg.text.body).slice(0,3000),message_id:String(msg.id||'')};
  if(!normalized.to||!normalized.from||!normalized.message_id)return json(200,{success:true,ignored:true,reason:'incomplete_event'});

  const core=await fetch(url+'/functions/v1/channel-inbound',{method:'POST',headers:{'Content-Type':'application/json','x-channel-secret':channelSecret},body:JSON.stringify(normalized)});
  const result=await core.json().catch(()=>({}));
  if(!core.ok)return json(502,{success:false,error:'Channel processing failed'});

  // Outbound sending deliberately remains disabled until real Meta credentials are configured and tested.
  return json(200,{success:true,accepted:true,event_id:result.event_id||null,conversation_id:result.conversation_id||null,lead_id:result.lead_id||null,reply_ready:Boolean(result.reply)});
});