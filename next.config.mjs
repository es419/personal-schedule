function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

const canonicalUrl =
  normalizeUrl(process.env.NEXTAUTH_URL) ||
  normalizeUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
  normalizeUrl(process.env.VERCEL_URL) ||
  "http://localhost:3000";

const nextConfig = {
  // next-auth/react evaluates NEXTAUTH_URL while the client bundle is built.
  // Supplying a non-empty canonical fallback prevents a blank Vercel env value
  // from crashing prerender/build. A real NEXTAUTH_URL still takes precedence.
  env: {
    NEXTAUTH_URL: canonicalUrl,
  },
};

export default nextConfig;
