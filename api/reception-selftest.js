export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false});
  const token='a1d29e9b-ebf4-4145-b24e-614b96c81e8e';
  const r=await fetch('https://npqiispbwwinnnvzyybx.supabase.co/functions/v1/intake-lead',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token})
  });
  const data=await r.json();
  return res.status(200).json({upstream_status:r.status,data});
}
