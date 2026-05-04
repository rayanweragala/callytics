declare module '@maxmind/geoip2-node' {
  export const Reader: {
    open: (path: string) => Promise<{
      country: (ip: string) => { country?: { isoCode?: string; names?: { en?: string } } } | null;
    }>;
  };
}
