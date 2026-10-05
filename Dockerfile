# glibc image: the embedding runtime (onnxruntime-node) does not support Alpine/musl
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY client/package*.json ./client/
RUN cd client && npm install

COPY . .
RUN cd client && npm run build

# Local Quran index from Quranpedia's official dump (fetched fresh at build time)
RUN (node scripts/fetch-quranpedia.js && node scripts/build-quran-index.js) || echo "WARNING: Quran index not built"

# Official English translations of the meanings of the Quran (QuranEnc.com)
RUN (node scripts/fetch-quranenc.js && node scripts/build-quranenc-index.js) || echo "WARNING: QuranEnc index not built"

ENV NODE_ENV=production
CMD ["node", "server/index.js"]
