# build environment
FROM node:20-alpine AS node-builder
WORKDIR /app
RUN apk add --no-cache git python3 make g++
RUN apk add --no-cache zip
COPY ["package.json", "package-lock.json*", "./"]
RUN npm install
COPY . .
RUN npm run-script update-version --release_version=$(cat release-version.txt) 
RUN npm run build-prod

RUN mkdir -p /build
RUN cd dist; zip -r /build/iep-wallet-ui.zip ./*
