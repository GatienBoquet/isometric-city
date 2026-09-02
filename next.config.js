const { withGTConfig } = require("gt-next/config");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Origin-Agent-Cluster', value: '?1' },
          { key: 'Permissions-Policy', value: 'tools=(self)' },
        ],
      },
    ];
  },
};

module.exports = withGTConfig(nextConfig);