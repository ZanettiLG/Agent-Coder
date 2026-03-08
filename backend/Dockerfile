# Agent Coder – backend (API e worker)
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src

# Frontend build opcional: descomente e use multi-stage se quiser servir o build pelo backend
# COPY ../frontend/dist ./frontend/dist

EXPOSE 3000

# Default: servidor; override com "npm run worker" para o worker
CMD ["node", "src/server/run.js"]
