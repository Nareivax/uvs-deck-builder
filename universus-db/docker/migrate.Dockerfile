# Migration runner with the SQL files baked in. Build from the repo root:
#   docker build -f docker/migrate.Dockerfile -t universus-migrate .
FROM flyway/flyway:11
# Check Docker Hub for the current tag when you set this up.
COPY db/migrations /flyway/sql
# Connection details come from FLYWAY_URL / FLYWAY_USER / FLYWAY_PASSWORD at run time.
CMD ["-connectRetries=10", "migrate"]
