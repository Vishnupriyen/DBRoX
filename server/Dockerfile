# DBRoX server for Google Cloud Run (Mumbai: asia-south1)
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db ./db
COPY shared ./shared
USER node
CMD ["node", "dist/index.js"]
