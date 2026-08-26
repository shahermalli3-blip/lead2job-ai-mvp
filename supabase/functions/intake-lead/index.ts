import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-inbox-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});

function clean(value: unknown, max = 500) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  return v ? v.slice(0, max) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { success: false, error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const token = clean(req.headers.get('x-inbox-token') || body.token, 80);
    if (!token) return json(401, { success: false, error: 'Missing inbox token' });

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json(500, { success: false, error: 'Server configuration incomplete' });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: inbox, error: inboxError } = await admin
      .from('inboxes')
      .select('id, owner_id, enabled')
      .eq('public_token', token)
      .eq('enabled', true)
      .maybeSingle();

    if (inboxError || !inbox) return json(401, { success: false, error: 'Invalid inbox token' });

    const name = clean(body.name, 120);
    const serviceType = clean(body.service_type || body.service, 160);
    if (!name || !serviceType) return json(400, { success: false, error: 'Name and service are required' });

    const urgency = ['low','normal','high','emergency'].includes(body.urgency) ? body.urgency : 'normal';
    const numericValue = body.estimated_value ?? body.value;
    const value = numericValue === '' || numericValue === null || numericValue === undefined ? null : Number(numericValue);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 10000000)) {
      return json(400, { success: false, error: 'Invalid estimated value' });
    }

    const leadPayload = {
      owner_id: inbox.owner_id,
      name,
      phone: clean(body.phone, 80),
      email: clean(body.email, 200),
      channel: 'website',
      service_type: serviceType,
      description: clean(body.description, 3000),
      address: clean(body.address, 300),
      city: clean(body.city, 120),
      urgency,
      preferred_time: clean(body.preferred_time, 160),
      status: 'new',
      estimated_value_min: value,
      estimated_value_max: value,
      notes: 'Created through public intake form'
    };

    const { data: lead, error: leadError } = await admin
      .from('leads')
      .insert(leadPayload)
      .select('id, created_at')
      .single();

    if (leadError || !lead) {
      console.error('lead insert failed', leadError);
      return json(500, { success: false, error: 'Could not save lead' });
    }

    await admin.from('activities').insert({
      lead_id: lead.id,
      type: 'lead_created',
      channel: 'website',
      direction: 'inbound',
      content: 'Lead submitted through public intake form',
      metadata: { inbox_id: inbox.id }
    });

    return json(201, { success: true, lead_id: lead.id });
  } catch (error) {
    console.error('intake-lead error', error);
    return json(500, { success: false, error: 'Unexpected server error' });
  }
});
