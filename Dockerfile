FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    CONFIG_PATH=/data/config.yaml \
    TZ_DISPLAY=Asia/Ho_Chi_Minh

# tsx nằm trong devDependencies nên cài đủ cả dev deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY config.example.yaml ./

# /data là volume: config.yaml, state, mật khẩu admin, cài đặt Telegram
RUN mkdir -p /data
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts", "start"]
