import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["parole-amount-snub.ngrok-free.dev"],
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;
