# 微信云托管 / CloudBase Run 部署镜像
FROM node:20-alpine

WORKDIR /app

# 先装依赖（利用缓存）
COPY package*.json ./
RUN npm install --production

# 复制源码
COPY . .

# 容器内监听端口（创建服务时"服务端口"需与此一致）
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
