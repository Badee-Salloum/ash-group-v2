/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker deploys copy the standalone output; keeping this explicit also
  // avoids shipping the full source tree to the runtime image.
  output: 'standalone',
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', 'ash-group.vercel.app', 'financial-platform-theta.vercel.app'],
    },
  },
}
module.exports = nextConfig
