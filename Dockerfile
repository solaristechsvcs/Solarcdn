FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/storage && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npm","start"]