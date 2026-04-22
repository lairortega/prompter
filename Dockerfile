FROM node:20-alpine
WORKDIR /usr/src/app

COPY package.json ./
RUN npm i

EXPOSE 3000

CMD ["npm", "start"]