import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lead2job.mobile',
  appName: 'Lead2Job',
  webDir: 'mobile-web',
  bundledWebRuntime: false,
  server: {
    url: 'https://lead2job-ai-mvp.vercel.app/start.html',
    cleartext: false,
    allowNavigation: [
      'lead2job-ai-mvp.vercel.app',
      'npqiispbwwinnnvzyybx.supabase.co'
    ]
  }
};

export default config;
