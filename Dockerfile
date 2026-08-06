# ---- build stage: compile the React UI ----
# Base image comes from AWS's public mirror of Docker Hub — same image, but not
# subject to Docker Hub's per-IP anonymous pull limits (429s on shared NAT).
FROM public.ecr.aws/docker/library/node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: server + built UI, prod deps only ----
FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
# data (projects.json, api-keys.json) lives here — mount a volume to persist it
RUN mkdir -p server/data
VOLUME ["/app/server/data"]
EXPOSE 5181
CMD ["node", "server/server.mjs"]
