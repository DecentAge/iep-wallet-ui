FROM node:10 AS builder
ENV NODE_ENV=production
WORKDIR /app
#COPY ["package.json", "package-lock.json*", "./"]
COPY . .
RUN npm install
RUN npm run build-prod

FROM nginx:1.17
COPY --from=builder /app/dist /usr/share/nginx/html/
# CMD ["nginx","-g","daemon off;"]