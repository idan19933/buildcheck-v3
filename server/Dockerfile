FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl libssl3 ca-certificates \
      && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Runtime deps: openssl/libssl3 for Prisma engine, python3+poppler for DXF/PDF,
# tesseract + Hebrew language pack for scanned-PDF OCR.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl libssl3 ca-certificates \
      python3 python3-pip python3-venv \
      poppler-utils \
      tesseract-ocr tesseract-ocr-heb tesseract-ocr-eng \
      && rm -rf /var/lib/apt/lists/*

# Python venv with ezdxf
COPY python ./python
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r python/requirements.txt
ENV PATH="/opt/venv/bin:${PATH}"
ENV PYTHON_BIN=/opt/venv/bin/python3

# Install prod deps + regenerate Prisma client for the runtime platform
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install --omit=dev \
 && npx prisma generate \
 && npm cache clean --force

COPY --from=builder /app/dist ./dist
RUN mkdir -p uploads/dxf uploads/tava uploads/addon-docs

EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
