import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, x-channel-secret","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown,max=3000)=>{if(v===null||v===undefined)return null;const s=String(v).trim();return s?s.slice(0,max):null;};

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json(405,{success:false,error:'Method not allowed'});
  try{
    const body=await req.json().catch(()=>({}));
    const secret=clean(req.headers.get('x-channel-secret'),100);
    const provider=clean(body.provider,80),to=clean(body.to,200),from=clean(body.from,200),message=clean(body.message,3000),messageId=clean(body.message_id,200);
    if(!secret)return json(401,{success:false,error:'Missing channel secret'});
    if(!provider||!from||!message||!messageId)return json(400,{success:false,error:'provider, from, message and message_id are required'});

    const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');
    if(!url||!anon)return json(500,{success:false,error:'Server configuration incomplete'});
    const db=createClient(url,anon,{auth:{persistSession:false}});

    const begin=await db.rpc('channel_begin_inbound',{p_secret:secret,p_provider:provider,p_to:to,p_from:from,p_message_id:messageId});
    if(begin.error||!begin.data){
      const code=String(begin.error?.message||'');
      if(code.includes('invalid_channel_connection'))return json(401,{success:false,error:'Invalid channel connection'});
      if(code.includes('inbox_disabled'))return json(409,{success:false,error:'Inbox disabled'});
      return json(500,{success:false,error:'Could not accept channel event'});
    }
    const state:any=begin.data;
    if(state.duplicate)return json(200,{success:true,duplicate:true,event_id:state.event_id,status:state.status,conversation_id:state.conversation_id||null,lead_id:state.lead_id||null});

    const core=await fetch(url+'/functions/v1/receive-customer-message',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-inbox-token':state.inbox_token},
      body:JSON.stringify({channel:state.channel,external_contact:from,message})
    });
    const result=await core.json().catch(()=>({}));
    if(!core.ok||!result.success){
      await db.rpc('channel_finish_inbound',{p_secret:secret,p_event_id:state.event_id,p_status:'failed',p_conversation_id:null,p_lead_id:null,p_error:result?.error||`Core failed (${core.status})`});
      return json(502,{success:false,error:'AI receptionist could not process message'});
    }

    await db.rpc('channel_finish_inbound',{p_secret:secret,p_event_id:state.event_id,p_status:'processed',p_conversation_id:result.conversation_id||null,p_lead_id:result.lead_id||null,p_error:null});
    return json(200,{success:true,duplicate:false,event_id:state.event_id,channel:state.channel,conversation_id:result.conversation_id,lead_id:result.lead_id,status:result.status,reply:result.reply,handoff:result.handoff});
  }catch(e){
    console.error('channel-inbound error',e);
    return json(500,{success:false,error:'Unexpected server error'});
  }
});