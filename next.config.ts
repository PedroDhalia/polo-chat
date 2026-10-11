import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  // Testes automatizados geram o build em outra pasta (NEXT_DIST_DIR=.next-test) para nunca
  // sobrescrever o build usado pelo `npm run demo` / `npm start` que estiver rodando.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Indicador de desenvolvimento desligado para não cobrir a interface durante demonstrações.
  devIndicators: false,
  experimental: {
    // O cache em disco do `next dev` chegava a ~500 MB em .next/dev e era reescrito a cada
    // alteração. Com o projeto dentro do OneDrive, isso vira sincronização constante (disco e CPU).
    // Fora do OneDrive, pode voltar a `true` para reinícios mais rápidos do servidor de desenvolvimento.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
