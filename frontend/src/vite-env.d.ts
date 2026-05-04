/// <reference types="vite/client" />
/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}