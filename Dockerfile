FROM node:20-alpine
WORKDIR /app
COPY package.json index.js ./
ENV NODE_ENV=production
ENTRYPOINT ["node", "index.js"]
