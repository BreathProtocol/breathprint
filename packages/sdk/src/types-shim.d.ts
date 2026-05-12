// Ambient declarations for libraries we use at runtime but that don't
// ship TypeScript types. Keeps `tsc` happy without `@types/*` shims.
declare module "snarkjs";
declare module "circomlibjs";
