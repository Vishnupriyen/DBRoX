// All settings come from environment variables (Cloud Run secrets in production).
export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/dbrox',
  jwtSecret: process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-only-secret-change-me'),
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  aiModel: process.env.AI_MODEL ?? 'claude-haiku-5-5',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  // photo reads per month by plan (definition doc: 300 / 1,000 / 3,000)
  scanAllowance: { single: 300, triple: 1000, all: 3000 } as Record<string, number>,
  pullLimit: 2000,
  // payments (Razorpay subscriptions with UPI Autopay). Plans map "tier:pack" → Razorpay plan id, e.g. {"medium:complete":"plan_Nx…"}
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
    plans: JSON.parse(process.env.RAZORPAY_PLANS ?? '{}') as Record<string, string>,
  },
  adminKey: process.env.ADMIN_KEY ?? '',   // the Hanubix console (our side only)
  cronKey: process.env.CRON_KEY ?? '',     // Cloud Scheduler calls the daily job with this
};

if (!config.jwtSecret) throw new Error('JWT_SECRET must be set in production');
