# build environment
FROM node:22-alpine AS node-builder
WORKDIR /app
RUN apk add --no-cache git python3 make g++
RUN apk add --no-cache zip
COPY ["package.json", "package-lock.json*", "./"]
RUN npm ci
COPY . .
RUN npm run-script update-version --release_version=$(cat release-version.txt) 
RUN npm run build-prod

RUN mkdir -p /build
# Angular's `application` builder emits the browser bundle to dist/browser/; zip its
# CONTENTS so the node serves /wallet/index.html (not /wallet/browser/index.html).
RUN cd dist/browser && zip -r /build/iep-wallet-ui.zip ./*

# minimal output image — only the built artifact
FROM alpine:latest
COPY --from=node-builder /build/iep-wallet-ui.zip /build/iep-wallet-ui.zip
