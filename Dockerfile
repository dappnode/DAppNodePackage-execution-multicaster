FROM node:18 as builder

WORKDIR /usr/src/app

COPY *.json yarn.lock ./

RUN yarn

COPY ./src ./src
RUN yarn build

FROM node:18-alpine

WORKDIR /usr/src/app
COPY package.json yarn.lock ./
RUN yarn --production

COPY --from=builder /usr/src/app/build/ ./build/

EXPOSE 8551
CMD [ "node", "build/index" ]
