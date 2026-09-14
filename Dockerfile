FROM node:20-bookworm-slim AS base
WORKDIR /app

# mysql-client provides the mysql/mysqldump CLIs used by Settings > Backup & Restore
RUN apt-get update && apt-get install -y --no-install-recommends default-mysql-client \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/uploads

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# Migrate + seed on first boot only (marker file in the uploads volume), then start.
CMD sh -c "node src/db/migrate.js && ([ -f /app/uploads/.seeded ] || (node src/db/seed.js && touch /app/uploads/.seeded)); node src/server.js"
