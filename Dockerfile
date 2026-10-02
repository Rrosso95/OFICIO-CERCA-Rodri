FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/oficios.db
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
