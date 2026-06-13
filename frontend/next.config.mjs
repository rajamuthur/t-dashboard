/** @type {import('next').NextConfig} */

// Where the FastAPI backend lives. Local dev → localhost:8000.
// On Vercel set NEXT_PUBLIC_BACKEND_URL to your Fly URL, e.g.
//   https://t-dashboard-api.fly.dev
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const nextConfig = {
  // Don't fail the production build on ESLint style rules (no-unused-vars,
  // no-explicit-any, unescaped quotes, etc.). TypeScript type-checking still
  // runs and still blocks the build on real type errors. Run `npm run lint`
  // separately for style. This keeps `next build` reliable for self-hosting.
  eslint: { ignoreDuringBuilds: true },

  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
