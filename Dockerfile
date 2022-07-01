ARG  NODE_VERSION lts
FROM node:${NODE_VERSION}-alpine as build
WORKDIR /app

ADD . .
RUN npm install \
 && npm run build \
 && rm dist/*.d.ts dist/*.js.map \

RUN rm -rf node_modules \
 && npm install --production

FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV production
ENV DIR /scan

WORKDIR /app
COPY --from=build /app/dist/ .
COPY --from=build /app/node_modules/ ./node_modules

CMD [ "node", "index.js" ]
