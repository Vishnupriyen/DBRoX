// All settings come from environment variables (deploy/.env on the Hostinger server, readable by root only).
export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/dbrox',
  // the public dev secret only for tests and local development — a server started without NODE_ENV must not sign with it
  jwtSecret: process.env.JWT_SECRET ?? (['development', 'test'].includes(process.env.NODE_ENV ?? '') ? 'dev-only-secret-change-me' : ''),
  // during a planned key change the old secret still opens tokens for a while (docs/security/06-cryptography.md)
  jwtSecretOld: process.env.JWT_SECRET_OLD ?? '',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  aiModel: process.env.AI_MODEL ?? 'claude-haiku-5-5',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  // photo reads per month by plan (definition doc: 300 / 1,000 / 3,000)
  scanAllowance: { single: 300, triple: 1000, all: 3000 } as Record<string, number>,
  scanTrial: 100,          // a free trial's photo reads per month
  pullLimit: 2000,
  pullBytes: 4 * 1024 * 1024, // one pull page, by stored size (records with photos): rows and bytes both cap a page
  // payments (Razorpay subscriptions with UPI Autopay). Plans map "tier:pack" → Razorpay plan id, e.g. {"medium:complete":"plan_Nx…"}
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
    plans: JSON.parse(process.env.RAZORPAY_PLANS ?? '{}') as Record<string, string>,
  },
  adminKey: process.env.ADMIN_KEY ?? '',   // the Hanubix console (our side only)
  cronKey: process.env.CRON_KEY ?? '',     // deploy/cron-call.sh calls the scheduled jobs with this (from inside the machine)
};
/** requests per minute (security standard, section 8 item 3); read when the server starts */
export const rates = () => ({
  perPlace: Number(process.env.RATE_PLACE_PER_MIN ?? 1200),  // every /v1 call from one address (an office behind one router)
  sync: Number(process.env.RATE_SYNC_PER_MIN ?? 240),        // one login's syncs
  number: Number(process.env.RATE_NUMBER_PER_MIN ?? 120),
  scan: Number(process.env.RATE_SCAN_PER_MIN ?? 20),
  admin: Number(process.env.RATE_ADMIN_PER_MIN ?? 60),
  publicForm: Number(process.env.RATE_PUBLIC_PER_HOUR ?? 5),
});

if (!config.jwtSecret) throw new Error('JWT_SECRET must be set (only NODE_ENV=development or test may run without one)');
// a short signing secret can be guessed, and with it a login for any firm can be forged
if (!['development', 'test'].includes(process.env.NODE_ENV ?? '') && config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
// in production only our own web app and the Android app may call the server from a browser
if (process.env.NODE_ENV === 'production' && config.corsOrigin === '*') throw new Error('CORS_ORIGIN must be set in production');
