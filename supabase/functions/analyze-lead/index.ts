import { createClient } from 'jsr:@supabase/supabase-js@2.112.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});

type Lead = {
  id: string;
  owner_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  channel: string | null;
  service_type: string | null;
  description: string | null;
  city: string | null;
  urgency: string | null;
  preferred_time: string | null;
  status: string | null;
  estimated_value_min: number | null;
  estimated_value_max: number | null;
};

type Analysis = {
  priority: 'low' | 'normal' | 'high' | 'urgent';
  quality_score: number;
  qualification: 'poor' | 'possible' | 'good' | 'excellent';
  next_action: string;
  reply_draft: string;
  needs_appointment: boolean;
  needs_follow_up: boolean;
  summary: string;
};

function mockAnalysis(lead: Lead): Analysis {
  const hasContact = Boolean(lead.phone || lead.email);
  const value = Number(lead.estimated_value_max ?? lead.estimated_value_min ?? 0);
  const urgent = lead.urgency === 'emergency' || lead.urgency === 'high';
  let score = 45;
  if (hasContact) score += 20;
  if (lead.service_type) score += 10;
  if (lead.description) score += 8;
  if (lead.city) score += 5;
  if (value >= 250) score += 10;
  if (urgent) score += 7;
  score = Math.min(100, score);
  const qualification: Analysis['qualification'] = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'possible' : 'poor';
  const priority: Analysis['priority'] = lead.urgency === 'emergency' ? 'urgent' : lead.urgency === 'high' ? 'high' : score >= 80 ? 'high' : score < 50 ? 'low' : 'normal';
  const service = lead.service_type || 'de gevraagde dienst';
  const firstName = (lead.name || 'klant').split(' ')[0];
  return {
    priority,
    quality_score: score,
    qualification,
    next_action: hasContact ? `Neem contact op over ${service} en bevestig behoefte, timing en prijsindicatie.` : 'Vraag eerst om een telefoonnummer of e-mailadres voordat je opvolgt.',
    reply_draft: `Hallo ${firstName}, bedankt voor je aanvraag over ${service}. We helpen je graag. Kun je bevestigen wanneer het voor jou het beste uitkomt? Dan plannen we de volgende stap meteen in.`,
    needs_appointment: Boolean(hasContact && lead.preferred_time),
    needs_follow_up: hasContact,
    summary: `Lead beoordeeld op contactgegevens, dienst, urgentie, locatie en geschatte waarde. Score: ${score}/100.`
  };
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
    quality_score: { type: 'integer', minimum: 0, maximum: 100 },
    qualification: { type: 'string', enum: ['poor', 'possible', 'good', 'excellent'] },
    next_action: { type: 'string' },
    reply_draft: { type: 'string' },
    needs_appointment: { type: 'boolean' },
    needs_follow_up: { type: 'boolean' },
    summary: { type: 'string' }
  },
  required: ['priority', 'quality_score', 'qualification', 'next_action', 'reply_draft', 'needs_appointment', 'needs_follow_up', 'summary']
};

function extractOutputText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text) return payload.output_text;
  for (const item of payload?.output ?? []) {
    for (const part of item?.content ?? []) {
      if (part?.type === 'output_text' && typeof part?.text === 'string') return part.text;
    }
  }
  throw new Error('OpenAI response did not contain output text');
}

async function openAiAnalysis(lead: Lead): Promise<{ analysis: Analysis; model: string }> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  const model = Deno.env.get('OPENAI_MODEL') || 'gpt-5.4-nano';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 500,
      instructions: 'Je bent de Lead2Job AI Revenue Agent voor Nederlandse servicebedrijven. Analyseer alleen de aangeleverde lead. Wees praktisch, commercieel en voorzichtig: verzin geen ontbrekende feiten. Schrijf next_action, reply_draft en summary in natuurlijk Nederlands.',
      input: JSON.stringify({
        name: lead.name,
        phone_present: Boolean(lead.phone),
        email_present: Boolean(lead.email),
        channel: lead.channel,
        service_type: lead.service_type,
        description: lead.description,
        city: lead.city,
        urgency: lead.urgency,
        preferred_time: lead.preferred_time,
        status: lead.status,
        estimated_value_min: lead.estimated_value_min,
        estimated_value_max: lead.estimated_value_max
      }),
      text: {
        format: {
          type: 'json_schema',
          name: 'lead_analysis',
          strict: true,
          schema
        }
      }
    })
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI request failed (${response.status})`);
  const analysis = JSON.parse(extractOutputText(payload)) as Analysis;
  return { analysis, model };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { success: false, error: 'Method not allowed' });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json(500, { success: false, error: 'Server configuration incomplete' });

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json(401, { success: false, error: 'Missing authorization' });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (userError || !user) return json(401, { success: false, error: 'Invalid session' });

    const body = await req.json().catch(() => ({}));
    const leadId = typeof body?.lead_id === 'string' ? body.lead_id.trim() : '';
    if (!leadId) return json(400, { success: false, error: 'lead_id is required' });

    const { data: lead, error: leadError } = await admin
      .from('leads')
      .select('id, owner_id, name, phone, email, channel, service_type, description, city, urgency, preferred_time, status, estimated_value_min, estimated_value_max')
      .eq('id', leadId)
      .eq('owner_id', user.id)
      .maybeSingle();

    if (leadError) {
      console.error('lead lookup failed', leadError);
      return json(500, { success: false, error: 'Could not load lead' });
    }
    if (!lead) return json(404, { success: false, error: 'Lead not found' });

    const aiMode = (Deno.env.get('AI_MODE') || 'mock').toLowerCase();
    let provider = 'mock';
    let model = 'lead2job-rules-v1';
    let providerError: string | null = null;
    let analysis: Analysis;

    if (aiMode === 'openai') {
      try {
        const result = await openAiAnalysis(lead as Lead);
        analysis = result.analysis;
        provider = 'openai';
        model = result.model;
      } catch (error) {
        providerError = error instanceof Error ? error.message : String(error);
        console.error('openai analysis failed; using mock fallback', providerError);
        analysis = mockAnalysis(lead as Lead);
        provider = 'mock_fallback';
      }
    } else {
      analysis = mockAnalysis(lead as Lead);
    }

    const { error: activityError } = await admin.from('activities').insert({
      lead_id: lead.id,
      type: 'ai_analysis',
      channel: 'ai',
      content: `AI analyse: ${analysis.qualification}, ${analysis.quality_score}/100. ${analysis.next_action}`,
      metadata: {
        provider,
        model,
        mode: aiMode,
        provider_error: providerError,
        analysis
      }
    });

    if (activityError) console.error('activity insert failed', activityError);

    return json(200, {
      success: true,
      provider,
      model,
      analysis,
      saved: !activityError,
      provider_error: providerError
    });
  } catch (error) {
    console.error('analyze-lead error', error);
    return json(500, { success: false, error: 'Unexpected server error' });
  }
});
