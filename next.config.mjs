/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/orders/[orderId]/receipt": [
      "./node_modules/pdfkit/js/standard-fonts/**/*",
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
