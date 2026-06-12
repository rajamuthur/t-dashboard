/** @type {import('next').NextConfig} */

// Where the FastAPI backend lives. Local dev → localhost:8000.
// On Vercel set NEXT_PUBLIC_BACKEND_URL to your Fly URL, e.g.
//   https://t-dashboard-api.fly.dev
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const nextConfig = {
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
