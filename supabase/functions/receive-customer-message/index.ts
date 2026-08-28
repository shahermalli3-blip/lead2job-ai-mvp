import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, x-inbox-token","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown,max=1000)=>{if(v===null||v===undefined)return null;const s=String(v).trim();return s?s.slice(0,max):null;};
type Collected={name?:string|null;service_type?:string|null;city?:string|null;preferred_time?:string|null;description?:string|null;phone?:string|null;email?:string|null};
type AiResult={reply:string;collected:Collected;ready_to_create_lead:boolean;handoff:boolean;handoff_reason:string|null;owner_summary:string;owner_next_action:string};
const ns={type:"string",nullable:true};
const schema={type:"object",properties:{reply:{type:"string"},collected:{type:"object",properties:{name:ns,service_type:ns,city:ns,preferred_time:ns,description:ns,phone:ns,email:ns},required:["name","service_type","city","preferred_time","description","phone","email"]},ready_to_create_lead:{type:"boolean"},handoff:{type:"boolean"},handoff_reason:ns,owner_summary:{type:"string"},owner_next_action:{type:"string"}},required:["reply","collected","ready_to_create_lead","handoff","handoff_reason","owner_summary","owner_next_action"]};

async function askGemini(input:{business_name:string;business_service:string;business_city:string;existing:Collected;contact_available:boolean;history:{role:string;content:string}[]}):Promise<AiResult>{
  const key=Deno.env.get("GEMINI_API_KEY")||Deno.env.get("GEIMINI_API_KEY");
  if(!key)throw new Error("Gemini API key is not configured");
  const model="gemini-3.5-flash-lite";
  const prompt=`Je bent de digitale AI-receptionist van ${input.business_name||'dit servicebedrijf'} in Nederland. Het bedrijf doet vooral: ${input.business_service||'dienstverlening'}. Werkgebied: ${input.business_city||'niet ingesteld'}.
Help de klant snel en vriendelijk. Stel per antwoord maximaal EEN korte vraag en vraag nooit opnieuw wat al bekend is. Verzamel alleen wat nodig is om een bruikbare aanvraag door te geven. Verzin NOOIT prijzen, beschikbaarheid, garanties, adressen of bedrijfsregels en bevestig NOOIT dat het bedrijf op een gevraagde datum of tijd beschikbaar is. Als iets niet zeker is, zeg dat het team dit bevestigt en zet handoff=true wanneer menselijke beoordeling nodig is. Als de klant vraagt met wie hij praat, wees transparant dat je de digitale AI-assistent van het bedrijf bent. Antwoord in de taal van de klant.
Maak ready_to_create_lead=true pas wanneer ten minste de gewenste dienst, een bruikbare locatie/stad en een bereikbare contactmogelijkheid bekend zijn. Bereikbaar contact beschikbaar: ${input.contact_available}. Bestaand verzameld zonder ruwe contactgegevens: ${JSON.stringify(input.existing)}. Recente conversatie: ${JSON.stringify(input.history)}.
Zet phone en email in collected ALTIJD op null; contactgegevens worden buiten het AI-model veilig bewaard. collected is verder de beste samengevoegde stand van bekende feiten. description is een korte feitelijke samenvatting. owner_summary is een zeer korte samenvatting voor de ondernemer. owner_next_action is precies één praktische volgende stap voor de ondernemer en moet bij voorkeur zeggen dat prijs/planning nog bevestigd moeten worden wanneer die niet bekend zijn.`;
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
    const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');
    if(!url||!anon)return json(500,{success:false,error:'Server configuration incomplete'});
    const db=createClient(url,anon,{auth:{persistSession:false}});
    const channel=clean(body.channel,40)||'api',externalContact=clean(body.external_contact,200),conversationId=clean(body.conversation_id,80);
    const start=await db.rpc('reception_start_message',{p_token:token,p_message:message,p_channel:channel,p_external_contact:externalContact,p_conversation_id:conversationId});
    if(start.error||!start.data){
      const code=String(start.error?.message||'');
      if(code.includes('invalid_inbox_token'))return json(401,{success:false,error:'Invalid inbox token'});
      if(code.includes('conversation_not_found'))return json(404,{success:false,error:'Conversation not found'});
      return json(500,{success:false,error:'Could not start conversation',detail:start.error?.message});
    }
    const state:any=start.data;
    const existing:Collected={...(state.collected||{})};
    if(!existing.phone&&['sms','whatsapp','phone'].includes(state.channel)&&state.external_contact)existing.phone=state.external_contact;
    if(!existing.email&&state.channel==='email'&&state.external_contact)existing.email=state.external_contact;
    const contactAvailable=Boolean(existing.phone||existing.email||(['sms','whatsapp','phone','email'].includes(state.channel)&&state.external_contact));
    const aiExisting:Collected={...existing,phone:null,email:null};
    const ai=await askGemini({business_name:state.business_name||'bedrijf',business_service:state.business_service||'',business_city:state.business_city||'',existing:aiExisting,contact_available:contactAvailable,history:Array.isArray(state.history)?state.history:[]});
    const aiCollected:Collected={...(ai.collected||{}),phone:null,email:null};
    const merged:Collected={...existing,...Object.fromEntries(Object.entries(aiCollected).filter(([,v])=>v!==null&&v!==''))};
    const company=String(state.business_name||'het bedrijf');
    let customerReply=ai.reply;
    if(ai.handoff)customerReply=`Dank je. Ik geef je vraag door aan ${company}. Zij bevestigen dit met je.`;
    else if(ai.ready_to_create_lead)customerReply=`Dank je. Ik heb je aanvraag doorgegeven aan ${company}. Zij bevestigen prijs en planning met je.`;
    const finish=await db.rpc('reception_finish_message',{p_token:token,p_conversation_id:state.conversation_id,p_reply:customerReply,p_collected:merged,p_ready:ai.ready_to_create_lead,p_handoff:ai.handoff,p_handoff_reason:ai.handoff_reason,p_owner_summary:ai.owner_summary,p_owner_next_action:ai.owner_next_action});
    if(finish.error||!finish.data)return json(500,{success:false,error:'Could not finish conversation',detail:finish.error?.message});
    const result:any=finish.data;
    return json(200,{success:true,conversation_id:result.conversation_id,lead_id:result.lead_id,status:result.status,reply:customerReply,handoff:ai.handoff,handoff_reason:ai.handoff_reason,collected:merged,owner_summary:ai.owner_summary,owner_next_action:ai.owner_next_action});
  }catch(e){
    console.error('receive-customer-message error',e);
    return json(500,{success:false,error:'Unexpected server error',detail:e instanceof Error?e.message:String(e)});
  }
});