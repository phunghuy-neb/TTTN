FROM node:22-alpine

WORKDIR /app

# Backend không chạy scraper trong container API, nên không cần tải Chromium của Puppeteer.
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node test ./test
RUN mkdir -p uploads && chown node:node uploads

USER node
EXPOSE 5000

CMD ["npm", "start"]
