import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'callytics',
  description: 'Self-hosted programmable call center with IVR builder, SIP trunks, live dashboard, and recordings.',
  base: '/callytics/',
  cleanUrls: true,
  appearance: false,

  head: [
    [
      'link',
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
    ],
    [
      'link',
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossorigin: '',
      },
    ],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
      },
    ],
    [
      'link',
      {
        rel: 'icon',
        href: '/callytics/favicon.ico',
      },
    ],
  ],

  vite: {
    server: {
      host: true,
      allowedHosts: ['unhealed-wilfred-unfathomed.ngrok-free.dev'],
    },
  },

  themeConfig: {
    logo: '/callytics-icon.png',
    siteTitle: 'Callytics',

    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Features', link: '/features/' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'API', link: '/api/' },
      {
        text: 'GitHub',
        link: 'https://github.com/rayanweragala/callytics',
        target: '_blank',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/' },
            { text: 'Installation', link: '/guide/install' },
            { text: 'First Call', link: '/guide/first-call' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [{ text: 'How It Works', link: '/architecture/' }],
        },
      ],
      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Overview', link: '/features/' },
            { text: 'Screenshots', link: '/features/screenshots' },
            { text: 'IVR Flow Builder', link: '/features/ivr' },
            { text: 'SIP Extensions', link: '/features/extensions' },
            { text: 'SIP Trunks', link: '/features/trunks' },
            { text: 'Queues & Operators', link: '/features/queues' },
            { text: 'Outbound Campaigns', link: '/features/campaigns' },
            { text: 'Call Logs', link: '/features/call-logs' },
            { text: 'SIP Capture', link: '/features/sip-capture' },
            { text: 'Diagnostics', link: '/features/diagnostics' },
            { text: 'Call Recordings', link: '/features/recordings' },
            { text: 'Audio Management', link: '/features/audio' },
            { text: 'WireGuard VPN', link: '/features/vpn' },
            { text: 'SIP Firewall', link: '/features/firewall' },
            { text: 'Backup & Restore', link: '/features/backup' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [{ text: 'Endpoints', link: '/api/' }],
        },
      ],
      '/config/': [
        {
          text: 'Configuration',
          items: [{ text: 'Environment Variables', link: '/config/' }],
        },
      ],
      '/troubleshooting/': [
        {
          text: 'Troubleshooting',
          items: [{ text: 'Common Issues', link: '/troubleshooting/' }],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/rayanweragala/callytics' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: '© 2026 Callytics — open source call center platform',
    },

    editLink: undefined,
    lastUpdated: false,
    search: {
      provider: 'local',
    },
  },
})
