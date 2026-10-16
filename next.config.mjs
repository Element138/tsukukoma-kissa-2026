/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/api/orders/[orderId]/receipt": [
      "./node_modules/pdfkit/js/standard-fonts/**/*",
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./public/fonts/*.otf",
      "./public/fonts/Lato-Bold.ttf",
      "./public/receipt/logo.png"
    ]
  },
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true
};

export default nextConfig;
