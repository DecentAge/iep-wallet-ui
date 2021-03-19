# build environment
FROM node:10 AS builder
ENV NODE_ENV=production
WORKDIR /app
COPY ["package.json", "package-lock.json*", "./"]
RUN npm install
COPY . .
RUN npm run build-prod

# production environment
FROM nginx:1.17
COPY --from=builder /app/dist /usr/share/nginx/html/
COPY --from=builder /app/nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]