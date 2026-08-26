const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv(res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ success: false, error: 'Server configuration is incomplete' });
    return false;
  }
  return true;
}

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    const message = data?.message || data?.error || 'Database request failed';
    throw new Error(message);
  }
  return data;
}

function normalizeStatus(status) {
  const allowed = new Set(['new','qualified','booked','quote_sent','follow_up','won','lost']);
  return allowed.has(status) ? status : 'new';
}

export default async function handler(req, res) {
  if (!requireEnv(res)) return;

  try {
    if (req.method === 'GET') {
      const leads = await supabase('leads?select=*&order=created_at.desc&limit=200', { method: 'GET' });
      return res.status(200).json({ success: true, leads });
    }

    if (req.method === 'POST') {
      const { name, phone, email, service, service_type, description, address, city, urgency, preferred_time, value, estimated_value_min, estimated_value_max, channel } = req.body || {};
      const serviceType = String(service_type || service || '').trim();
      const leadName = String(name || '').trim();
      const minValue = estimated_value_min ?? value ?? null;
      const maxValue = estimated_value_max ?? value ?? null;

      if (!leadName || !serviceType) {
        return res.status(400).json({ success: false, error: 'Naam en dienst zijn verplicht' });
      }

      if ((minValue !== null && !Number.isFinite(Number(minValue))) || (maxValue !== null && !Number.isFinite(Number(maxValue)))) {
        return res.status(400).json({ success: false, error: 'Ongeldige geschatte waarde' });
      }

      const payload = {
        name: leadName,
        phone: phone ? String(phone).trim() : null,
        email: email ? String(email).trim() : null,
        service_type: serviceType,
        description: description ? String(description).trim() : null,
        address: address ? String(address).trim() : null,
        city: city ? String(city).trim() : null,
        urgency: ['low','normal','high','emergency'].includes(urgency) ? urgency : 'normal',
        preferred_time: preferred_time ? String(preferred_time).trim() : null,
        estimated_value_min: minValue === null ? null : Number(minValue),
        estimated_value_max: maxValue === null ? null : Number(maxValue),
        channel: ['phone','whatsapp','email','website','manual'].includes(channel) ? channel : 'manual',
        status: 'new'
      };

      const rows = await supabase('leads', { method: 'POST', body: JSON.stringify(payload) });
      return res.status(201).json({ success: true, lead: rows?.[0] || null });
    }

    if (req.method === 'PATCH') {
      const { id, status } = req.body || {};
      if (!id || !status) return res.status(400).json({ success: false, error: 'ID en status zijn verplicht' });
      const normalized = normalizeStatus(status);
      const rows = await supabase(`leads?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: normalized })
      });
      return res.status(200).json({ success: true, lead: rows?.[0] || null });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Lead API error:', error);
    return res.status(500).json({ success: false, error: 'Er ging iets mis bij het opslaan van de lead' });
  }
}
