# Crucible: API server, web client and every judge toolchain in one image.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 gcc g++ libc6-dev openjdk-17-jdk-headless ca-certificates curl util-linux \
    && ln -sf /usr/bin/python3 /usr/local/bin/python3 \
    && rm -rf /var/lib/apt/lists/*
# Go (official toolchain)
ARG GO_VERSION=1.24.7
RUN curl -fsSL https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz | tar -C /usr/local -xz \
    && ln -s /usr/local/go/bin/go /usr/local/bin/go
# Rust, installed system-wide so sandbox users can read the toolchain
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
    && chmod -R a+rX /usr/local/rustup /usr/local/cargo \
    && ln -s /usr/local/cargo/bin/rustc /usr/local/bin/rustc

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server/package.json server/
COPY --from=build /app/web/package.json web/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/sandbox server/sandbox
COPY --from=build /app/web/dist web/dist
# The app directory must not be readable by sandbox users (hidden tests live in the DB).
RUN chmod -R o-rwx /app

ENV NODE_ENV=production PORT=4000 DATA_DIR=/data BOX_ROOT=/var/tmp/crucible
VOLUME ["/data"]
EXPOSE 4000
# The judge runs as root inside the container so it can drop each submission to its
# own uid and create network/mount namespaces. See docker-compose.yml for the
# capabilities this needs.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/dist/index.js"]
