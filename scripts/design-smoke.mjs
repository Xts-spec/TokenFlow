// Empty-profile visual and navigation coverage for the gateway product.
process.argv.push('--empty');
await import('./product-refactor-smoke.mjs');
