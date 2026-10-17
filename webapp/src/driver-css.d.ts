// TourRenderer.ts lazily imports driver.js's stylesheet from its package
// subpath; TypeScript resolves a dynamic import() and finds no types for
// a .css file. Scoped to exactly that one specifier (as in gigsy's
// vite-env.d.ts) rather than a "*.css" wildcard, which would widen every
// CSS import in the project to `any`.
declare module "driver.js/dist/driver.css";
