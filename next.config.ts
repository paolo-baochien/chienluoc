import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages ? "/chienluoc" : undefined,
  assetPrefix: isGitHubPages ? "/chienluoc" : undefined,
  trailingSlash: isGitHubPages,
  images: {
    unoptimized: true,
  },
  typescript: {
    tsconfigPath: isGitHubPages ? "tsconfig.pages.json" : "tsconfig.json",
  },
};

export default nextConfig;
