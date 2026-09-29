# Build from the repo root:  docker build -f apps/web/Dockerfile --build-arg NOX_API_URL=https://… .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/nox-cli/package.json packages/nox-cli/
RUN npm ci
COPY apps/web apps/web
# Next bakes these in at build time: the API behind the /api/v1 proxy, and the public Firebase config.
ARG NOX_API_URL
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_NOX_DEV_AUTH=false
RUN npm run build -w @nox/web

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "npm run start -w @nox/web -- -p ${PORT}"]
