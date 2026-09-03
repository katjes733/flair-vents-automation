#!/usr/bin/env bash
set -euo pipefail

CERTS_DIR="postgres/certs/local"
mkdir -p "$CERTS_DIR"

EXT_FILE="$(mktemp)"
trap 'rm -f "$EXT_FILE"' EXIT

# SANs must cover every hostname the app uses to connect:
#   postgres  — Docker service name (container-to-container)
#   localhost — local dev (app on host → port-mapped container)
#   127.0.0.1 — same as localhost, by IP
cat > "$EXT_FILE" << 'EOF'
[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = postgres
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF

echo "→ Generating CA key and certificate..."
openssl req -new -x509 -days 3650 -nodes \
  -keyout "$CERTS_DIR/ca.key" \
  -out "$CERTS_DIR/ca.crt" \
  -subj "/CN=flair-vents-automation-local-ca"

echo "→ Generating server key..."
openssl genrsa -out "$CERTS_DIR/server.key" 4096

echo "→ Generating certificate signing request..."
openssl req -new \
  -key "$CERTS_DIR/server.key" \
  -out "$CERTS_DIR/server.csr" \
  -subj "/CN=postgres"

echo "→ Signing server certificate with CA..."
openssl x509 -req -days 3650 \
  -in "$CERTS_DIR/server.csr" \
  -CA "$CERTS_DIR/ca.crt" \
  -CAkey "$CERTS_DIR/ca.key" \
  -CAcreateserial \
  -out "$CERTS_DIR/server.crt" \
  -extensions v3_req \
  -extfile "$EXT_FILE"

rm -f "$CERTS_DIR/server.csr" "$CERTS_DIR/ca.srl"
chmod 600 "$CERTS_DIR/server.key" "$CERTS_DIR/ca.key"

echo ""
echo "✅ Certificates written to $CERTS_DIR/"
echo ""
echo "  ca.crt     — CA certificate (set DB_SSL_CA_PATH to this file)"
echo "  ca.key     — CA private key (keep safe, not needed at runtime)"
echo "  server.crt — Postgres server certificate (SANs: postgres, localhost, 127.0.0.1)"
echo "  server.key — Postgres server private key"
echo ""
echo "Next steps:"
echo "  1. Add to .env:  DB_SSL=true"
echo "  2. Add to .env:  DB_SSL_CA_PATH=./postgres/certs/local/ca.crt"
echo "  3. Run:          bun run docker:down && bun run docker:up"
