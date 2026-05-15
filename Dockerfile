FROM node:24-alpine

ARG BUILD_VERSION=dev
ENV PSITRANSFER_UPLOAD_DIR=/data \
    NODE_ENV=production \
    BUILD_VERSION=${BUILD_VERSION}

LABEL maintainer="Christoph Wiechert <wio@psitrax.de>"

RUN apk add --no-cache tzdata su-exec

WORKDIR /app

ADD *.js package.json package-lock.json README.md /app/
ADD lib /app/lib
ADD app /app/app
ADD lang /app/lang
ADD plugins /app/plugins
ADD public /app/public
ADD entrypoint.sh /entrypoint.sh

# Rebuild the frontend apps
RUN cd app && \
    NODE_ENV=dev npm ci && \
    npm run build && \
    cd .. && \
    mkdir /data && \
    npm ci && \
    rm -rf app && \
    chmod +x /entrypoint.sh

EXPOSE 3000
VOLUME ["/data"]

# HEALTHCHECK CMD wget -O /dev/null -q http://localhost:3000

ENTRYPOINT ["/entrypoint.sh"]
