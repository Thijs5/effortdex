# Containerised local dev (docs/adr/0026). Runs the same `npm run dev`
# esbuild dev server as a bare-metal checkout; `compose.yaml`'s
# `develop.watch` syncs the source tree in on change. Not a production
# image — GitHub Pages is served from `npm run build` output (dist/),
# see .github/workflows/deploy.yml.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173
ENV HOST=0.0.0.0 PORT=5173
CMD ["npm", "run", "dev"]
