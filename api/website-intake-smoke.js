export default async function handler(req,res){
  const r=await fetch('https://npqiispbwwinnnvzyybx.supabase.co/functions/v1/receive-customer-message',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:'a1d29e9b-ebf4-4145-b24e-614b96c81e8e',channel:'website',external_contact:'+31600000002',message:'Hoi, ik zoek schoonmaak.'})
  });
  const data=await r.json();
  res.status(200).json({upstream_status:r.status,data});
}
