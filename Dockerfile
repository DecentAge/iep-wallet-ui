# build environment
FROM node:10-alpine AS node-builder
WORKDIR /app
RUN apk add --no-cache git
RUN apk add --no-cache zip
COPY ["package.json", "package-lock.json*", "./"]
RUN npm install -g @angular/cli@6.2.9
RUN npm install
COPY . .
RUN npm run-script update-version --release_version=$(cat release-version.txt) 
RUN npm run build-prod

#RUN mkdir -p /build
#RUN cd dist; zip -r /build/iep-wallet-ui.zip ./*
