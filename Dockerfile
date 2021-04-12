# build environment
FROM node:10 AS builder
ENV NODE_ENV=production
WORKDIR /app
COPY ["package.json", "package-lock.json*", "./"]
RUN npm install -g @angular/cli@6.2.9
RUN npm install
COPY . .
RUN npm run build-prod

# production environment
FROM nginx:1.18
COPY --from=builder /app/dist /usr/share/nginx/html/
COPY --from=builder /app/default.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]