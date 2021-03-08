FROM node:12.18.1 AS builder
ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install --production

COPY . .

CMD [ "ng",  "build", "-prod" ]