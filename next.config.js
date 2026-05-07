/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', 'ash-group.vercel.app', 'financial-platform-theta.vercel.app'],
    },
  },
}
module.exports = nextConfig
