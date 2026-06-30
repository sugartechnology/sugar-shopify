#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Starting Sugar Room Studio server on ${HOST:-0.0.0.0}:${PORT:-3000}..."
exec npm run start
