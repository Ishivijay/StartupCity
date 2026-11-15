# Startup City: one container that serves the site and the API on $PORT (Cloud Run sets it).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/shared ./src/shared
COPY src/startup/logic.ts ./src/startup/logic.ts
COPY data ./data
COPY public ./public
EXPOSE 8080
CMD ["node", "--import", "tsx", "server/index.ts"]
