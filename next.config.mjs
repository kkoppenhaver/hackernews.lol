/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
  // Files read at runtime by the /api/simulate route. Next.js's file tracer
  // doesn't see fs.readFile calls, so we tell it explicitly. Without these,
  // the files ship with the repo but are absent from the serverless function
  // bundle on Vercel.
  outputFileTracingIncludes: {
    "/api/simulate": [
      "./prompts/**/*",
      "./data/corpus.jsonl",
    ],
  },
};

export default nextConfig;
