// Keep the CI capacity check and the default-rules market experiment independently runnable.
if (process.argv.includes('--market') || process.argv.includes('--auction-trials')) await import('./market.js');
else await import('./stress.js');
