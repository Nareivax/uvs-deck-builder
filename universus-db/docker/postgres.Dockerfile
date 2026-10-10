# Database image. Build from the repo root:
#   docker build -f docker/postgres.Dockerfile -t universus-db .
FROM postgres:16
# Pin a major version and upgrade deliberately.
# The citext extension used by the schema ships with the official image.
# This is also the place to add custom postgresql.conf settings or extra extensions.

HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" || exit 1
