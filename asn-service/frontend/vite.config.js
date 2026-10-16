import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Produção: assets relativos para funcionar em /{slug}/ no Umbrella.
  // Com base "/", o browser pede /assets/*.js na raiz e o Hub devolve index.html.
  base: mode === 'production' ? './' : '/',
  server: {
    port: 5175,
    proxy: {
      // Redireciona chamadas /api/* para o backend ASN
      '/api': {
        target: 'http://localhost:8003',
        changeOrigin: true,
      },
    },
  },
}))
