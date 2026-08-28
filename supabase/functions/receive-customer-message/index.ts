import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, x-inbox-token","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown,max=1000)=>{if(v===null||v===undefined)return null;const s=String(v).trim();return s?s.slice(0,max):null;};

type Collected={name?:string|null;service_type?:string|null;city?:string|null;preferred_time?:string|null;description?:string|null;phone?:string|null;email?:string|null};
type AiResult={reply:string;collected:Collected;ready_to_create_lead:boolean;handoff:boolean;handoff_reason:string|null;owner_summary:string;owner_next_action:string};
const ns={type:"string",nullable:true};
const schema={type:"object",properties:{reply:{type:"string"},collected:{type:"object",properties:{name:ns,service_type:ns,city:ns,preferred_time:ns,description:ns,phone:ns,email:ns},required:["name","service_type","city","preferred_time","description","phone","email"]},ready_to_create_lead:{type:"boolean"},handoff:{type:"boolean"},handoff_reason:ns,owner_summary:{type:"string"},owner_next_action:{type:"string"}},required:["reply","collected","ready_to_create_lead","handoff","handoff_reason","owner_summary","owner_next_action"]};

async function askGemini(input:{business_name:string;business_service:string;business_city:string;existing:Collected;history:{role:string;content:string}[]}):Promise<AiResult>{
  const key=Deno.env.get("GEMINI_API_KEY")||Deno.env.get("GEIMINI_API_KEY");
  if(!key)throw new Error("Gemini API key is not configured");
  const model="gemini-3.5-flash-lite";
  const prompt=`Je bent de digitale AI-receptionist van ${input.business_name||'dit servicebedrijf'} in Nederland. Het bedrijf doet vooral: ${input.business_service||'dienstverlening'}. Werkgebied: ${input.business_city||'niet ingesteld'}.
Help de klant snel en vriendelijk. Stel per antwoord maximaal EEN korte vraag en vraag nooit opnieuw wat al bekend is. Verzamel alleen wat nodig is om een bruikbare aanvraag door te geven. Verzin NOOIT prijzen, beschikbaarheid, garanties, adressen of bedrijfsregels. Als iets niet zeker is, zeg dat het team dit bevestigt en zet handoff=true wanneer menselijke beoordeling nodig is. Als de klant vraagt met wie hij praat, wees transparant dat je de digitale AI-assistent van het bedrijf bent. Antwoord in de taal van de klant.
Maak ready_to_create_lead=true zodra de gewenste dienst duidelijk is en er een bereikbare contactmogelijkheid bekend is. Bestaand verzameld: ${JSON.stringify(input.existing)}. Recente conversatie: ${JSON.stringify(input.history)}.
collected is de beste samengevoegde stand van bekende feiten. description is een korte feitelijke samenvatting. owner_summary is een zeer korte samenvatting voor de ondernemer. owner_next_action is precies één praktische volgende stap voor de ondernemer, zonder feiten te verzinnen.`;
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",responseSchema:schema,thinkingConfig:{thinkingLevel:"minimal"}}})});
  const p=await r.json();
  if(!r.ok)throw new Error(p?.error?.message||`Gemini request failed (${r.status})`);
  const text=p?.candidates?.[0]?.content?.parts?.find((x:any)=>typeof x?.text==='string')?.text;
  if(!text)throw new Error("Gemini returned no reply");
  return JSON.parse(text) as AiResult;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json(405,{success:false,error:'Method not allowed'});
  try{
    const body=await req.json().catch(()=>({}));
    const token=clean(req.headers.get('x-inbox-token')||body.token,100),message=clean(body.message,3000);
    if(!token)return json(401,{success:false,error:'Missing inbox token'});
    if(!message)return json(400,{success:false,error:'message is required'});
    const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!serviceKey)return json(500,{success:false,error:'Server configuration incomplete'});
    const admin=createClient(url,serviceKey,{auth:{persistSession:false}});
    const iq=await admin.from('inboxes').select('id,owner_id,name,enabled').eq('public_token',token).eq('enabled',true).maybeSingle();
    if(iq.error||!iq.data)return json(401,{success:false,error:'Invalid inbox token'});
    const inbox=iq.data,channel=clean(body.channel,40)||'api',externalContact=clean(body.external_contact,200);
    let conversation:any=null;
    const requestedId=clean(body.conversation_id,80);
    if(requestedId){
      const q=await admin.from('conversations').select('*').eq('id',requestedId).eq('owner_id',inbox.owner_id).eq('inbox_id',inbox.id).maybeSingle();
      if(q.error)return json(400,{success:false,error:'Could not load conversation'});
      conversation=q.data;
      if(!conversation)return json(404,{success:false,error:'Conversation not found'});
    }
    if(!conversation){
      const q=await admin.from('conversations').insert({owner_id:inbox.owner_id,inbox_id:inbox.id,channel,external_contact:externalContact,status:'open'}).select('*').single();
      if(q.error||!q.data)return json(500,{success:false,error:'Could not create conversation'});
      conversation=q.data;
    }
    const incoming=await admin.from('conversation_messages').insert({conversation_id:conversation.id,owner_id:inbox.owner_id,direction:'inbound',role:'customer',content:message});
    if(incoming.error)return json(500,{success:false,error:'Could not save incoming message'});
    const {data:history}=await admin.from('conversation_messages').select('role,content').eq('conversation_id',conversation.id).order('created_at',{ascending:false}).limit(12);
    const {data:profile}=await admin.from('profiles').select('business_name,service_type,city').eq('id',inbox.owner_id).maybeSingle();
    const existing:Collected={...(conversation.collected||{})};
    if(!existing.phone&&['sms','whatsapp','phone'].includes(channel)&&externalContact)existing.phone=externalContact;
    if(!existing.email&&channel==='email'&&externalContact)existing.email=externalContact;
    const ai=await askGemini({business_name:profile?.business_name||inbox.name||'bedrijf',business_service:profile?.service_type||'',business_city:profile?.city||'',existing,history:(history||[]).reverse()});
    const merged:Collected={...existing,...Object.fromEntries(Object.entries(ai.collected||{}).filter(([,v])=>v!==null&&v!==''))};
    let leadId=conversation.lead_id as string|null;
    const reachable=Boolean(merged.phone||merged.email||(['sms','whatsapp','phone','email'].includes(channel)&&externalContact));
    if(!leadId&&ai.ready_to_create_lead&&merged.service_type&&reachable){
      const q=await admin.from('leads').insert({owner_id:inbox.owner_id,name:merged.name||'Nieuwe klant',phone:merged.phone||null,email:merged.email||null,channel,service_type:merged.service_type,description:merged.description||null,city:merged.city||null,preferred_time:merged.preferred_time||null,urgency:'normal',status:'new',notes:'Automatisch aangemaakt door AI-receptionist'}).select('id').single();
      if(q.error||!q.data)return json(500,{success:false,error:'Could not create lead'});
      leadId=q.data.id;
      await admin.from('activities').insert({lead_id:leadId,type:'lead_created',channel,direction:'inbound',content:'Lead automatisch aangemaakt vanuit klantgesprek',metadata:{conversation_id:conversation.id,inbox_id:inbox.id,source:'ai_receptionist'}});
      await admin.from('activities').insert({lead_id:leadId,type:'ai_intake_summary',channel:'ai',direction:'internal',content:ai.owner_summary,metadata:{conversation_id:conversation.id,next_action:ai.owner_next_action,handoff:ai.handoff,handoff_reason:ai.handoff_reason}});
      const taskChannel=['whatsapp','sms','email','phone'].includes(channel)?channel:(merged.phone?'phone':'email');
      await admin.from('follow_ups').insert({lead_id:leadId,due_at:new Date().toISOString(),channel:taskChannel,status:'pending',message:`${ai.owner_next_action}\n\n${ai.owner_summary}`});
    }else if(leadId){
      const patch:any={};
      for(const k of ['name','phone','email','service_type','description','city','preferred_time'] as const)if(merged[k])patch[k]=merged[k];
      if(Object.keys(patch).length)await admin.from('leads').update(patch).eq('id',leadId).eq('owner_id',inbox.owner_id);
    }
    const newStatus=ai.handoff?'handoff':(leadId&&ai.ready_to_create_lead?'qualified':conversation.status);
    const cq=await admin.from('conversations').update({lead_id:leadId,collected:merged,status:newStatus,updated_at:new Date().toISOString()}).eq('id',conversation.id).eq('owner_id',inbox.owner_id);
    if(cq.error)return json(500,{success:false,error:'Could not update conversation'});
    const outgoing=await admin.from('conversation_messages').insert({conversation_id:conversation.id,owner_id:inbox.owner_id,direction:'outbound',role:'assistant',content:ai.reply});
    if(outgoing.error)return json(500,{success:false,error:'Could not save assistant reply'});
    return json(200,{success:true,conversation_id:conversation.id,lead_id:leadId,status:newStatus,reply:ai.reply,handoff:ai.handoff,handoff_reason:ai.handoff_reason,collected:merged,owner_summary:ai.owner_summary,owner_next_action:ai.owner_next_action});
  }catch(e){
    console.error('receive-customer-message error',e);
    return json(500,{success:false,error:'Unexpected server error',detail:e instanceof Error?e.message:String(e)});
  }
});