export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false});
  const r=await fetch('https://npqiispbwwinnnvzyybx.supabase.co/functions/v1/receive-customer-message',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:'a1d29e9b-ebf4-4145-b24e-614b96c81e8e',channel:'whatsapp',external_contact:'+31600000001',message:'Hoi, ik wil morgen mijn appartement laten schoonmaken in Amsterdam. Mijn naam is Test Hamouda.'})
  });
  const data=await r.json();
  return res.status(200).json({upstream_status:r.status,data});
}
