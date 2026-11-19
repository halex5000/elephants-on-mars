// Keep the CI capacity check and the default-rules market experiment independently runnable.
if (process.argv.includes('--market')) await import('./market.js');
else await import('./stress.js');
