# build environment
FROM node:10 AS builder
WORKDIR /app
COPY ["package.json", "package-lock.json*", "./"]
RUN npm install -g @angular/cli@6.2.9
RUN npm install
COPY . .
RUN npm run build-prod

# production environment
FROM nginx:1.18
ENV NGINX_PATH=/
COPY --from=builder /app/dist /usr/share/nginx/html/
COPY --from=builder /app/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/src/env.config.js.template /etc/nginx/templates/env.config.js.template
COPY --from=builder /app/src/30-nginx-iep-startup-script.sh /docker-entrypoint.d/30-nginx-iep-startup-script.sh

RUN chown ugo+x /docker-entrypoint.d/30-nginx-iep-startup-script.sh

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]