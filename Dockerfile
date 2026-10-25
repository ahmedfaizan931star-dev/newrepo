FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./server.js
COPY public ./public
EXPOSE 3000
VOLUME ["/data"]
CMD ["npm", "start"]
