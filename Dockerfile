FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY client/package*.json ./client/
RUN cd client && npm install

COPY . .
RUN cd client && npm run build

ENV NODE_ENV=production
CMD ["node", "server/index.js"]
