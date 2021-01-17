FROM node:10.16.3 AS build-env

WORKDIR /app
COPY package.json /app/
COPY package-lock.json /app/
RUN npm install --production
COPY . /app

FROM gcr.io/distroless/nodejs
EXPOSE 9022
COPY --from=build-env /app /app
WORKDIR /app
CMD ["app.js"]
