# Build from repository root: docker build -f frontend/Dockerfile -t claims-platform-frontend .
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/claims-portal/browser /usr/share/nginx/html
EXPOSE 80
