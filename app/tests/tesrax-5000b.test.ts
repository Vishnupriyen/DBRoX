// The second half of TESRAX 5000 (see tesrax-5000.test.ts): its own worker, so both halves run at the same time.
process.env.TESRAX_HALF_B = '1';
const { runHalf } = await import('./tesrax-5000.test');
runHalf(1);
